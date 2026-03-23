import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from groq import AsyncGroq
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env", override=True)

GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
_groq_client: AsyncGroq | None = None

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()


app = FastAPI(title="Memory Capsule API", lifespan=lifespan)
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "memory-capsule-api"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AppInfo(BaseModel):
    name: str = "Memory Capsule"
    mode: str = "local-first retrieval + cloud chat"
    description: str = "Privacy-first voice memory capture with local retrieval and Groq-backed assistant chat."
    assistant_available: bool = True
    payments_enabled: bool = False
    storage: str = "IndexedDB on-device"


class GenerateRequest(BaseModel):
    query: str
    context: str


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class MemoryReference(BaseModel):
    id: str | None = None
    summary: str
    transcript: str
    emotion: str | None = None
    createdAt: str
    score: float | None = None


class ChatSocketRequest(BaseModel):
    request_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: Literal["chat"] = "chat"
    query: str
    references: List[MemoryReference] = Field(default_factory=list)
    history: List[ChatHistoryMessage] = Field(default_factory=list)


def get_groq_client() -> AsyncGroq:
    global _groq_client

    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        raise RuntimeError("GROQ_API_KEY is not configured on the backend.")

    if _groq_client is None:
        _groq_client = AsyncGroq(api_key=groq_api_key)

    return _groq_client


def format_memory_context(references: List[MemoryReference]) -> str:
    if not references:
        return "No relevant memories were provided."

    blocks = []
    for index, reference in enumerate(references, start=1):
        blocks.append(
            "\n".join(
                [
                    f"Memory {index}",
                    f"Date: {reference.createdAt}",
                    f"Emotion: {reference.emotion or 'unknown'}",
                    f"Summary: {reference.summary}",
                    f"Transcript: {reference.transcript}",
                ]
            )
        )

    return "\n\n".join(blocks)


def build_chat_messages(
    query: str,
    references: List[MemoryReference],
    history: List[ChatHistoryMessage],
    *,
    context_override: str | None = None,
) -> list[dict[str, str]]:
    memory_context = context_override if context_override is not None else format_memory_context(references)

    system_prompt = f"""
You are Memory Capsule's chat assistant.
Answer only from the provided memory context and the conversation so far.
If the memories do not support a conclusion, say that clearly.
Be concise, natural, and grounded.
Do not invent facts, dates, or feelings that are not in the memories.

Memory context:
{memory_context}
""".strip()

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    for message in history[-8:]:
        content = message.content.strip()
        if content:
            messages.append({"role": message.role, "content": content})

    messages.append({"role": "user", "content": query.strip()})
    return messages


async def iterate_groq_chat(messages: list[dict[str, str]]):
    client = get_groq_client()
    stream = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.3,
        max_completion_tokens=512,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta


async def safe_send_json(websocket: WebSocket, payload: dict):
    try:
        await websocket.send_json(payload)
    except RuntimeError:
        logger.warning("WebSocket closed before payload could be sent.")


@api_router.get("/", response_model=AppInfo)
async def root():
    return AppInfo()


@api_router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse()


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)

    doc = status_obj.model_dump()
    doc["timestamp"] = doc["timestamp"].isoformat()

    _ = await db.status_checks.insert_one(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)

    for check in status_checks:
        if isinstance(check["timestamp"], str):
            check["timestamp"] = datetime.fromisoformat(check["timestamp"])

    return status_checks


@api_router.post("/generate")
async def generate_with_groq(request: GenerateRequest):
    try:
        messages = build_chat_messages(request.query, [], [], context_override=request.context)

        async def stream_response():
            async for text in iterate_groq_chat(messages):
                yield text

        return StreamingResponse(stream_response(), media_type="text/plain")
    except Exception as exc:
        logger.exception("Groq API error")
        return {"error": str(exc)}


@api_router.websocket("/chat/ws")
async def chat_with_memories(websocket: WebSocket):
    await websocket.accept()
    await safe_send_json(websocket, {"type": "ready"})

    while True:
        request_id = None
        try:
            payload = await websocket.receive_json()
            request = ChatSocketRequest.model_validate(payload)
            request_id = request.request_id

            messages = build_chat_messages(request.query, request.references, request.history)
            await safe_send_json(websocket, {"type": "start", "request_id": request.request_id})

            answer_parts: list[str] = []
            async for text in iterate_groq_chat(messages):
                answer_parts.append(text)
                await safe_send_json(
                    websocket,
                    {
                        "type": "chunk",
                        "request_id": request.request_id,
                        "content": text,
                    },
                )

            await safe_send_json(
                websocket,
                {
                    "type": "done",
                    "request_id": request.request_id,
                    "answer": "".join(answer_parts).strip(),
                },
            )
        except WebSocketDisconnect:
            logger.info("Assistant websocket disconnected")
            break
        except ValidationError as exc:
            logger.warning("Invalid websocket payload: %s", exc)
            await safe_send_json(
                websocket,
                {
                    "type": "error",
                    "request_id": request_id,
                    "error": "Invalid assistant chat payload.",
                },
            )
        except Exception as exc:
            logger.exception("Assistant websocket error")
            await safe_send_json(
                websocket,
                {
                    "type": "error",
                    "request_id": request_id,
                    "error": str(exc) or "Assistant chat failed.",
                },
            )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

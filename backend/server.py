import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    client.close()


# Create the main app without a prefix
app = FastAPI(title="Memory Capsule API", lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")  # Ignore MongoDB's _id field
    
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
    mode: str = "local-first"
    description: str = "Privacy-first voice memory capture with on-device processing."
    assistant_available: bool = False
    payments_enabled: bool = False
    storage: str = "IndexedDB on-device"


class GenerateRequest(BaseModel):
    query: str
    context: str

# Add your routes to the router instead of directly to app
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
    
    # Convert to dict and serialize datetime to ISO string for MongoDB
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    # Exclude MongoDB's _id field from the query results
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps back to datetime objects
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    
    return status_checks


@api_router.post("/generate")
async def generate_with_claude(request: GenerateRequest):
    """
    Generate an answer using Claude API with streaming response
    """
    anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
    
    if not anthropic_api_key:
        logger.warning("ANTHROPIC_API_KEY not configured")
        return {"error": "Claude API not configured"}
    
    try:
        import anthropic
        
        client = anthropic.Anthropic(api_key=anthropic_api_key)
        
        prompt = f"""Based on these memories:

{request.context}

Answer this question: {request.query}

Provide a natural, conversational answer that synthesizes information from the memories. Keep it concise (2-3 sentences).

Answer:"""
        
        async def stream_response():
            with client.messages.stream(
                model="claude-3-5-sonnet-20241022",
                max_tokens=300,
                temperature=0.7,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            ) as stream:
                for text in stream.text_stream:
                    yield text
        
        return StreamingResponse(stream_response(), media_type="text/plain")
        
    except ImportError:
        logger.error("anthropic package not installed")
        return {"error": "Claude API client not available"}
    except Exception as e:
        logger.error(f"Claude API error: {e}")
        return {"error": str(e)}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
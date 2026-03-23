import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMemoryDate } from "@/lib/memory-utils";

const PROMPTS = [
  "What did I say about focus?",
  "Summarize my last week",
  "When was I most stressed?",
];

export default function AssistantPage({ memories, modelStatus, streamAssistantReply }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState([]);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const statusLabel = useMemo(() => {
    if (isSubmitting) {
      return "Thinking…";
    }

    return modelStatus?.label || "Ready";
  }, [isSubmitting, modelStatus?.label]);

  const runQuery = async (nextQuery) => {
    if (isSubmitting) {
      return;
    }

    const cleanedQuery = nextQuery.trim();
    if (!cleanedQuery) {
      return;
    }

    const turnId = `turn-${Date.now()}`;
    const userTurn = {
      id: `${turnId}-user`,
      role: "user",
      text: cleanedQuery,
    };
    const assistantTurn = {
      answer: "",
      id: `${turnId}-assistant`,
      isStreaming: true,
      references: [],
      role: "assistant",
    };

    setTurns((current) => [...current, userTurn, assistantTurn]);
    setQuery("");
    setIsSubmitting(true);

    try {
      const history = turns.slice(-8).map((turn) => ({
        content: turn.role === "assistant" ? turn.answer : turn.text,
        role: turn.role,
      }));

      const result = await streamAssistantReply({
        history,
        onChunk: (partialAnswer) => {
          setTurns((current) =>
            current.map((turn) =>
              turn.id === assistantTurn.id
                ? {
                    ...turn,
                    answer: partialAnswer,
                  }
                : turn,
            ),
          );
        },
        query: cleanedQuery,
      });

      setTurns((current) =>
        current.map((turn) =>
          turn.id === assistantTurn.id
            ? {
                ...turn,
                answer: result.answer,
                isStreaming: false,
                references: result.references || [],
              }
            : turn,
        ),
      );
    } catch (error) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === assistantTurn.id
            ? {
                ...turn,
                answer: error.message || "I couldn't finish that reply.",
                isError: true,
                isStreaming: false,
              }
            : turn,
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="page-enter pb-6" data-testid="assistant-page">
      <Card className="overflow-hidden rounded-[30px] border-[#E8E4DB] bg-[linear-gradient(180deg,rgba(253,251,247,0.96),rgba(245,239,232,0.9))] shadow-[0_18px_50px_rgba(26,25,24,0.06)]">
        <CardContent className="flex min-h-[70dvh] flex-col p-0">
          <div className="border-b border-[#E8E4DB] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="editorial-label" data-testid="assistant-input-label">
                  Assistant
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#4A4844]" data-testid="assistant-helper-text">
                  Ask a question and get an answer from your saved memories.
                </p>
              </div>
              <div className="rounded-full border border-[#E8E4DB] bg-white/75 px-3 py-2 text-xs text-[#4A4844]">
                {statusLabel}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" data-testid="assistant-history-list">
            {turns.length ? (
              turns.map((turn) =>
                turn.role === "user" ? (
                  <div className="flex justify-end" key={turn.id}>
                    <div className="max-w-[85%] rounded-[24px] rounded-br-[10px] bg-[#2A2928] px-4 py-3 text-sm leading-relaxed text-[#FDFBF7]">
                      {turn.text}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3" key={turn.id}>
                    <div
                      className={`max-w-[92%] rounded-[24px] rounded-bl-[10px] border px-4 py-4 ${
                        turn.isError ? "border-[#F0D8CF] bg-[#FBF2EF]" : "border-[#E8E4DB] bg-white/88"
                      }`}
                    >
                      <p className={`text-sm leading-relaxed ${turn.isError ? "text-[#8D4936]" : "text-[#1A1918]"}`}>
                        {turn.answer || "Thinking…"}
                      </p>
                    </div>

                    {turn.references?.length ? (
                      <div className="space-y-2">
                        {turn.references.map((reference) => (
                          <div
                            className="rounded-[20px] border border-[#E8E4DB] bg-[#F2EFE9] px-4 py-3"
                            data-testid={`assistant-reference-${reference.id}`}
                            key={`${turn.id}-${reference.id}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-[#1A1918]">{reference.summary}</p>
                              <span className="text-xs text-[#6F6A62]">{formatMemoryDate(reference.createdAt)}</span>
                            </div>
                            <p className="mt-2 text-sm leading-relaxed text-[#4A4844]">{reference.transcript}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ),
              )
            ) : (
              <div className="flex h-full flex-col justify-center gap-4 px-2 py-8">
                <div className="rounded-[24px] border border-dashed border-[#DDD5C8] bg-white/52 p-5 text-sm leading-relaxed text-[#6F6A62]">
                  Start a conversation with your assistant.
                </div>
                <div className="flex flex-wrap gap-2">
                  {PROMPTS.map((prompt) => (
                    <button
                      className="rounded-full border border-[#E8E4DB] bg-white/75 px-3 py-2 text-xs text-[#4A4844] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white"
                      data-testid={`assistant-prompt-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      key={prompt}
                      onClick={() => void runQuery(prompt)}
                      type="button"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[#E8E4DB] bg-white/55 px-4 py-4">
            <form
              className="flex items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void runQuery(query);
              }}
            >
              <Input
                className="h-12 rounded-2xl border-[#E8E4DB] bg-white px-4 text-sm"
                data-testid="assistant-query-input"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={memories.length ? "Message the assistant" : "Record a memory to start chatting"}
                value={query}
              />
              <Button
                className="h-12 rounded-2xl bg-[#2A2928] px-5 text-[#FDFBF7] hover:bg-[#1A1918]"
                data-testid="assistant-query-submit-button"
                disabled={isSubmitting || !memories.length}
                type="submit"
              >
                {isSubmitting ? "…" : "Send"}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

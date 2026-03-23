import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMemoryDate, formatRelativeMemoryTime } from "@/lib/memory-utils";

const PROMPTS = [
  "What did I say about focus?",
  "Summarize my last week",
  "When was I most stressed?",
];

export default function AssistantPage({ memories, modelStatus, streamAssistantReply }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState([]);

  const assistantStateLabel = useMemo(() => {
    if (isSubmitting) {
      return "Streaming an answer from your memory assistant…";
    }

    return modelStatus?.label || "Ready when you are.";
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
      timestamp: new Date().toISOString(),
    };
    const assistantTurn = {
      answer: "",
      id: `${turnId}-assistant`,
      isStreaming: true,
      references: [],
      role: "assistant",
      timestamp: new Date().toISOString(),
    };

    const nextTurns = [...turns, userTurn, assistantTurn];
    setTurns(nextTurns);
    setQuery("");
    setIsSubmitting(true);

    try {
      const history = turns
        .slice(-8)
        .map((turn) => ({
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
                answer: error.message || "The assistant could not finish the reply.",
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
    <section className="page-enter space-y-5 pb-6" data-testid="assistant-page">
      <Card className="rounded-[30px] border-[#E8E4DB] bg-[linear-gradient(180deg,rgba(253,251,247,0.94),rgba(245,239,232,0.88))] shadow-[0_18px_50px_rgba(26,25,24,0.06)]">
        <CardContent className="space-y-5 p-5">
          <div>
            <p className="editorial-label" data-testid="assistant-input-label">
              Chat Assistant
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#4A4844]" data-testid="assistant-helper-text">
              Type naturally, and the backend assistant will answer from the most relevant memories saved on this device.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[#E8E4DB] bg-white/70 px-3 py-2 text-xs text-[#4A4844]">
              {assistantStateLabel}
            </span>
            <span className="rounded-full border border-[#E8E4DB] bg-white/70 px-3 py-2 text-xs text-[#4A4844]">
              {memories.length ? `${memories.length} memories available` : "Record a memory to start chatting"}
            </span>
          </div>

          <form
            className="flex gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void runQuery(query);
            }}
          >
            <Input
              className="h-12 rounded-2xl border-[#E8E4DB] bg-white/78 px-4 text-sm"
              data-testid="assistant-query-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask about your memories"
              value={query}
            />
            <Button
              className="h-12 rounded-2xl bg-[#2A2928] px-5 text-[#FDFBF7] hover:bg-[#1A1918]"
              data-testid="assistant-query-submit-button"
              disabled={isSubmitting || !memories.length}
              type="submit"
            >
              {isSubmitting ? "Thinking" : "Send"}
            </Button>
          </form>

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
        </CardContent>
      </Card>

      <Card className="rounded-[30px] border-[#E8E4DB] bg-[#FDFBF7]/88 shadow-[0_10px_36px_rgba(26,25,24,0.05)]" data-testid="assistant-chat-card">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label">Conversation</p>
            <p className="mt-2 text-sm leading-relaxed text-[#4A4844]">
              The browser retrieves relevant memories locally, then the backend streams a grounded reply using only that shared context.
            </p>
          </div>

          <div className="space-y-4" data-testid="assistant-history-list">
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
                        turn.isError
                          ? "border-[#F0D8CF] bg-[#FBF2EF]"
                          : "border-[#E8E4DB] bg-white/80"
                      }`}
                    >
                      <p className={`text-sm leading-relaxed ${turn.isError ? "text-[#8D4936]" : "text-[#1A1918]"}`}>
                        {turn.answer || "Thinking…"}
                      </p>
                      <p className="mt-3 text-xs text-[#6F6A62]">
                        {turn.isStreaming ? "Streaming…" : formatRelativeMemoryTime(turn.timestamp)}
                      </p>
                    </div>

                    {turn.references?.length ? (
                      <div className="space-y-3" data-testid={`assistant-references-${turn.id}`}>
                        {turn.references.map((reference) => (
                          <div
                            className="rounded-[22px] bg-[#F2EFE9] p-4"
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
              <div className="rounded-[24px] border border-dashed border-[#DDD5C8] bg-white/52 p-4 text-sm leading-relaxed text-[#6F6A62]">
                Start with a typed question and the assistant will answer here.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

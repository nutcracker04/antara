import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMemoryDate } from "@/lib/memory-utils";

const PROMPTS = ["What did I say about focus?", "Summarize my last week", "When was I most stressed?"];

export default function AssistantPage({ askAssistant, memories }) {
  const [answer, setAnswer] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [references, setReferences] = useState([]);

  const runQuery = async (nextQuery) => {
    setIsLoading(true);
    try {
      const result = await askAssistant(nextQuery);
      setAnswer(result.answer);
      setReferences(result.references || []);
      setQuery(nextQuery);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="page-enter space-y-5 pb-6" data-testid="assistant-page">
      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label" data-testid="assistant-input-label">
              Ask naturally
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[#4A4844]" data-testid="assistant-helper-text">
              Ask about people, feelings, topics, or timeframes and Memory Capsule will surface the closest moments.
            </p>
          </div>

          <div className="flex gap-3">
            <Input
              className="h-12 rounded-2xl border-[#E8E4DB] bg-white/70 px-4 text-sm"
              data-testid="assistant-query-input"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask about people, moments, or feelings"
              value={query}
            />
            <Button
              className="h-12 rounded-2xl bg-[#2A2928] px-5 text-[#FDFBF7] hover:bg-[#1A1918]"
              data-testid="assistant-query-submit-button"
              disabled={isLoading || !memories.length}
              onClick={() => runQuery(query)}
              type="button"
            >
              {isLoading ? "Looking" : "Ask"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {PROMPTS.map((prompt) => (
              <button
                className="rounded-full border border-[#E8E4DB] bg-white/70 px-3 py-2 text-xs text-[#4A4844] transition-transform duration-200 hover:-translate-y-0.5"
                data-testid={`assistant-prompt-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                key={prompt}
                onClick={() => runQuery(prompt)}
                type="button"
              >
                {prompt}
              </button>
            ))}
          </div>

          <p className="text-xs text-[#6F6A62]" data-testid="assistant-memory-count-copy">
            {memories.length ? `${memories.length} memories ready to search` : "Save a memory to start asking questions"}
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]" data-testid="assistant-answer-card">
        <CardContent className="space-y-4 p-5">
          <div>
            <p className="editorial-label" data-testid="assistant-answer-label">
              Answer
            </p>
            <p className="mt-3 text-base leading-relaxed text-[#1A1918]" data-testid="assistant-answer-text">
              {answer || "Ask a question and your answer will appear here with the moments it came from."}
            </p>
          </div>

          <div className="space-y-3" data-testid="assistant-references-list">
            {references.map((reference) => (
              <div className="rounded-[22px] bg-[#F2EFE9] p-4" data-testid={`assistant-reference-${reference.id}`} key={reference.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-[#1A1918]">{reference.summary}</p>
                  <span className="text-xs text-[#6F6A62]">{formatMemoryDate(reference.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#4A4844]">{reference.transcript}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
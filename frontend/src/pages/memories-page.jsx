import { useMemo, useState } from "react";

import { MemoryCard } from "@/components/ui/memory-card";
import { Input } from "@/components/ui/input";

const EMOTION_FILTERS = ["all", "calm", "energetic", "sad"];
const DATE_FILTERS = ["all", "today", "week"];

export default function MemoriesPage({ isLoading, memories, preferences }) {
  const [keyword, setKeyword] = useState("");
  const [emotionFilter, setEmotionFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const filteredMemories = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return memories.filter((memory) => {
      const matchesKeyword =
        !keyword.trim() ||
        memory.transcript.toLowerCase().includes(keyword.toLowerCase()) ||
        memory.tags.some((tag) => tag.includes(keyword.toLowerCase()));

      const matchesEmotion = emotionFilter === "all" || memory.emotion === emotionFilter;

      const createdAt = new Date(memory.createdAt).getTime();
      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "today" && createdAt >= todayStart.getTime()) ||
        (dateFilter === "week" && createdAt >= now - 7 * 24 * 60 * 60 * 1000);

      return matchesKeyword && matchesEmotion && matchesDate;
    });
  }, [dateFilter, emotionFilter, keyword, memories]);

  return (
    <section className="page-enter space-y-5 pb-6" data-testid="memories-page">
      <div className="glass-panel rounded-[28px] p-5">
        <div className="space-y-4">
          <div>
            <p className="editorial-label" data-testid="memory-search-label">
              Search memories
            </p>
            <Input
              className="mt-3 h-12 rounded-2xl border-[#E8E4DB] bg-white/70 px-4 text-sm text-[#1A1918] placeholder:text-[#8C8881]"
              data-testid="memory-search-input"
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Search transcript or tag"
              value={keyword}
            />
          </div>

          <div className="space-y-3">
            <div>
              <p className="editorial-label" data-testid="emotion-filter-label">
                Emotion
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {EMOTION_FILTERS.map((filter) => (
                  <button
                    className={`rounded-full px-3 py-2 text-xs font-semibold capitalize transition-transform duration-200 ${
                      emotionFilter === filter ? "bg-[#2A2928] text-[#FDFBF7]" : "bg-white/70 text-[#4A4844]"
                    }`}
                    data-testid={`emotion-filter-${filter}`}
                    key={filter}
                    onClick={() => setEmotionFilter(filter)}
                    type="button"
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="editorial-label" data-testid="date-filter-label">
                Date range
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DATE_FILTERS.map((filter) => (
                  <button
                    className={`rounded-full px-3 py-2 text-xs font-semibold capitalize transition-transform duration-200 ${
                      dateFilter === filter ? "bg-[#2A2928] text-[#FDFBF7]" : "bg-white/70 text-[#4A4844]"
                    }`}
                    data-testid={`date-filter-${filter}`}
                    key={filter}
                    onClick={() => setDateFilter(filter)}
                    type="button"
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4" data-testid="memory-results-header">
        <p className="text-sm text-[#4A4844]">
          {isLoading ? "Opening your memory library…" : `${filteredMemories.length} memories match your view.`}
        </p>
        <p className="text-xs text-[#6F6A62]" data-testid="memory-results-preference-copy">
          {preferences.showSummariesFirst ? "Summaries lead each memory card" : "Full transcripts take the lead"}
        </p>
      </div>

      <div className="space-y-4" data-testid="memory-results-list">
        {!isLoading && !filteredMemories.length ? (
          <div className="glass-panel rounded-[28px] p-5" data-testid="memories-empty-state">
            <p className="text-lg text-[#1A1918]">No memories match that view.</p>
            <p className="mt-2 text-sm leading-relaxed text-[#4A4844]">Try a different keyword or loosen the filters to see more of your saved voice notes.</p>
          </div>
        ) : null}

        {filteredMemories.map((memory) => (
          <MemoryCard key={memory.id} memory={memory} showSummariesFirst={preferences.showSummariesFirst} />
        ))}
      </div>
    </section>
  );
}
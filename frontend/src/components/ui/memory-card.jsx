import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMemoryDate, formatRelativeMemoryTime } from "@/lib/memory-utils";

const EMOTION_STYLES = {
  calm: "bg-[#E8F0EB] text-[#355445] border-[#D5E2DA]",
  energetic: "bg-[#F5E7E2] text-[#8D4936] border-[#EFD4CA]",
  sad: "bg-[#ECEAF4] text-[#5B5776] border-[#DDD9EC]",
};

export function MemoryCard({ memory, showSummariesFirst = true }) {
  const [audioUrl, setAudioUrl] = useState("");

  useEffect(() => {
    if (!memory.audioBlob) {
      return undefined;
    }

    const nextAudioUrl = URL.createObjectURL(memory.audioBlob);
    setAudioUrl(nextAudioUrl);

    return () => URL.revokeObjectURL(nextAudioUrl);
  }, [memory.audioBlob]);

  return (
    <Card className="page-enter rounded-[28px] border-[#E8E4DB] bg-[#FDFBF7]/85 shadow-[0_8px_32px_rgba(26,25,24,0.04)]" data-testid={`memory-card-${memory.id}`}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="editorial-label" data-testid={`memory-card-label-${memory.id}`}>
              {formatMemoryDate(memory.createdAt)}
            </p>
            <p className="text-sm text-[#6F6A62]" data-testid={`memory-card-relative-time-${memory.id}`}>
              {formatRelativeMemoryTime(memory.createdAt)}
            </p>
          </div>

          <Badge className={`${EMOTION_STYLES[memory.emotion] || EMOTION_STYLES.calm} rounded-full border px-3 py-1 capitalize`} data-testid={`memory-card-emotion-${memory.id}`} variant="outline">
            {memory.emotion}
          </Badge>
        </div>

        {showSummariesFirst ? (
          <div className="space-y-2">
            <p className="text-lg leading-relaxed text-[#1A1918]" data-testid={`memory-card-summary-${memory.id}`}>
              {memory.summary}
            </p>
            <p className="text-sm leading-relaxed text-[#4A4844]" data-testid={`memory-card-transcript-${memory.id}`}>
              {memory.transcript}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-[#4A4844]" data-testid={`memory-card-transcript-${memory.id}`}>
              {memory.transcript}
            </p>
            <p className="text-lg leading-relaxed text-[#1A1918]" data-testid={`memory-card-summary-${memory.id}`}>
              {memory.summary}
            </p>
          </div>
        )}

        {audioUrl ? (
          <audio className="w-full" controls data-testid={`memory-card-audio-${memory.id}`} src={audioUrl} />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {memory.tags.map((tag) => (
            <span className="rounded-full bg-[#F2EFE9] px-3 py-1 text-xs text-[#4A4844]" data-testid={`memory-card-tag-${memory.id}-${tag}`} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
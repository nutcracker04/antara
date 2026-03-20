import { format, formatDistanceToNowStrict, isWithinInterval, subDays } from "date-fns";

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "because",
  "could",
  "from",
  "have",
  "into",
  "just",
  "really",
  "said",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "with",
  "would",
  "your",
]);

const STRESS_WORDS = /(stress|stressed|anxious|pressure|urgent|panic|overwhelmed|deadline|worried|tense)/i;
const SAD_WORDS = /(sad|tired|lonely|cry|miss|grief|hurt|low|down|heavy)/i;
const CALM_WORDS = /(calm|steady|peaceful|gentle|rested|grateful|quiet|soft|breathe)/i;

export function sortMemoriesByNewest(memories) {
  return [...memories].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function detectEmotion(text, energy = 0.2) {
  if (SAD_WORDS.test(text)) {
    return "sad";
  }

  if (STRESS_WORDS.test(text) || energy > 0.42) {
    return "energetic";
  }

  if (CALM_WORDS.test(text)) {
    return "calm";
  }

  return energy > 0.28 ? "energetic" : "calm";
}

export function summarizeTranscript(text) {
  const cleaned = text.trim();
  if (!cleaned) {
    return "A short captured thought.";
  }

  const sentence = cleaned.split(/[.!?]/).find(Boolean)?.trim();
  if (sentence && sentence.length <= 120) {
    return sentence;
  }

  return cleaned.split(/\s+/).slice(0, 18).join(" ") + (cleaned.split(/\s+/).length > 18 ? "…" : "");
}

export function buildTags(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  return [...new Set(words)].slice(0, 4);
}

export function formatMemoryDate(timestamp) {
  return format(new Date(timestamp), "MMM d · h:mm a");
}

export function formatRelativeMemoryTime(timestamp) {
  return formatDistanceToNowStrict(new Date(timestamp), { addSuffix: true });
}

export function cosineSimilarity(left = [], right = []) {
  if (!left.length || !right.length || left.length !== right.length) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator ? dotProduct / denominator : 0;
}

export function vectorSearch(queryEmbedding, memories, limit = 5) {
  return memories
    .filter((memory) => Array.isArray(memory.embedding) && memory.embedding.length)
    .map((memory) => ({
      ...memory,
      score: cosineSimilarity(queryEmbedding, memory.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function summarizeCollection(memories) {
  return memories
    .slice(0, 4)
    .map((memory) => memory.summary)
    .join(" ");
}

function toReference(memory) {
  return {
    id: memory.id,
    summary: memory.summary,
    transcript: memory.transcript,
    emotion: memory.emotion,
    createdAt: memory.createdAt,
    score: memory.score,
  };
}

export function buildAssistantResponse(query, matches, allMemories) {
  const cleanedQuery = query.trim().toLowerCase();

  if (!allMemories.length) {
    return {
      answer: "You have not saved any memories yet. Record something first, then ask again.",
      references: [],
    };
  }

  if (cleanedQuery.includes("last week")) {
    const weeklyMemories = allMemories.filter((memory) =>
      isWithinInterval(new Date(memory.createdAt), {
        start: subDays(new Date(), 7),
        end: new Date(),
      }),
    );

    if (!weeklyMemories.length) {
      return {
        answer: "I could not find any memories from the last week yet.",
        references: [],
      };
    }

    const energeticCount = weeklyMemories.filter((memory) => memory.emotion === "energetic").length;
    const calmCount = weeklyMemories.filter((memory) => memory.emotion === "calm").length;

    return {
      answer: `Over the last week, you captured ${weeklyMemories.length} memories. The strongest pattern was ${energeticCount > calmCount ? "high-energy moments" : "steadier, calmer reflections"}. ${summarizeCollection(weeklyMemories)}`,
      references: weeklyMemories.slice(0, 3).map(toReference),
    };
  }

  if (STRESS_WORDS.test(cleanedQuery)) {
    const stressedMemories = allMemories.filter(
      (memory) => memory.emotion === "energetic" || STRESS_WORDS.test(memory.transcript),
    );

    return {
      answer: stressedMemories.length
        ? `I found ${stressedMemories.length} memories that sound more pressured or intense. The most recent ones cluster around ${summarizeCollection(stressedMemories)}.`
        : "I did not find a clear stress pattern in your saved memories yet.",
      references: stressedMemories.slice(0, 3).map(toReference),
    };
  }

  if (cleanedQuery.includes("summarize") || cleanedQuery.includes("summary") || cleanedQuery.includes("overview")) {
    const summaryMatches = matches.length ? matches : allMemories.slice(0, 4);

    return {
      answer: `Here is your local summary: ${summarizeCollection(summaryMatches)}`,
      references: summaryMatches.slice(0, 3).map(toReference),
    };
  }

  if (matches.length) {
    return {
      answer: `I found ${matches.length} close memories for “${query.trim()}”. The clearest one says: ${matches[0].summary}`,
      references: matches.slice(0, 3).map(toReference),
    };
  }

  return {
    answer: "I could not find a close local match yet. Try a more specific person, place, feeling, or timeframe.",
    references: [],
  };
}
import { format, formatDistanceToNowStrict, isWithinInterval, subDays } from "date-fns";
import { BM25, reciprocalRankFusion } from "./bm25";

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

// BM25 cache to avoid recomputing IDF on every query
let bm25Cache = null;
let bm25CacheKey = null;

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

/**
 * Hybrid retrieval: Vector search + BM25 + RRF
 */
export function hybridSearch(queryEmbedding, query, memories, limit = 10) {
  if (!memories.length) {
    return [];
  }

  // Vector search (semantic similarity)
  const vectorResults = vectorSearch(queryEmbedding, memories, limit);

  // BM25 search (lexical keyword matching) - with caching
  const lastMemory = memories[memories.length - 1];
  const cacheKey = `${memories.length}-${lastMemory?.createdAt || ""}`;
  if (!bm25Cache || bm25CacheKey !== cacheKey) {
    bm25Cache = new BM25(memories);
    bm25CacheKey = cacheKey;
    console.log("[BM25] Cache rebuilt for", memories.length, "memories");
  }
  
  const bm25Results = bm25Cache.search(query, limit);

  // Merge using Reciprocal Rank Fusion
  const fusedResults = reciprocalRankFusion([vectorResults, bm25Results]);

  return fusedResults.slice(0, limit);
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

export function getAssistantReferences(query, queryEmbedding, allMemories) {
  const cleanedQuery = query.trim().toLowerCase();

  if (!allMemories.length) {
    return [];
  }

  const matches = hybridSearch(queryEmbedding, query, allMemories, 10);

  if (cleanedQuery.includes("last week")) {
    const weeklyMemories = allMemories.filter((memory) =>
      isWithinInterval(new Date(memory.createdAt), {
        start: subDays(new Date(), 7),
        end: new Date(),
      }),
    );

    if (!weeklyMemories.length) {
      return [];
    }

    return weeklyMemories.slice(0, 4).map(toReference);
  }

  if (STRESS_WORDS.test(cleanedQuery)) {
    const stressedMemories = allMemories.filter(
      (memory) => memory.emotion === "energetic" || STRESS_WORDS.test(memory.transcript),
    );

    if (!stressedMemories.length) {
      return [];
    }

    return stressedMemories.slice(0, 4).map(toReference);
  }

  if (matches.length) {
    return matches.slice(0, 4).map(toReference);
  }

  return [];
}

export function buildAssistantFallback(query, references) {
  if (references.length) {
    return `I found ${references.length} relevant memories for "${query.trim()}". The clearest one says: ${references[0].summary}`;
  }

  return {
    answer: "I could not find a close local match yet. Try a more specific person, place, feeling, or timeframe.",
    references: [],
  }.answer;
}

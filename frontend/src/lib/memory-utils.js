import { format, formatDistanceToNowStrict, isWithinInterval, subDays } from "date-fns";
import { BM25, reciprocalRankFusion } from "./bm25";
import { generateAnswer } from "./rag-generator";

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

export async function buildAssistantResponse(query, queryEmbedding, allMemories) {
  const cleanedQuery = query.trim().toLowerCase();

  if (!allMemories.length) {
    return {
      answer: "You have not saved any memories yet. Record something first, then ask again.",
      references: [],
    };
  }

  // Use hybrid retrieval (vector + BM25 + RRF)
  const matches = hybridSearch(queryEmbedding, query, allMemories, 10);

  // Handle special cases with LLM-powered responses
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

    // Use LLM to synthesize weekly summary
    try {
      const topWeekly = weeklyMemories.slice(0, 3);
      const generatedAnswer = await generateAnswer(query, topWeekly);
      return {
        answer: generatedAnswer,
        references: topWeekly.map(toReference),
      };
    } catch (error) {
      // Fallback to rule-based
      const energeticCount = weeklyMemories.filter((memory) => memory.emotion === "energetic").length;
      const calmCount = weeklyMemories.filter((memory) => memory.emotion === "calm").length;

      return {
        answer: `Over the last week, you captured ${weeklyMemories.length} memories. The strongest pattern was ${energeticCount > calmCount ? "high-energy moments" : "steadier, calmer reflections"}. ${summarizeCollection(weeklyMemories)}`,
        references: weeklyMemories.slice(0, 3).map(toReference),
      };
    }
  }

  if (STRESS_WORDS.test(cleanedQuery)) {
    const stressedMemories = allMemories.filter(
      (memory) => memory.emotion === "energetic" || STRESS_WORDS.test(memory.transcript),
    );

    if (!stressedMemories.length) {
      return {
        answer: "I did not find a clear stress pattern in your saved memories yet.",
        references: [],
      };
    }

    // Use LLM to synthesize stress pattern analysis
    try {
      const topStressed = stressedMemories.slice(0, 3);
      const generatedAnswer = await generateAnswer(query, topStressed);
      return {
        answer: generatedAnswer,
        references: topStressed.map(toReference),
      };
    } catch (error) {
      // Fallback to rule-based
      return {
        answer: `I found ${stressedMemories.length} memories that sound more pressured or intense. The most recent ones cluster around ${summarizeCollection(stressedMemories)}.`,
        references: stressedMemories.slice(0, 3).map(toReference),
      };
    }
  }

  // For general queries, use LLM generation with top-3 retrieved memories
  if (matches.length >= 3) {
    const topMemories = matches.slice(0, 3);

    try {
      const generatedAnswer = await generateAnswer(query, topMemories);

      return {
        answer: generatedAnswer,
        references: topMemories.map(toReference),
      };
    } catch (error) {
      console.warn("[RAG] LLM generation failed, falling back to rule-based:", error);
      // Fall through to rule-based response
    }
  }

  // Fallback to rule-based responses
  if (matches.length) {
    return {
      answer: `I found ${matches.length} close memories for "${query.trim()}". The clearest one says: ${matches[0].summary}`,
      references: matches.slice(0, 3).map(toReference),
    };
  }

  return {
    answer: "I could not find a close local match yet. Try a more specific person, place, feeling, or timeframe.",
    references: [],
  };
}

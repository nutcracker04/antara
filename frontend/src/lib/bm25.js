/**
 * BM25 (Best Matching 25) - Lexical keyword matching for hybrid retrieval
 * Complements vector search by catching exact keyword matches
 */

const STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "also", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "but", "by", "can", "could", "did", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "here", "him", "his", "how",
  "i", "if", "in", "into", "is", "it", "its", "just", "like", "me", "my",
  "no", "not", "of", "on", "or", "our", "out", "over", "said", "she", "so", "some",
  "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "to",
  "up", "us", "was", "we", "were", "what", "when", "where", "which", "who", "will", "with",
  "would", "you", "your",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function computeIDF(documents) {
  const N = documents.length;
  const df = new Map(); // document frequency

  for (const doc of documents) {
    const uniqueTerms = new Set(doc.tokens);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const idf = new Map();
  for (const [term, freq] of df.entries()) {
    // IDF formula: log((N - df + 0.5) / (df + 0.5) + 1)
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }

  return idf;
}

export class BM25 {
  constructor(documents, k1 = 1.5, b = 0.75) {
    this.k1 = k1; // term frequency saturation parameter
    this.b = b;   // length normalization parameter
    
    // Preprocess documents
    this.documents = documents.map((doc) => ({
      ...doc,
      tokens: tokenize(doc.transcript || doc.summary || ""),
    }));

    // Compute average document length
    const totalLength = this.documents.reduce((sum, doc) => sum + doc.tokens.length, 0);
    this.avgDocLength = totalLength / this.documents.length || 1;

    // Compute IDF scores
    this.idf = computeIDF(this.documents);
  }

  search(query, limit = 10) {
    const queryTokens = tokenize(query);
    
    if (queryTokens.length === 0) {
      return [];
    }

    const scores = this.documents.map((doc) => {
      let score = 0;
      const docLength = doc.tokens.length;

      for (const term of queryTokens) {
        const idfScore = this.idf.get(term) || 0;
        const termFreq = doc.tokens.filter((t) => t === term).length;

        // BM25 formula
        const numerator = termFreq * (this.k1 + 1);
        const denominator = termFreq + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        
        score += idfScore * (numerator / denominator);
      }

      return { ...doc, score };
    });

    return scores
      .filter((doc) => doc.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/**
 * Reciprocal Rank Fusion (RRF) - Combines ranked lists from multiple sources
 * Formula: 1 / (k + rank) where k=60 is standard
 */
export function reciprocalRankFusion(rankedLists, k = 60) {
  const scoreMap = new Map();

  for (const rankedList of rankedLists) {
    rankedList.forEach((item, index) => {
      const rank = index + 1;
      const rrfScore = 1 / (k + rank);
      
      const existing = scoreMap.get(item.id) || { item, score: 0 };
      existing.score += rrfScore;
      scoreMap.set(item.id, existing);
    });
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map(({ item, score }) => ({ ...item, score }));
}

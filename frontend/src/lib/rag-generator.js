/**
 * RAG Generation - LLM-powered answer generation with retrieved context
 * Tiered strategy: Gemini Nano (on-device) → WebLLM (Qwen2.5-0.5B) → Rule-based fallback
 */

async function isWebGPUReliable() {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return false;
    const info = await adapter.requestAdapterInfo();
    // Skip on known problematic mobile GPU vendors
    const isMobile = /android/i.test(navigator.userAgent);
    if (isMobile && !info.vendor) return false;
    return true;
  } catch {
    return false;
  }
}

function getLanguageModel() {
  if (typeof window === "undefined" || !window.ai?.languageModel) {
    return null;
  }
  return window.ai.languageModel;
}

async function isGeminiNanoAvailable() {
  const lm = getLanguageModel();
  if (!lm?.capabilities) {
    return false;
  }

  try {
    const capabilities = await lm.capabilities();
    return capabilities?.available !== "no";
  } catch {
    return false;
  }
}

async function generateWithGeminiNano(query, memories) {
  const lm = getLanguageModel();
  if (!lm?.create) {
    return null;
  }

  let session;
  try {
    session = await lm.create({
      temperature: 0.7,
      topK: 5,
    });

    const memoryContext = memories
      .map((m, i) => `Memory ${i + 1}: ${(m.transcript || m.summary || "").slice(0, 300)}`)
      .join("\n");

    const prompt = `Based on these memories:

${memoryContext}

Answer this question: ${query}

Provide a natural, conversational answer that synthesizes information from the memories. Keep it concise (2-3 sentences).

Answer:`;

    const answer = await session.prompt(prompt);
    return typeof answer === "string" ? answer.trim() : null;
  } catch (error) {
    console.warn("[RAG] Gemini Nano generation failed:", error);
    return null;
  } finally {
    if (session?.destroy) {
      try {
        await session.destroy();
      } catch {
        /* ignore */
      }
    }
  }
}

async function generateWithWebLLM(query, memories) {
  if (!(await isWebGPUReliable())) return null;

  try {
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    const engine = await CreateMLCEngine("Qwen2.5-0.5B-Instruct-q4f16_1", {
      initProgressCallback: (p) => {
        console.log(`[WebLLM] ${p.text}`);
      },
    });

    const context = memories
      .map((m, i) => `Memory ${i + 1}: ${(m.transcript || m.summary || "").slice(0, 300)}`)
      .join("\n");

    const stream = await engine.chat.completions.create({
      messages: [
        { role: "system", content: "You are a personal memory assistant. Answer only from the provided memories. Be brief and conversational." },
        { role: "user", content: `Memories:\n${context}\n\nQuestion: ${query}` }
      ],
      stream: true,
      max_tokens: 150,
    });

    let answer = "";
    for await (const chunk of stream) {
      answer += chunk.choices[0]?.delta?.content || "";
    }
    return answer.trim() || null;
  } catch (error) {
    console.warn("[RAG] WebLLM generation failed:", error);
    return null;
  }
}

/**
 * Generate an answer using LLM with retrieved memory context
 * @param {string} query - User's question
 * @param {Array} memories - Top-k retrieved memories
 * @returns {Promise<string>} Generated answer
 */
export async function generateAnswer(query, memories) {
  if (!memories || memories.length === 0) {
    throw new Error("No memories provided for generation");
  }

  // Truncate context to prevent exceeding context windows
  const truncatedMemories = memories.map(m => ({
    ...m,
    transcript: (m.transcript || "").slice(0, 300),
  }));

  // Try Gemini Nano first (free, on-device)
  if (await isGeminiNanoAvailable()) {
    const nanoAnswer = await generateWithGeminiNano(query, truncatedMemories);
    if (nanoAnswer) {
      console.log("[RAG] Generated answer with Gemini Nano");
      return nanoAnswer;
    }
  }

  // Try WebLLM second (on-device, requires WebGPU)
  const webllmAnswer = await generateWithWebLLM(query, truncatedMemories);
  if (webllmAnswer) {
    console.log("[RAG] Generated answer with WebLLM");
    return webllmAnswer;
  }

  // If both fail, throw to trigger rule-based fallback
  throw new Error("LLM generation unavailable");
}

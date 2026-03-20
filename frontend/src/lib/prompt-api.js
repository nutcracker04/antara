import { summarizeTranscript } from "@/lib/memory-utils";

function getLanguageModel() {
  if (typeof window === "undefined" || !window.ai?.languageModel) {
    return null;
  }

  return window.ai.languageModel;
}

export async function isPromptApiAvailable() {
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

export async function summarizeWithPromptApi(transcript) {
  const lm = getLanguageModel();
  if (!lm?.create) {
    return { summary: summarizeTranscript(transcript), source: "rule-based" };
  }

  let session;
  try {
    const capabilities = await lm.capabilities();
    if (capabilities?.available === "no") {
      return { summary: summarizeTranscript(transcript), source: "rule-based" };
    }

    session = await lm.create({
      temperature: 0.7,
      topK: 3,
    });

    const prompt = `Summarize this voice memory in 1-2 concise sentences. Focus on the key point or emotion:

"${transcript}"

Summary:`;

    const summary = await session.prompt(prompt);
    const trimmed = typeof summary === "string" ? summary.trim() : summarizeTranscript(transcript);

    return {
      summary: trimmed || summarizeTranscript(transcript),
      source: "gemini-nano",
    };
  } catch {
    return { summary: summarizeTranscript(transcript), source: "rule-based" };
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

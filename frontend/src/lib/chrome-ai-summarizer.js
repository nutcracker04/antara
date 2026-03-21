/**
 * Chrome Built-in AI Summarizer (Gemini Nano)
 * Available in Chrome 2026+ - provides free on-device summarization
 * Use this before sending to cloud LLMs to save API credits
 */

export class ChromeAISummarizer {
  constructor() {
    this.summarizer = null;
    this.capabilities = null;
  }

  /**
   * Check if the built-in AI summarizer is available
   * @returns {Promise<{available: boolean, reason?: string}>}
   */
  async checkAvailability() {
    // IMPORTANT: window.ai is only available in Secure Contexts (HTTPS or localhost)
    if (!window.isSecureContext) {
      return {
        available: false,
        reason: 'Chrome Built-in AI requires HTTPS or localhost (Secure Context).'
      };
    }

    if (!window.ai?.summarizer) {
      return {
        available: false,
        reason: 'Chrome Built-in AI not available. Requires Chrome 2026+ with AI features enabled.'
      };
    }

    try {
      this.capabilities = await window.ai.summarizer.capabilities();
      
      if (this.capabilities.available === 'no') {
        return {
          available: false,
          reason: 'Summarizer not available on this device.'
        };
      }

      if (this.capabilities.available === 'after-download') {
        return {
          available: true,
          needsDownload: true,
          reason: 'Summarizer available but needs to download model first.'
        };
      }

      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason: `Error checking availability: ${error.message}`
      };
    }
  }

  /**
   * Initialize the summarizer
   * @param {Object} options - Summarizer options
   * @param {string} options.type - 'tl;dr' | 'key-points' | 'teaser' | 'headline'
   * @param {string} options.format - 'plain-text' | 'markdown'
   * @param {string} options.length - 'short' | 'medium' | 'long'
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
    const availability = await this.checkAvailability();
    
    if (!availability.available) {
      throw new Error(availability.reason);
    }

    const defaultOptions = {
      type: 'tl;dr',
      format: 'plain-text',
      length: 'medium'
    };

    this.summarizer = await window.ai.summarizer.create({
      ...defaultOptions,
      ...options
    });
  }

  /**
   * Summarize text using the built-in AI
   * @param {string} text - Text to summarize
   * @param {Object} options - Optional summarizer options (will reinitialize if different)
   * @returns {Promise<string>} - Summary text
   */
  async summarize(text, options = null) {
    if (!text || text.trim().length === 0) {
      throw new Error('No text provided for summarization');
    }

    // Initialize if not already done, or reinitialize with new options
    if (!this.summarizer || options) {
      await this.initialize(options);
    }

    try {
      const summary = await this.summarizer.summarize(text);
      return summary;
    } catch (error) {
      throw new Error(`Summarization failed: ${error.message}`);
    }
  }

  /**
   * Summarize with streaming (for long texts)
   * @param {string} text - Text to summarize
   * @param {Function} onChunk - Callback for each chunk
   * @param {Object} options - Optional summarizer options
   * @returns {Promise<string>} - Complete summary
   */
  async summarizeStreaming(text, onChunk, options = null) {
    if (!this.summarizer || options) {
      await this.initialize(options);
    }

    try {
      const stream = await this.summarizer.summarizeStreaming(text);
      let fullSummary = '';

      for await (const chunk of stream) {
        fullSummary = chunk;
        if (onChunk) {
          onChunk(chunk);
        }
      }

      return fullSummary;
    } catch (error) {
      throw new Error(`Streaming summarization failed: ${error.message}`);
    }
  }

  /**
   * Destroy the summarizer instance
   */
  destroy() {
    if (this.summarizer) {
      this.summarizer.destroy();
      this.summarizer = null;
    }
  }
}

/**
 * Quick helper function for one-off summarization
 * @param {string} text - Text to summarize
 * @param {Object} options - Summarizer options
 * @returns {Promise<string>} - Summary
 */
export async function quickSummarize(text, options = {}) {
  const summarizer = new ChromeAISummarizer();
  try {
    const summary = await summarizer.summarize(text, options);
    return summary;
  } finally {
    summarizer.destroy();
  }
}

/**
 * Example usage in your memory capsule flow:
 * 
 * // After transcription, before sending to cloud LLM
 * const transcription = "... long transcription text ...";
 * 
 * try {
 *   const localSummary = await quickSummarize(transcription, {
 *     type: 'tl;dr',
 *     length: 'short'
 *   });
 *   
 *   // Now send this shorter summary to your cloud LLM for 'Deep Chat'
 *   // This saves API credits since you're sending less text
 *   await sendToCloudLLM(localSummary);
 * } catch (error) {
 *   // Fallback: send full transcription if built-in AI not available
 *   await sendToCloudLLM(transcription);
 * }
 */

/**
 * Hugging Face Hub often requires a Bearer token for /resolve/ file URLs.
 * @huggingface/transformers does not send tokens in the browser by default.
 *
 * This replaces env.fetch once per worker to:
 * - Attach Authorization when REACT_APP_HF_TOKEN is provided (via worker messages).
 * - Fail fast on non-OK or text/html Hub responses so you do not get
 *   "Unexpected token '<' ... is not valid JSON" from tokenizers.js.
 *
 * Security: any REACT_APP_* value is exposed in the JS bundle — use a fine-grained read token.
 */

let currentToken = "";
let fetchWrapped = false;

function requestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof Request) {
    return input.url;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return String(input?.url ?? input ?? "");
}

function isHubUrl(url) {
  const s = String(url);
  // Fast path — catches every normal Hub / LFS URL string
  if (/huggingface\.co|\.hf\.co/i.test(s)) {
    return true;
  }
  try {
    const u = new URL(s, "https://unused.invalid");
    return (
      u.hostname === "huggingface.co" ||
      u.hostname.endsWith(".huggingface.co") ||
      u.hostname.endsWith(".hf.co")
    );
  } catch {
    return false;
  }
}

/** Merge headers + Bearer; always use cache: 'no-store' to avoid stale 401/HTML from the HTTP cache. */
function buildHubFetchArgs(input, init, token) {
  const headers = new Headers();
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const cache = "no-store";
  const credentials = "omit";

  if (input instanceof Request) {
    const { headers: _h, cache: _c, credentials: _cr, ...restInit } = init || {};
    return [
      new Request(input, {
        ...restInit,
        headers,
        cache,
        credentials,
      }),
      undefined,
    ];
  }

  if (typeof input === "string") {
    const { headers: _h, cache: _c, credentials: _cr, ...restInit } = init || {};
    return [
      new Request(input, {
        ...restInit,
        headers,
        cache,
        credentials,
      }),
      undefined,
    ];
  }

  const { headers: _h2, cache: _c2, credentials: _cr2, ...restInit2 } = init || {};
  return [input, { ...restInit2, headers, cache, credentials }];
}

export function installHfHubFetch(env, token) {
  if (typeof token === "string" && token.trim()) {
    currentToken = token.trim();
  }

  if (fetchWrapped) {
    return;
  }
  fetchWrapped = true;

  const origFetch = globalThis.fetch.bind(globalThis);
  env.fetch = async (input, init) => {
    const url = requestUrl(input);
    const hub = isHubUrl(url);

    let reqInput = input;
    let reqInit = init;
    if (hub) {
      [reqInput, reqInit] = buildHubFetchArgs(input, init, currentToken);
    }

    const response = await origFetch(reqInput, reqInit);

    if (hub) {
      if (!response.ok) {
        const hint = currentToken
          ? " If you use a fine-grained token, it must allow read access to every model repo you load (e.g. Xenova/whisper-base.en and Xenova/bge-small-en-v1.5), or use a classic read token. Then hard-refresh."
          : " Add REACT_APP_HF_TOKEN (read-only) at https://huggingface.co/settings/tokens in frontend/.env or .env.development.local, then restart npm start.";
        throw new Error(
          `Hugging Face returned HTTP ${response.status} while loading a model file.${hint}`
        );
      }
      const ct = (response.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html")) {
        throw new Error(
          "Hugging Face (or the network) returned HTML instead of model data — often a login/block page or your app index.html from a bad cache. " +
            "Set REACT_APP_HF_TOKEN, rebuild, then clear site data for this origin."
        );
      }

      // Transformers.js Cache API can bypass env.fetch on hits; stale HTML sometimes has a
      // non-HTML Content-Type. Sniff JSON-ish Hub files so tokenizers don't throw on <!doctype.
      let path = "";
      try {
        path = new URL(url).pathname.toLowerCase();
      } catch {
        /* ignore */
      }
      const sniffJson =
        path.endsWith(".json") ||
        path.endsWith(".txt") ||
        path.includes("tokenizer") ||
        path.includes("config");
      if (sniffJson && response.ok) {
        const head = await response
          .clone()
          .blob()
          .then((b) => b.slice(0, 256).text());
        const t = head.trimStart().toLowerCase();
        if (t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<head")) {
          throw new Error(
            "Cached or network response looks like HTML, not JSON (often a bad Transformers.js cache entry). " +
              "Hard-refresh with cache cleared, or bump env.cacheKey in the worker; ensure REACT_APP_HF_TOKEN is set."
          );
        }
      }
    }

    return response;
  };
}

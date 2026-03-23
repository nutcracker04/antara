function toWebSocketUrl(baseUrl, path) {
  const url = new URL(path, baseUrl || window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function streamAssistantChat({ history = [], onChunk, query, references = [] }) {
  const requestId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const socketUrl = toWebSocketUrl(process.env.REACT_APP_BACKEND_URL, "/api/chat/ws");

  return new Promise((resolve, reject) => {
    let answer = "";
    let finished = false;
    const socket = new WebSocket(socketUrl);

    const closeWithError = (message) => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error(message));
    };

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          history,
          query,
          references,
          request_id: requestId,
          type: "chat",
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.request_id && payload.request_id !== requestId) {
          return;
        }

        if (payload.type === "ready" || payload.type === "start") {
          return;
        }

        if (payload.type === "chunk") {
          const content = payload.content || "";
          answer += content;
          onChunk?.(answer, content);
          return;
        }

        if (payload.type === "done") {
          finished = true;
          socket.close();
          resolve(payload.answer || answer);
          return;
        }

        if (payload.type === "error") {
          closeWithError(payload.error || "Assistant chat failed.");
        }
      } catch {
        closeWithError("Assistant chat returned an unreadable response.");
      }
    };

    socket.onerror = () => {
      closeWithError("Could not connect to the assistant backend.");
    };

    socket.onclose = () => {
      if (!finished) {
        closeWithError("The assistant connection closed before the reply finished.");
      }
    };
  });
}

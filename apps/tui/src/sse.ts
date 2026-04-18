export interface SseHandlers {
  onOpen?: () => void;
  onError?: (err: unknown) => void;
  onEvent: (type: string, data: string) => void;
}

export function subscribeSse(url: string, handlers: SseHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;

  void (async () => {
    while (!stopped) {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        handlers.onOpen?.();
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        try {
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const chunk = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              let eventType = "message";
              let data = "";
              for (const line of chunk.split("\n")) {
                if (line.startsWith(":")) continue;
                if (line.startsWith("event:")) eventType = line.slice(6).trim();
                else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trimStart();
              }
              if (data) handlers.onEvent(eventType, data);
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (err) {
        if (stopped) return;
        handlers.onError?.(err);
      }
      if (stopped) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
  };
}

/**
 * One-shot SSE subscription. Does NOT reconnect on normal stream close. Used for
 * finite responses like search. Callbacks fire synchronously on each event.
 */
export function subscribeSseOnce(url: string, handlers: SseHandlers): () => void {
  const controller = new AbortController();
  let stopped = false;

  void (async () => {
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
      handlers.onOpen?.();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let eventType = "message";
            let data = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith(":")) continue;
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trimStart();
            }
            if (data) handlers.onEvent(eventType, data);
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (!stopped) handlers.onError?.(err);
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
  };
}

import { Elysia } from "elysia";
import { bus } from "../bus.ts";

export const eventRoutes = new Elysia({ prefix: "/events" }).get("/", ({ request }) => {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller may already be closed
        }
      };
      write(":ok\n\n");
      const heartbeat = setInterval(() => write(`:hb ${Date.now()}\n\n`), 15_000);
      try {
        for await (const event of bus.stream(abort.signal)) {
          write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

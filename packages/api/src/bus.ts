export type BusEvent =
  | { type: "mail.received"; folder: string; gmMsgid: string; subject: string | null }
  | { type: "mail.updated"; gmMsgid: string }
  | { type: "folder.synced"; folder: string; count: number }
  | { type: "folder.sync.progress"; folder: string; done: number; target: number }
  | { type: "mail.sent"; to: string[]; subject: string; messageId: string }
  | { type: "auth.signed-in"; email: string }
  | { type: "heartbeat"; at: number };

type Listener = (e: BusEvent) => void;

class Bus {
  #subs = new Set<Listener>();

  publish(e: BusEvent): void {
    for (const s of this.#subs) {
      try {
        s(e);
      } catch (err) {
        console.error("[bus] subscriber threw:", err);
      }
    }
  }

  subscribe(fn: Listener): () => void {
    this.#subs.add(fn);
    return () => {
      this.#subs.delete(fn);
    };
  }

  async *stream(signal?: AbortSignal): AsyncGenerator<BusEvent> {
    const queue: BusEvent[] = [];
    let wake: (() => void) | null = null;
    const unsub = this.subscribe((e) => {
      queue.push(e);
      const w = wake;
      wake = null;
      w?.();
    });
    try {
      while (!signal?.aborted) {
        while (queue.length) {
          const next = queue.shift();
          if (next) yield next;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    } finally {
      unsub();
    }
  }
}

export const bus = new Bus();

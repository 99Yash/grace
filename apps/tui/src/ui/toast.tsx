import { For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme } from "../theme/index.tsx";

export type ToastVariant = "success" | "info" | "warning" | "error";

export type ToastOptions = {
  message: string;
  variant?: ToastVariant;
  title?: string;
  duration?: number;
};

export type ToastEntry = {
  id: number;
  message: string;
  variant: ToastVariant;
  title?: string;
};

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 2000,
  info: 3000,
  warning: 4000,
  error: 6000,
};

type ToastStore = { entries: ToastEntry[] };

const [store, setStore] = createStore<ToastStore>({ entries: [] });
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function dismiss(id: number) {
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
  setStore("entries", (list) => list.filter((e) => e.id !== id));
}

export const toast = {
  get entries(): readonly ToastEntry[] {
    return store.entries;
  },
  show(options: ToastOptions): number {
    const id = nextId++;
    const variant = options.variant ?? "info";
    const entry: ToastEntry = options.title
      ? { id, message: options.message, variant, title: options.title }
      : { id, message: options.message, variant };
    setStore("entries", (list) => [...list, entry]);
    const duration = options.duration ?? DEFAULT_DURATION[variant];
    const handle = setTimeout(() => dismiss(id), duration);
    timers.set(id, handle);
    return id;
  },
  success(message: string, opts?: Omit<ToastOptions, "message" | "variant">): number {
    return toast.show({ ...opts, message, variant: "success" });
  },
  info(message: string, opts?: Omit<ToastOptions, "message" | "variant">): number {
    return toast.show({ ...opts, message, variant: "info" });
  },
  warning(message: string, opts?: Omit<ToastOptions, "message" | "variant">): number {
    return toast.show({ ...opts, message, variant: "warning" });
  },
  error(message: string, opts?: Omit<ToastOptions, "message" | "variant">): number {
    return toast.show({ ...opts, message, variant: "error" });
  },
  dismiss,
};

function variantColor(t: ReturnType<typeof useTheme>, v: ToastVariant): string {
  switch (v) {
    case "success": return t.success;
    case "warning": return t.warning;
    case "error": return t.error;
    case "info": return t.primarySoft;
  }
}

export function ToastHost() {
  const t = useTheme();
  return (
    <Show when={store.entries.length > 0}>
      <box
        position="absolute"
        top={2}
        right={2}
        flexDirection="column"
        alignItems="flex-end"
        zIndex={100}
      >
        <For each={store.entries}>
          {(entry) => (
            <box
              flexDirection="row"
              backgroundColor={t.surfaceAlt}
              marginBottom={1}
              maxWidth={60}
              minWidth={16}
            >
              <box width={1} backgroundColor={variantColor(t, entry.variant)} />
              <box flexDirection="column" paddingLeft={1} paddingRight={1}>
                <Show when={entry.title}>
                  <text attributes={1} fg={t.textBright}>{entry.title}</text>
                </Show>
                <text fg={t.textBody} wrapMode="word">{entry.message}</text>
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}

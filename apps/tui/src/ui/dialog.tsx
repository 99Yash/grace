import type { Renderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createMemo, createSignal, onMount, Show, type JSX } from "solid-js";

export type DialogSlot = "content" | "list";

export type DialogEntry = {
  id: string;
  slot: DialogSlot;
  render: () => JSX.Element;
  onClose?: () => void;
};

const [stack, setStack] = createSignal<DialogEntry[]>([]);

let rendererRef: { currentFocusedRenderable: Renderable | null; root: Renderable } | null = null;
let savedFocus: Renderable | null = null;

function saveFocus() {
  if (!rendererRef) return;
  savedFocus = rendererRef.currentFocusedRenderable;
  savedFocus?.blur?.();
}

function restoreFocus() {
  const target = savedFocus;
  savedFocus = null;
  if (!target || !rendererRef) return;
  setTimeout(() => {
    if (target.isDestroyed) return;
    const root = rendererRef?.root;
    if (!root) return;
    const find = (node: Renderable): boolean => {
      for (const child of node.getChildren()) {
        if (child === target) return true;
        if (find(child)) return true;
      }
      return false;
    };
    if (!find(root)) return;
    target.focus?.();
  }, 1);
}

export const dialog = {
  get stack(): readonly DialogEntry[] {
    return stack();
  },

  topForSlot(slot: DialogSlot): DialogEntry | undefined {
    const s = stack();
    for (let i = s.length - 1; i >= 0; i--) {
      const entry = s[i];
      if (entry && entry.slot === slot) return entry;
    }
    return undefined;
  },

  has(id: string): boolean {
    return stack().some((e) => e.id === id);
  },

  open(entry: DialogEntry) {
    const s = stack();
    const existing = s.findIndex((e) => e.id === entry.id);
    if (existing >= 0) {
      const next = [...s];
      next[existing] = entry;
      setStack(next);
      return;
    }
    if (s.length === 0) saveFocus();
    setStack([...s, entry]);
  },

  close(id?: string): boolean {
    const s = stack();
    if (s.length === 0) return false;
    const idx = id ? s.findIndex((e) => e.id === id) : s.length - 1;
    if (idx < 0) return false;
    const entry = s[idx]!;
    entry.onClose?.();
    const next = [...s.slice(0, idx), ...s.slice(idx + 1)];
    setStack(next);
    if (next.length === 0) restoreFocus();
    return true;
  },

  clear() {
    const s = stack();
    if (s.length === 0) return;
    for (const entry of s) entry.onClose?.();
    setStack([]);
    restoreFocus();
  },
};

export function DialogSlot(props: {
  slot: DialogSlot;
  fallback: JSX.Element;
  wrap?: (el: JSX.Element) => JSX.Element;
}) {
  const top = createMemo<DialogEntry | undefined>(() => {
    const s = stack();
    for (let i = s.length - 1; i >= 0; i--) {
      const entry = s[i];
      if (entry && entry.slot === props.slot) return entry;
    }
    return undefined;
  });
  return (
    <Show when={top()} keyed fallback={props.fallback}>
      {(entry: DialogEntry) => {
        const el = entry.render();
        return props.wrap ? props.wrap(el) : el;
      }}
    </Show>
  );
}

export function DialogHost() {
  const renderer = useRenderer();
  onMount(() => {
    rendererRef = renderer;
  });

  useKeyboard(
    (e: {
      name: string;
      ctrl?: boolean;
      preventDefault?: () => void;
      defaultPrevented?: boolean;
    }) => {
      if (stack().length === 0) return;
      if (e.defaultPrevented) return;
      if (e.name !== "escape") return;
      e.preventDefault?.();
      dialog.close();
    },
  );

  return null;
}

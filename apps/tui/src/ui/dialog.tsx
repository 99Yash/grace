import type { Renderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { onMount, Show, type JSX } from "solid-js";
import { createStore } from "solid-js/store";

export type DialogSlot = "content" | "list";

export type DialogEntry = {
  id: string;
  slot: DialogSlot;
  element: JSX.Element;
  onClose?: () => void;
};

type DialogStore = { stack: DialogEntry[] };

const [store, setStore] = createStore<DialogStore>({ stack: [] });

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
    return store.stack;
  },

  topForSlot(slot: DialogSlot): DialogEntry | undefined {
    for (let i = store.stack.length - 1; i >= 0; i--) {
      const entry = store.stack[i];
      if (entry && entry.slot === slot) return entry;
    }
    return undefined;
  },

  has(id: string): boolean {
    return store.stack.some((e) => e.id === id);
  },

  open(entry: DialogEntry) {
    const existing = store.stack.findIndex((e) => e.id === entry.id);
    if (existing >= 0) {
      setStore("stack", existing, entry);
      return;
    }
    if (store.stack.length === 0) saveFocus();
    setStore("stack", (s) => [...s, entry]);
  },

  close(id?: string): boolean {
    if (store.stack.length === 0) return false;
    const idx = id
      ? store.stack.findIndex((e) => e.id === id)
      : store.stack.length - 1;
    if (idx < 0) return false;
    const entry = store.stack[idx]!;
    entry.onClose?.();
    setStore("stack", (s) => [...s.slice(0, idx), ...s.slice(idx + 1)]);
    if (store.stack.length === 0) restoreFocus();
    return true;
  },

  clear() {
    if (store.stack.length === 0) return;
    for (const entry of store.stack) entry.onClose?.();
    setStore("stack", []);
    restoreFocus();
  },
};

export function DialogSlot(props: { slot: DialogSlot; fallback: JSX.Element; wrap?: (el: JSX.Element) => JSX.Element }) {
  return (
    <Show when={dialog.topForSlot(props.slot)} keyed fallback={props.fallback}>
      {(entry: DialogEntry) => (props.wrap ? props.wrap(entry.element) : entry.element)}
    </Show>
  );
}

export function DialogHost() {
  const renderer = useRenderer();
  onMount(() => {
    rendererRef = renderer;
  });

  useKeyboard((e: { name: string; ctrl?: boolean; preventDefault?: () => void; defaultPrevented?: boolean }) => {
    if (store.stack.length === 0) return;
    if (e.defaultPrevented) return;
    if (e.name !== "escape") return;
    e.preventDefault?.();
    dialog.close();
  });

  return null;
}

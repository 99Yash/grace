import type { ParsedKey, Renderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/solid";
import { createContext, type ParentProps, useContext } from "solid-js";
import { createStore } from "solid-js/store";
import * as Keybind from "./util.ts";

export const DEFAULT_KEYBINDS = {
  leader: "ctrl+b",
  "app.quit": "ctrl+c",
  "app.search": "/",
  "app.compose": "c",
  "app.refresh": "r",
  "app.help": "?,shift+/",
  "app.palette": "ctrl+p,:,shift+;",
  "app.themes": "<leader>+t",
  "dialog.close": "escape",
  "nav.down": "j,down",
  "nav.up": "k,up",
  "nav.top": "g",
  "nav.bottom": "shift+g",
  "list.open": "return",
  "mail.toggleRead": "m",
  "mail.toggleStar": "s",
  "mail.archive": "e",
  "mail.trash": "#,shift+3",
  "mail.label": "l",
  "app.triage": "shift+t",
  "triage.archiveNext": "space",
  "triage.archive": "a",
  "triage.reply": "r",
  "reader.w3m": "v",
  "reader.browser": "shift+v",
  "reader.reply": "shift+r",
  "reader.textMode": "t",
  "reader.toggleQuotes": "z",
  "sidebar.toggle": "tab",
  "compose.send": "ctrl+s,ctrl+return",
  "compose.nextField": "tab",
  "compose.prevField": "shift+tab",
  "compose.toggleCc": "alt+c",
  "compose.toggleBcc": "alt+b",
  "compose.toggleAttach": "alt+a",
  "search.next": "down,ctrl+j",
  "search.prev": "up,ctrl+k",
  "list.nextPage": "]",
  "list.prevPage": "[",
} as const;

export type KeybindAction = keyof typeof DEFAULT_KEYBINDS;

export type KeybindApi = {
  readonly all: Record<string, Keybind.Info[]>;
  readonly leader: boolean;
  parse(evt: ParsedKey): Keybind.Info;
  match(key: string, evt: ParsedKey): boolean;
  print(key: string): string;
};

const KeybindContext = createContext<KeybindApi>();

function buildKeybinds(overrides?: Record<string, string>): Record<string, Keybind.Info[]> {
  const merged: Record<string, string> = { ...DEFAULT_KEYBINDS, ...(overrides ?? {}) };
  const out: Record<string, Keybind.Info[]> = {};
  for (const [k, v] of Object.entries(merged)) out[k] = Keybind.parse(v);
  return out;
}

function createKeybind(overrides?: Record<string, string>): KeybindApi {
  const keybinds = buildKeybinds(overrides);
  const [store, setStore] = createStore({ leader: false });
  const renderer = useRenderer();

  let focus: Renderable | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  function setLeader(active: boolean) {
    if (active) {
      setStore("leader", true);
      focus = renderer.currentFocusedRenderable;
      focus?.blur?.();
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!store.leader) return;
        setLeader(false);
      }, 2000);
      return;
    }
    setStore("leader", false);
    if (timeout) { clearTimeout(timeout); timeout = null; }
    if (focus && !focus.isDestroyed) focus.focus?.();
    focus = null;
  }

  const api: KeybindApi = {
    get all() { return keybinds; },
    get leader() { return store.leader; },
    parse(evt) { return Keybind.fromParsedKey(evt, store.leader); },
    match(key, evt) {
      const list = keybinds[key] ?? Keybind.parse(key);
      if (!list.length) return false;
      const parsed = api.parse(evt);
      return list.some((item) => Keybind.match(item, parsed));
    },
    print(key) {
      const first = keybinds[key]?.[0] ?? Keybind.parse(key)[0];
      if (!first) return "";
      const text = Keybind.toString(first);
      const lead = keybinds["leader"]?.[0];
      if (!lead) return text;
      return text.replace("<leader>", Keybind.toString(lead));
    },
  };

  useKeyboard((evt) => {
    if (!store.leader && api.match("leader", evt)) {
      setLeader(true);
      return;
    }
    if (store.leader && evt.name) {
      setImmediate(() => { if (store.leader) setLeader(false); });
    }
  });

  return api;
}

export function KeybindProvider(props: ParentProps<{ overrides?: Record<string, string> }>) {
  const value = createKeybind(props.overrides);
  return <KeybindContext.Provider value={value}>{props.children}</KeybindContext.Provider>;
}

export function useKeybind(): KeybindApi {
  const ctx = useContext(KeybindContext);
  if (!ctx) throw new Error("useKeybind called outside KeybindProvider");
  return ctx;
}

export { Keybind };

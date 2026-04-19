import type { ParsedKey } from "@opentui/core";

export type Info = {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  super: boolean;
  leader: boolean;
};

export function match(a: Info | undefined, b: Info): boolean {
  if (!a) return false;
  return (
    a.name === b.name &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.super === b.super &&
    a.leader === b.leader
  );
}

export function fromParsedKey(key: ParsedKey, leader = false): Info {
  const k = key as ParsedKey & { super?: boolean };
  return {
    name: k.name === " " ? "space" : (k.name ?? ""),
    ctrl: k.ctrl ?? false,
    meta: k.meta ?? false,
    shift: k.shift ?? false,
    super: k.super ?? false,
    leader,
  };
}

export function toString(info: Info | undefined): string {
  if (!info) return "";
  const parts: string[] = [];
  if (info.ctrl) parts.push("ctrl");
  if (info.meta) parts.push("alt");
  if (info.super) parts.push("super");
  if (info.shift) parts.push("shift");
  if (info.name) {
    if (info.name === "delete") parts.push("del");
    else if (info.name === "return") parts.push("enter");
    else if (info.name === "escape") parts.push("esc");
    else if (info.name === "space") parts.push("spc");
    else parts.push(info.name);
  }
  let result = parts.join("+");
  if (info.leader) result = result ? `<leader> ${result}` : `<leader>`;
  return result;
}

export function parse(key: string): Info[] {
  if (!key || key === "none") return [];
  return key.split(",").map((combo) => {
    const normalized = combo.replace(/<leader>/g, "leader+");
    const parts = normalized.toLowerCase().split("+");
    const info: Info = { name: "", ctrl: false, meta: false, shift: false, super: false, leader: false };
    for (const part of parts) {
      switch (part) {
        case "ctrl": info.ctrl = true; break;
        case "alt": case "meta": case "option": info.meta = true; break;
        case "super": info.super = true; break;
        case "shift": info.shift = true; break;
        case "leader": info.leader = true; break;
        case "esc": info.name = "escape"; break;
        case "enter": info.name = "return"; break;
        case "spc": info.name = "space"; break;
        default: info.name = part; break;
      }
    }
    return info;
  });
}

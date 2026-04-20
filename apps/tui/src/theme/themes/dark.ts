import type { Theme } from "../tokens.ts";

export const dark: Theme = {
  name: "dark",

  background: "#0a0a0a",
  surface: "#141414",
  surfaceAlt: "#1e1e1e",
  field: "#282828",
  sidebarFocus: "#141414",
  selection: "#fab283",

  text: "#eeeeee",
  textBright: "#ffffff",
  textBody: "#d0d0d0",
  textMuted: "#a0a0a0",
  textSubtle: "#808080",
  textFaint: "#606060",
  textGhost: "#484848",
  textRead: "#808080",

  primary: "#fab283",
  primarySoft: "#ffc09f",
  primaryOnSelection: "#0a0a0a",

  accent: "#9d7cd8",
  accentSoft: "#b79af0",

  success: "#7fd88f",
  warning: "#f5a742",
  error: "#e06c75",
  errorBright: "#ef4444",
  star: "#e5c07b",
};

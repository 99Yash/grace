import { type ParentProps } from "solid-js";
import { createStore } from "solid-js/store";
import { dark } from "./themes/dark.ts";
import { everforest } from "./themes/everforest.ts";
import { light } from "./themes/light.ts";
import { rosepine } from "./themes/rosepine.ts";
import { tokyonight } from "./themes/tokyonight.ts";
import type { Theme } from "./tokens.ts";

export type { Theme } from "./tokens.ts";

export const themes: readonly Theme[] = [dark, light, tokyonight, rosepine, everforest];

const [store, setStore] = createStore<Theme>({ ...dark });

export function useTheme(): Theme {
  return store;
}

export function currentThemeName(): string {
  return store.name;
}

export function setTheme(theme: Theme): void {
  setStore(theme);
}

export function setThemeByName(name: string): boolean {
  const found = themes.find((tm) => tm.name === name);
  if (!found) return false;
  setTheme(found);
  return true;
}

export function ThemeProvider(props: ParentProps<{ theme?: Theme }>) {
  if (props.theme) setTheme(props.theme);
  return <>{props.children}</>;
}

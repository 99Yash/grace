import { Match, Show, Switch } from "solid-js";
import { DEBUG } from "../api.ts";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { debugRef, debugSh, debugTop, debugView } from "./MessageList.tsx";

export function HelpBar() {
  const s = useAppState();
  const t = useTheme();
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={t.background}
    >
      <text fg={t.textFaint} flexGrow={1}>
        <Switch fallback="? help · tab folders · j/k nav · enter open · c compose · m read · s star · e archive · # trash · l label · / search">
          <Match when={s.auth.error}>enter/r retry · ctrl+c exit</Match>
          <Match when={s.auth() && !s.auth()!.signedIn}>enter authorize · ctrl+c exit</Match>
          <Match when={s.composeOpen()}>
            tab field · ctrl+s send · esc close
          </Match>
          <Match when={s.sidebarFocused()}>
            j/k nav · enter switch · tab/esc back to list
          </Match>
          <Match when={s.searchOpen() && !s.readerOpen()}>
            type to search · ↑↓ nav · enter open · esc cancel
          </Match>
          <Match when={s.readerOpen()}>
            {`R reply · m read · s star · e archive · # trash · l label${s.caps()?.w3m ? " · v rich" : ""} · V browser · t text · esc close`}
          </Match>
        </Switch>
      </text>
      <Show when={DEBUG}>
        <text fg={t.errorBright} paddingRight={2}>
          {`sel=${s.selected()} top=${debugTop()} view=${debugView()} sh=${debugSh()} ref=${debugRef() ? "y" : "n"}`}
        </text>
      </Show>
      <text fg={t.textFaint}>ctrl+c exit</text>
    </box>
  );
}

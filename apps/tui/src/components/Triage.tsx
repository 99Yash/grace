import { Show } from "solid-js";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { Reader } from "./Reader.tsx";

export function TriageView() {
  const s = useAppState();
  const t = useTheme();

  const total = () => s.visibleMessages().length;
  const position = () => Math.min(s.triageIndex() + 1, Math.max(total(), 1));

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} minWidth={0}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.surfaceAlt}
      >
        <text attributes={1} fg={t.primary} flexGrow={1}>
          triage · {s.activeFolder()}
        </text>
        <text fg={t.textMuted}>{total() === 0 ? "0/0" : `${position()}/${total()}`}</text>
      </box>
      <Show
        when={s.currentMsg()}
        fallback={
          <box flexGrow={1} padding={2} flexDirection="column">
            <text fg={t.textMuted}>inbox empty — press esc to exit</text>
          </box>
        }
      >
        <Reader />
      </Show>
    </box>
  );
}

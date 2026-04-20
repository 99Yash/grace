import { useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { Spinner } from "./Spinner.tsx";

export function DaemonOffline() {
  const s = useAppState();
  const t = useTheme();
  const [retrying, setRetrying] = createSignal(false);

  useKeyboard((e) => {
    if (!s.auth.error) return;
    if (retrying()) return;
    if (e.name !== "return" && e.name !== "r") return;
    setRetrying(true);
    Promise.resolve(s.refetchAuth()).finally(() => setRetrying(false));
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      paddingLeft={2}
      paddingRight={2}
    >
      <text attributes={1} fg={t.error}>
        daemon unreachable
      </text>
      <box height={1} />
      <text fg={t.textMuted}>grace can't talk to the local daemon on 127.0.0.1:3535</text>
      <text fg={t.textMuted}>start it with `bun run dev:server` in another pane</text>
      <box height={1} />
      <Show when={retrying()} fallback={<text fg={t.primarySoft}>press enter or r to retry</text>}>
        <Spinner label="retrying…" />
      </Show>
    </box>
  );
}

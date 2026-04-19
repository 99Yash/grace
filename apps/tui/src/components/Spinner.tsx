import { createSignal, onCleanup, Show } from "solid-js";
import { useTheme } from "../theme/index.tsx";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function Spinner(props: { color?: string; label?: string }) {
  const t = useTheme();
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
  onCleanup(() => clearInterval(timer));
  const color = () => props.color ?? t.textMuted;
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color()}>{SPINNER_FRAMES[frame()]}</text>
      <Show when={props.label}>
        <text fg={color()}> {props.label}</text>
      </Show>
    </box>
  );
}

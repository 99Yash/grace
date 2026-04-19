import { Match, Show, Switch } from "solid-js";
import { formatRelative } from "../format.ts";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";

export function TopBar() {
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
      <text attributes={1} fg={t.text} flexGrow={1}>
        grace
      </text>
      <text fg={t.textSubtle}>
        <Switch fallback="connecting…">
          <Match when={s.auth.error}>daemon unreachable</Match>
          <Match when={s.auth()?.signedIn}>{s.auth()!.email}</Match>
          <Match when={s.auth() && !s.auth()!.signedIn}>not signed in</Match>
        </Switch>
      </text>
    </box>
  );
}

export function FolderHeader() {
  const s = useAppState();
  const t = useTheme();
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={t.surface}
    >
      <text fg={t.textMuted} flexGrow={1}>
        {s.activeFolder()}
        {s.messages() ? ` · ${s.visibleMessages().length}` : ""}
      </text>
      <Show when={s.syncProgress()}>
        <text fg={t.primarySoft} paddingRight={2}>
          {`${s.syncProgress()!.done}/${s.syncProgress()!.target}${s.syncProgress()!.done < s.syncProgress()!.target ? " syncing" : " synced ✓"}`}
        </text>
      </Show>
      <Show when={s.newFlash()}>
        <text fg={t.success} paddingRight={2}>
          {s.newFlash()}
        </text>
      </Show>
      <text
        fg={
          s.liveStatus() === "live"
            ? t.success
            : s.liveStatus() === "offline"
              ? t.error
              : t.textSubtle
        }
        paddingRight={2}
      >
        {s.liveStatus() === "live"
          ? "● live"
          : s.liveStatus() === "offline"
            ? "○ offline"
            : "◌ ..."}
      </text>
      <text fg={t.textFaint}>
        <Switch fallback="">
          <Match when={s.messages.loading}>syncing…</Match>
          <Match when={s.lastUpdated()}>updated {formatRelative(s.lastUpdated()!)}</Match>
        </Switch>
      </text>
    </box>
  );
}

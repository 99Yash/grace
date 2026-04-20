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

function friendlyFolderName(path: string, specialUse: string | null | undefined): string {
  if (path === "INBOX") return "Inbox";
  switch (specialUse) {
    case "\\All":
      return "All Mail";
    case "\\Sent":
      return "Sent";
    case "\\Drafts":
      return "Drafts";
    case "\\Trash":
      return "Trash";
    case "\\Junk":
      return "Spam";
    case "\\Flagged":
      return "Starred";
    case "\\Important":
      return "Important";
    default:
      return path;
  }
}

export function FolderHeader() {
  const s = useAppState();
  const t = useTheme();
  const name = () => {
    const f = s.orderedFolders().find((x) => x.path === s.activeFolder());
    return friendlyFolderName(s.activeFolder(), f?.specialUse);
  };
  const pager = () => s.pageRange();
  const canPrev = () => s.page() > 0;
  const canNext = () => s.page() < s.pageCount() - 1;
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={t.surface}
    >
      <text fg={t.text} attributes={1} flexShrink={0}>
        {name()}
      </text>
      <box flexGrow={1} />
      <Show when={pager().total > 0}>
        <text fg={t.textSubtle} flexShrink={0}>
          {`${pager().start}–${pager().end} of ${pager().total}  `}
        </text>
        <box
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(e) => {
            e.preventDefault();
            if (canPrev()) s.prevPage();
          }}
        >
          <text fg={canPrev() ? t.text : t.textFaint}>‹</text>
        </box>
        <box
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(e) => {
            e.preventDefault();
            if (canNext()) s.nextPage();
          }}
        >
          <text fg={canNext() ? t.text : t.textFaint}>›</text>
        </box>
        <text fg={t.textFaint} flexShrink={0}>
          {"  "}
        </text>
      </Show>
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

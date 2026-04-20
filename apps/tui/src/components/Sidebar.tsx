import { For, Show } from "solid-js";
import type { Folder } from "../api.ts";
import { truncate } from "../format.ts";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";

function FolderRow(props: {
  folder: Folder;
  selected: boolean;
  focused: boolean;
  onClick: () => void;
}) {
  const t = useTheme();
  const fg = () =>
    props.focused && props.selected
      ? t.text
      : props.selected
        ? t.textBody
        : t.textMuted;
  const countFg = () => ((props.folder.unseen ?? 0) > 0 ? t.primary : t.textFaint);
  const label = () => {
    if (props.folder.path === "INBOX") return "Inbox";
    if (props.folder.specialUse === "\\All") return "All Mail";
    if (props.folder.specialUse === "\\Sent") return "Sent";
    if (props.folder.specialUse === "\\Drafts") return "Drafts";
    if (props.folder.specialUse === "\\Trash") return "Trash";
    if (props.folder.specialUse === "\\Junk") return "Spam";
    if (props.folder.specialUse === "\\Flagged") return "Starred";
    if (props.folder.specialUse === "\\Important") return "Important";
    return props.folder.name;
  };
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.selected ? (props.focused ? t.selection : t.field) : "transparent"
      }
      onMouseDown={() => props.onClick()}
    >
      <text fg={fg()} flexGrow={1} flexShrink={1}>
        {truncate(label(), 18)}
      </text>
      <Show when={(props.folder.unseen ?? 0) > 0}>
        <text fg={countFg()} flexShrink={0}>
          {String(props.folder.unseen ?? 0)}
        </text>
      </Show>
    </box>
  );
}

export function Sidebar() {
  const s = useAppState();
  const t = useTheme();
  return (
    <box
      flexDirection="column"
      width={22}
      flexShrink={0}
      minHeight={0}
      overflow="hidden"
      backgroundColor={s.sidebarFocused() ? t.sidebarFocus : t.background}
    >
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={s.sidebarFocused() ? t.surfaceAlt : t.surface}
      >
        <text fg={s.sidebarFocused() ? t.text : t.textMuted} flexGrow={1}>
          folders
        </text>
      </box>
      <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0}>
        <For each={s.orderedFolders()} fallback={
          <box padding={1}><text fg={t.textSubtle}>loading…</text></box>
        }>
          {(f, i) => (
            <FolderRow
              folder={f}
              selected={
                s.sidebarFocused()
                  ? s.folderSelected() === i()
                  : f.path === s.activeFolder()
              }
              focused={s.sidebarFocused()}
              onClick={() => void s.switchFolder(f.path)}
            />
          )}
        </For>
      </scrollbox>
    </box>
  );
}

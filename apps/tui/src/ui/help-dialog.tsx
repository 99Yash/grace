import { For, Show } from "solid-js";
import { Keybind, useKeybind } from "../keybind/index.tsx";
import { useTheme } from "../theme/index.tsx";
import { dialog } from "./dialog.tsx";

const GROUPS: Array<{ prefix: string; title: string }> = [
  { prefix: "app", title: "Global" },
  { prefix: "nav", title: "Navigation" },
  { prefix: "list", title: "List" },
  { prefix: "mail", title: "Mail" },
  { prefix: "reader", title: "Reader" },
  { prefix: "triage", title: "Triage" },
  { prefix: "sidebar", title: "Sidebar" },
  { prefix: "search", title: "Search" },
  { prefix: "compose", title: "Compose" },
  { prefix: "dialog", title: "Dialogs" },
];

const LABELS: Record<string, string> = {
  "app.quit": "Quit",
  "app.search": "Search mail",
  "app.compose": "Compose",
  "app.refresh": "Refresh inbox",
  "app.help": "Show this help",
  "app.palette": "Command palette",
  "app.themes": "Switch theme",
  "app.triage": "Enter triage mode",
  "triage.archiveNext": "Archive + next",
  "triage.archive": "Archive",
  "triage.reply": "Reply",
  "dialog.close": "Close / cancel",
  "nav.down": "Down",
  "nav.up": "Up",
  "nav.top": "Jump to top",
  "nav.bottom": "Jump to bottom",
  "list.open": "Open selected",
  "mail.toggleRead": "Toggle read",
  "mail.toggleStar": "Toggle star",
  "mail.archive": "Archive",
  "mail.trash": "Trash",
  "mail.label": "Toggle label",
  "reader.w3m": "Render rich (w3m)",
  "reader.browser": "Open in browser",
  "reader.reply": "Reply",
  "reader.textMode": "Plain text mode",
  "reader.toggleQuotes": "Toggle quoted text",
  "sidebar.toggle": "Focus sidebar",
  "compose.send": "Send",
  "compose.nextField": "Next field",
  "compose.prevField": "Previous field",
  "compose.toggleCc": "Toggle Cc field",
  "compose.toggleBcc": "Toggle Bcc field",
  "compose.toggleAttach": "Toggle Attachments field",
  "search.next": "Next result",
  "search.prev": "Previous result",
};

function label(action: string): string {
  return LABELS[action] ?? action;
}

function HelpDialog() {
  const t = useTheme();
  const kb = useKeybind();

  const combos = (action: string): string => {
    const list = kb.all[action];
    if (!list || list.length === 0) return "—";
    return list.map((info) => Keybind.toString(info)).join(" · ");
  };

  const sections = () => {
    const all = kb.all;
    const out: Array<{ title: string; rows: Array<{ action: string; keys: string }> }> = [];
    for (const group of GROUPS) {
      const rows: Array<{ action: string; keys: string }> = [];
      for (const action of Object.keys(all)) {
        if (action === "leader") continue;
        if (!action.startsWith(group.prefix + ".")) continue;
        rows.push({ action, keys: combos(action) });
      }
      if (rows.length > 0) out.push({ title: group.title, rows });
    }
    return out;
  };

  const leader = () => {
    const first = kb.all["leader"]?.[0];
    return first ? Keybind.toString(first) : "";
  };

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.surfaceAlt}
      >
        <text attributes={1} fg={t.text} flexGrow={1}>
          Keybinds
        </text>
        <Show when={leader()}>
          <text fg={t.textMuted}>leader: {leader()}</text>
        </Show>
      </box>
      <scrollbox
        scrollY
        scrollbarOptions={{ visible: false }}
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={sections()}>
          {(section, sIdx) => (
            <box
              flexDirection="column"
              paddingLeft={2}
              paddingRight={2}
              marginTop={sIdx() > 0 ? 1 : 0}
            >
              <text fg={t.primarySoft} attributes={1}>
                {section.title}
              </text>
              <For each={section.rows}>
                {(row) => (
                  <box flexDirection="row" height={1} paddingLeft={2}>
                    <text
                      fg={t.textBody}
                      flexGrow={1}
                      flexShrink={1}
                      wrapMode="none"
                      overflow="hidden"
                    >
                      {label(row.action)}
                    </text>
                    <text fg={t.text} flexShrink={0}>
                      {row.keys}
                    </text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </scrollbox>
      <box height={1} flexShrink={0} paddingLeft={1} paddingRight={1} backgroundColor={t.field}>
        <text fg={t.textSubtle} flexGrow={1}>
          esc close
        </text>
      </box>
    </box>
  );
}

export function openHelp() {
  dialog.open({
    id: "help",
    slot: "content",
    element: <HelpDialog />,
  });
}

export function closeHelp() {
  dialog.close("help");
}

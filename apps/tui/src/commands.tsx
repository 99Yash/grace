import { onCleanup } from "solid-js";
import type { Folder } from "./api.ts";
import type { Density, InboxCategory } from "./state/app-state.tsx";
import { useAppState } from "./state/app-state.tsx";
import { commands, type CommandOption } from "./ui/command-registry.ts";
import { openFolderPicker } from "./ui/folder-dialog.tsx";
import { openHelp } from "./ui/help-dialog.tsx";
import { openLabelPicker } from "./ui/label-dialog.tsx";
import { openThemes } from "./ui/theme-dialog.tsx";

const DENSITIES: { id: Density; title: string }[] = [
  { id: "compact", title: "Density: compact" },
  { id: "default", title: "Density: default" },
  { id: "comfortable", title: "Density: comfortable" },
];

const INBOX_TABS: { id: InboxCategory; title: string }[] = [
  { id: "primary", title: "Inbox: Primary" },
  { id: "promotions", title: "Inbox: Promotions" },
  { id: "social", title: "Inbox: Social" },
  { id: "updates", title: "Inbox: Updates" },
  { id: "forums", title: "Inbox: Forums" },
  { id: "all", title: "Inbox: All" },
];

function folderLabel(f: Folder): string {
  if (f.path === "INBOX") return "Inbox";
  switch (f.specialUse) {
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
      return f.name;
  }
}

function isCoreFolder(f: Folder): boolean {
  if (f.path === "INBOX") return true;
  if (!f.specialUse) return false;
  return ["\\All", "\\Sent", "\\Drafts", "\\Trash", "\\Junk", "\\Flagged", "\\Important"].includes(
    f.specialUse,
  );
}

export function CommandRegistry() {
  const s = useAppState();

  const dispose = commands.register(() => {
    const m = s.currentMsg();
    const hasMsg = m != null;
    const onInbox = s.activeFolder() === "INBOX";
    const list: CommandOption[] = [
      {
        title: "Compose mail",
        value: "mail.compose",
        category: "Mail",
        keybind: "app.compose",
        suggested: true,
        onSelect: () => s.openCompose(),
      },
      {
        title: "Search mail",
        value: "app.search",
        category: "Mail",
        keybind: "app.search",
        suggested: true,
        onSelect: () => s.openSearch(),
      },
      {
        title: "Triage inbox",
        value: "app.triage",
        category: "Mail",
        keybind: "app.triage",
        suggested: true,
        onSelect: () => s.openTriage(),
      },
      {
        title: "Switch folder…",
        value: "folder.switch",
        category: "Go to",
        suggested: true,
        onSelect: () => openFolderPicker(),
      },
      {
        title: m?.read ? "Mark as unread" : "Mark as read",
        value: "mail.toggleRead",
        category: "Mail",
        keybind: "mail.toggleRead",
        enabled: hasMsg,
        onSelect: () => {
          if (m) void s.runMutation(m, "toggle-read");
        },
      },
      {
        title: m?.starred ? "Unstar" : "Star",
        value: "mail.toggleStar",
        category: "Mail",
        keybind: "mail.toggleStar",
        enabled: hasMsg,
        onSelect: () => {
          if (m) void s.runMutation(m, "toggle-star");
        },
      },
      {
        title: "Archive",
        value: "mail.archive",
        category: "Mail",
        keybind: "mail.archive",
        enabled: hasMsg,
        onSelect: () => {
          if (m) void s.runMutation(m, "archive");
        },
      },
      {
        title: "Move to trash",
        value: "mail.trash",
        category: "Mail",
        keybind: "mail.trash",
        enabled: hasMsg,
        onSelect: () => {
          if (m) void s.runMutation(m, "trash");
        },
      },
      {
        title: "Toggle label…",
        value: "mail.label",
        category: "Mail",
        keybind: "mail.label",
        enabled: hasMsg,
        onSelect: () => openLabelPicker(),
      },
      {
        title: "Refresh inbox",
        value: "app.refresh",
        category: "App",
        keybind: "app.refresh",
        onSelect: () => void s.refetch(),
      },
      {
        title: "Next page",
        value: "list.nextPage",
        category: "View",
        keybind: "list.nextPage",
        enabled: s.page() < s.pageCount() - 1,
        onSelect: () => s.nextPage(),
      },
      {
        title: "Previous page",
        value: "list.prevPage",
        category: "View",
        keybind: "list.prevPage",
        enabled: s.page() > 0,
        onSelect: () => s.prevPage(),
      },
      {
        title: "Switch theme",
        value: "app.themes",
        category: "View",
        keybind: "app.themes",
        onSelect: () => openThemes(),
      },
      {
        title: "Show help",
        value: "app.help",
        category: "App",
        keybind: "app.help",
        onSelect: () => openHelp(),
      },
    ];

    for (const f of s.orderedFolders()) {
      if (!isCoreFolder(f)) continue;
      if (f.path === s.activeFolder()) continue;
      const label = folderLabel(f);
      const unseen = f.unseen ?? 0;
      const opt: CommandOption = {
        title: `Go to: ${label}`,
        value: `folder.go.${f.path}`,
        category: "Go to",
        onSelect: () => void s.switchFolder(f.path),
      };
      if (unseen > 0) opt.description = `${unseen} unread`;
      list.push(opt);
    }

    if (onInbox) {
      for (const tab of INBOX_TABS) {
        if (tab.id === s.inboxCategory()) continue;
        list.push({
          title: tab.title,
          value: `inbox.tab.${tab.id}`,
          category: "Go to",
          onSelect: () => s.setInboxCategory(tab.id),
        });
      }
    }

    for (const d of DENSITIES) {
      if (d.id === s.density()) continue;
      list.push({
        title: d.title,
        value: `view.density.${d.id}`,
        category: "View",
        onSelect: () => s.setDensity(d.id),
      });
    }

    return list;
  });

  onCleanup(dispose);
  return null;
}

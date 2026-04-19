import { onCleanup } from "solid-js";
import { useAppState } from "./state/app-state.tsx";
import { commands, type CommandOption } from "./ui/command-registry.ts";
import { openFolderPicker } from "./ui/folder-dialog.tsx";
import { openHelp } from "./ui/help-dialog.tsx";
import { openThemes } from "./ui/theme-dialog.tsx";

export function CommandRegistry() {
  const s = useAppState();

  const dispose = commands.register(() => {
    const m = s.currentMsg();
    const hasMsg = m != null;
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
        title: "Switch folder",
        value: "folder.switch",
        category: "View",
        suggested: true,
        onSelect: () => openFolderPicker(),
      },
      {
        title: m?.read ? "Mark as unread" : "Mark as read",
        value: "mail.toggleRead",
        category: "Mail",
        keybind: "mail.toggleRead",
        enabled: hasMsg,
        onSelect: () => { if (m) void s.runMutation(m, "toggle-read"); },
      },
      {
        title: m?.starred ? "Unstar" : "Star",
        value: "mail.toggleStar",
        category: "Mail",
        keybind: "mail.toggleStar",
        enabled: hasMsg,
        onSelect: () => { if (m) void s.runMutation(m, "toggle-star"); },
      },
      {
        title: "Archive",
        value: "mail.archive",
        category: "Mail",
        keybind: "mail.archive",
        enabled: hasMsg,
        onSelect: () => { if (m) void s.runMutation(m, "archive"); },
      },
      {
        title: "Move to trash",
        value: "mail.trash",
        category: "Mail",
        keybind: "mail.trash",
        enabled: hasMsg,
        onSelect: () => { if (m) void s.runMutation(m, "trash"); },
      },
      {
        title: "Refresh inbox",
        value: "app.refresh",
        category: "App",
        keybind: "app.refresh",
        onSelect: () => void s.refetch(),
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
    return list;
  });

  onCleanup(dispose);
  return null;
}

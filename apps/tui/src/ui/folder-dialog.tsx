import type { Folder } from "../api.ts";
import { useAppState } from "../state/app-state.tsx";
import { dialog } from "./dialog.tsx";
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx";

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

function FolderDialog() {
  const s = useAppState();
  const options = (): DialogSelectOption<string>[] =>
    s.orderedFolders().map((f) => {
      const opt: DialogSelectOption<string> = { title: folderLabel(f), value: f.path };
      if (f.path !== folderLabel(f)) opt.description = f.path;
      const unseen = f.unseen ?? 0;
      if (unseen > 0) opt.footer = `${unseen} unread`;
      if (f.path === s.activeFolder()) opt.category = "Current";
      else opt.category = "Folders";
      return opt;
    });

  return (
    <DialogSelect<string>
      title="Switch folder"
      placeholder="filter folders…"
      options={options()}
      onSelect={(opt) => {
        closeFolderPicker();
        void s.switchFolder(opt.value);
      }}
    />
  );
}

export function openFolderPicker() {
  dialog.open({
    id: "folder-picker",
    slot: "content",
    element: <FolderDialog />,
  });
}

export function closeFolderPicker() {
  dialog.close("folder-picker");
}

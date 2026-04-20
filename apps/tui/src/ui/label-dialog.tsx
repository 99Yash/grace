import type { Folder } from "../api.ts";
import { useAppState } from "../state/app-state.tsx";
import { dialog } from "./dialog.tsx";
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx";

// These labels are already surfaced elsewhere in the UI (unread state,
// star column, folder sidebar) and shouldn't be toggled from a label
// picker — applying `\Trash` isn't how you trash a message.
const EXCLUDE_SPECIAL_USE = new Set<string>([
  "\\Inbox",
  "\\Drafts",
  "\\Sent",
  "\\Trash",
  "\\Junk",
  "\\All",
  "\\Flagged",
]);

function labelEntry(f: Folder): { path: string; title: string } {
  if (f.specialUse === "\\Important") return { path: "\\Important", title: "Important" };
  return { path: f.path, title: f.path };
}

function LabelDialog() {
  const s = useAppState();

  const options = (): DialogSelectOption<string>[] => {
    const current = new Set(s.currentMsg()?.labels ?? []);
    const rows = s
      .orderedFolders()
      .filter((f) => !f.noSelect)
      .filter((f) => f.path !== "INBOX")
      .filter((f) => !(f.specialUse && EXCLUDE_SPECIAL_USE.has(f.specialUse)))
      .map((f) => {
        const { path, title } = labelEntry(f);
        const applied = current.has(path);
        const opt: DialogSelectOption<string> = {
          title,
          value: path,
          category: applied ? "Applied" : "Labels",
        };
        if (applied) opt.footer = "✓ applied · enter removes";
        else opt.footer = "enter applies";
        return opt;
      });
    return rows;
  };

  return (
    <DialogSelect<string>
      title="Toggle label"
      placeholder="filter labels…"
      options={options()}
      onSelect={(opt) => {
        const msg = s.currentMsg();
        if (!msg) return;
        const applied = (msg.labels ?? []).includes(opt.value);
        closeLabelPicker();
        void s.applyLabelChange(
          msg.gmMsgid,
          applied ? { remove: [opt.value] } : { add: [opt.value] },
        );
      }}
    />
  );
}

export function openLabelPicker() {
  dialog.open({
    id: "label-picker",
    slot: "overlay",
    render: () => <LabelDialog />,
  });
}

export function closeLabelPicker() {
  dialog.close("label-picker");
}

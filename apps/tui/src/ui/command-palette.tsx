import { createMemo, createSignal } from "solid-js";
import { useKeybind } from "../keybind/index.tsx";
import { commands, type CommandOption } from "./command-registry.ts";
import { dialog } from "./dialog.tsx";
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx";

function toDialogOption(
  cmd: CommandOption,
  kbPrint: (key: string) => string,
  categoryOverride?: string,
): DialogSelectOption<string> {
  const opt: DialogSelectOption<string> = { title: cmd.title, value: cmd.value };
  if (cmd.description) opt.description = cmd.description;
  const category = categoryOverride ?? cmd.category;
  if (category) opt.category = category;
  if (cmd.keybind) opt.footer = kbPrint(cmd.keybind);
  return opt;
}

function CommandPalette() {
  const kb = useKeybind();
  const [filter, setFilter] = createSignal("");

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const visible = commands.visible();
    const active = filter().trim();
    if (active) {
      return visible.map((cmd) => toDialogOption(cmd, kb.print));
    }
    const suggested = visible.filter((c) => c.suggested);
    if (suggested.length === 0) {
      return visible.map((cmd) => toDialogOption(cmd, kb.print));
    }
    const rest = visible.filter((c) => !c.suggested);
    return [
      ...suggested.map((c) => toDialogOption(c, kb.print, "Suggested")),
      ...rest.map((cmd) => toDialogOption(cmd, kb.print)),
    ];
  });

  return (
    <DialogSelect<string>
      title="Commands"
      hint={kb.print("app.palette")}
      placeholder="type a command…"
      options={options()}
      onFilter={setFilter}
      onSelect={(opt) => {
        closePalette();
        commands.trigger(opt.value);
      }}
    />
  );
}

export function openPalette() {
  dialog.open({
    id: "palette",
    slot: "overlay",
    render: () => <CommandPalette />,
  });
}

export function closePalette() {
  dialog.close("palette");
}

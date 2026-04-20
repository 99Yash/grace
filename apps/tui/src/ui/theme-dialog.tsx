import type { Theme } from "../theme/index.tsx";
import { currentThemeName, setTheme, themes, useTheme } from "../theme/index.tsx";
import { dialog } from "./dialog.tsx";
import { DialogSelect, type DialogSelectOption } from "./dialog-select.tsx";

function ThemeDialog(props: { onCommit: () => void }) {
  const t = useTheme();
  const options: DialogSelectOption<Theme>[] = themes.map((theme) => {
    const opt: DialogSelectOption<Theme> = { title: theme.name, value: theme };
    if (theme.name === t.name) opt.description = "current";
    return opt;
  });
  return (
    <DialogSelect<Theme>
      title="Themes"
      placeholder="filter themes…"
      options={options}
      onMove={(opt) => setTheme(opt.value)}
      onSelect={(opt) => {
        setTheme(opt.value);
        props.onCommit();
      }}
    />
  );
}

export function openThemes() {
  const originalName = currentThemeName();
  const original = themes.find((tm) => tm.name === originalName);
  let committed = false;
  dialog.open({
    id: "themes",
    slot: "content",
    render: () => (
      <ThemeDialog
        onCommit={() => {
          committed = true;
          dialog.close("themes");
        }}
      />
    ),
    onClose: () => {
      if (!committed && original) setTheme(original);
    },
  });
}

export function closeThemes() {
  dialog.close("themes");
}

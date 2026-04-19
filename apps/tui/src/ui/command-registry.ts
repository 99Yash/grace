import { type Accessor, createMemo, createRoot, createSignal } from "solid-js";

export type CommandOption = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  keybind?: string;
  suggested?: boolean;
  hidden?: boolean;
  enabled?: boolean;
  onSelect?: () => void;
};

export type CommandProvider = () => CommandOption[];

const [providers, setProviders] = createSignal<CommandProvider[]>([]);

const allMemo: Accessor<CommandOption[]> = createRoot(() =>
  createMemo(() => providers().flatMap((fn) => fn())),
);

function isActive(opt: CommandOption): boolean {
  return opt.enabled !== false;
}

function isVisible(opt: CommandOption): boolean {
  return isActive(opt) && !opt.hidden;
}

export const commands = {
  all(): CommandOption[] {
    return allMemo();
  },
  visible(): CommandOption[] {
    return allMemo().filter(isVisible);
  },
  suggested(): CommandOption[] {
    return allMemo().filter((c) => isVisible(c) && c.suggested === true);
  },
  find(value: string): CommandOption | undefined {
    return allMemo().find((c) => c.value === value);
  },
  trigger(value: string): boolean {
    const opt = commands.find(value);
    if (!opt || !isActive(opt)) return false;
    opt.onSelect?.();
    return true;
  },
  register(provider: CommandProvider): () => void {
    setProviders((list) => [...list, provider]);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      setProviders((list) => list.filter((p) => p !== provider));
    };
  },
};

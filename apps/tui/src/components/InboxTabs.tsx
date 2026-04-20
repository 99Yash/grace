import { createMemo, For, Show } from "solid-js";
import type { Message } from "../api.ts";
import type { InboxCategory } from "../state/app-state.tsx";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";

type Tab = { id: InboxCategory; label: string };

const TABS: Tab[] = [
  { id: "primary", label: "Primary" },
  { id: "promotions", label: "Promotions" },
  { id: "social", label: "Social" },
  { id: "updates", label: "Updates" },
  { id: "forums", label: "Forums" },
  { id: "all", label: "All" },
];

const CATEGORY_LABELS: Record<Exclude<InboxCategory, "primary" | "all">, string> = {
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

const NON_PRIMARY = new Set(Object.values(CATEGORY_LABELS));

function categoryOf(m: Message): InboxCategory {
  for (const [id, label] of Object.entries(CATEGORY_LABELS)) {
    if (m.labels.includes(label)) return id as InboxCategory;
  }
  return "primary";
}

export function InboxTabs() {
  const s = useAppState();
  const t = useTheme();

  const counts = createMemo(() => {
    const c: Record<InboxCategory, number> = {
      primary: 0,
      promotions: 0,
      social: 0,
      updates: 0,
      forums: 0,
      all: 0,
    };
    const list = s.messages();
    if (!list) return c;
    for (const m of list) {
      if (m.read) continue;
      c.all++;
      const cat = categoryOf(m);
      c[cat]++;
    }
    return c;
  });

  return (
    <Show when={s.activeFolder() === "INBOX"}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        backgroundColor={t.background}
      >
        <For each={TABS}>
          {(tab) => {
            const active = () => s.inboxCategory() === tab.id;
            const count = () => counts()[tab.id];
            return (
              <box
                flexDirection="row"
                paddingLeft={1}
                paddingRight={1}
                flexShrink={0}
                backgroundColor={active() ? t.surfaceAlt : "transparent"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  s.setInboxCategory(tab.id);
                }}
              >
                <text fg={active() ? t.text : t.textMuted} attributes={active() ? 1 : 0}>
                  {tab.label}
                </text>
                <Show when={count() > 0}>
                  <text fg={active() ? t.primaryOnSelection : t.textFaint}>{` ${count()}`}</text>
                </Show>
              </box>
            );
          }}
        </For>
      </box>
    </Show>
  );
}

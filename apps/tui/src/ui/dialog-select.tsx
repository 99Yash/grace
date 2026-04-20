import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { batch, createEffect, createMemo, For, on, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme } from "../theme/index.tsx";

export interface DialogSelectOption<T = unknown> {
  title: string;
  value: T;
  description?: string;
  footer?: string;
  category?: string;
}

export interface DialogSelectProps<T> {
  title?: string;
  hint?: string;
  placeholder?: string;
  options: DialogSelectOption<T>[];
  onSelect(option: DialogSelectOption<T>): void;
  onFilter?(query: string): void;
  onMove?(option: DialogSelectOption<T>): void;
}

function scoreMatch(needle: string, haystack: string): number | null {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  let hi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < n.length; i++) {
    const ch = n[i]!;
    const found = h.indexOf(ch, hi);
    if (found === -1) return null;
    const atWordStart = found === 0 || /[\s\-_/.:]/.test(h[found - 1] ?? "");
    let delta = 1;
    if (atWordStart) delta += 3;
    if (found === hi) {
      streak += 1;
      delta += streak;
    } else {
      streak = 0;
      delta -= Math.min(5, found - hi);
    }
    score += delta;
    hi = found + 1;
  }
  return score;
}

function optionId(index: number): string {
  return `dialog-select-opt-${index}`;
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
  const t = useTheme();
  const [store, setStore] = createStore({ selected: 0, filter: "" });
  let inputRef: InputRenderable | undefined;
  let scrollRef: ScrollBoxRenderable | undefined;

  const filtered = createMemo<DialogSelectOption<T>[]>(() => {
    const needle = store.filter.trim();
    if (!needle) return props.options;
    const scored: { opt: DialogSelectOption<T>; score: number }[] = [];
    for (const opt of props.options) {
      const titleScore = scoreMatch(needle, opt.title);
      const catScore = opt.category ? scoreMatch(needle, opt.category) : null;
      if (titleScore === null && catScore === null) continue;
      const s = (titleScore ?? 0) * 2 + (catScore ?? 0);
      scored.push({ opt, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((x) => x.opt);
  });

  type Group = { category: string; options: DialogSelectOption<T>[]; offset: number };

  const grouped = createMemo<Group[]>(() => {
    const byCategory = new Map<string, DialogSelectOption<T>[]>();
    for (const opt of filtered()) {
      const key = opt.category ?? "";
      const list = byCategory.get(key);
      if (list) list.push(opt);
      else byCategory.set(key, [opt]);
    }
    const groups: Group[] = [];
    let offset = 0;
    for (const [category, options] of byCategory) {
      groups.push({ category, options, offset });
      offset += options.length;
    }
    return groups;
  });

  const flat = createMemo<DialogSelectOption<T>[]>(() => grouped().flatMap((g) => g.options));

  const dims = useTerminalDimensions();
  const maxHeight = createMemo(() => Math.max(4, Math.floor(dims().height / 2) - 4));

  createEffect(
    on(
      () => store.filter,
      () => moveTo(0),
      { defer: true },
    ),
  );

  function moveTo(next: number) {
    const list = flat();
    if (list.length === 0) {
      setStore("selected", 0);
      return;
    }
    const clamped = Math.max(0, Math.min(list.length - 1, next));
    setStore("selected", clamped);
    const opt = list[clamped];
    if (opt) props.onMove?.(opt);
    scrollRef?.scrollChildIntoView?.(optionId(clamped));
  }

  function move(delta: number) {
    const len = flat().length;
    if (len === 0) return;
    let next = store.selected + delta;
    if (next < 0) next = len - 1;
    if (next >= len) next = 0;
    moveTo(next);
  }

  useKeyboard((e) => {
    if (e.name === "up" || (e.ctrl && e.name === "p")) {
      e.preventDefault?.();
      move(-1);
      return;
    }
    if (e.name === "down" || (e.ctrl && e.name === "n")) {
      e.preventDefault?.();
      move(1);
      return;
    }
    if (e.name === "pageup") {
      e.preventDefault?.();
      move(-10);
      return;
    }
    if (e.name === "pagedown") {
      e.preventDefault?.();
      move(10);
      return;
    }
    if (e.name === "home") {
      e.preventDefault?.();
      moveTo(0);
      return;
    }
    if (e.name === "end") {
      e.preventDefault?.();
      moveTo(flat().length - 1);
      return;
    }
    if (e.name === "return") {
      const opt = flat()[store.selected];
      if (opt) {
        e.preventDefault?.();
        props.onSelect(opt);
      }
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
    >
      <Show when={props.title}>
        <box
          flexDirection="row"
          paddingLeft={2}
          paddingRight={2}
          height={1}
          backgroundColor={t.surfaceAlt}
        >
          <text fg={t.textBright} attributes={1} flexGrow={1}>
            {props.title}
          </text>
          <Show when={props.hint}>
            <text fg={t.textSubtle}>{props.hint}</text>
          </Show>
        </box>
      </Show>
      <box
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={t.field}
        height={1}
      >
        <text fg={t.primarySoft} flexShrink={0}>
          {"› "}
        </text>
        <input
          ref={(r: InputRenderable) => {
            inputRef = r;
            setTimeout(() => {
              if (inputRef && !inputRef.isDestroyed) inputRef.focus();
            }, 1);
          }}
          placeholder={props.placeholder ?? "filter…"}
          placeholderColor={t.textSubtle}
          textColor={t.text}
          focusedTextColor={t.text}
          cursorColor={t.primary}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          onInput={(v: string) =>
            batch(() => {
              setStore("filter", v);
              props.onFilter?.(v);
            })
          }
        />
      </box>
      <Show
        when={flat().length > 0}
        fallback={
          <box paddingLeft={2} paddingRight={2}>
            <text fg={t.textSubtle}>no matches</text>
          </box>
        }
      >
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
          scrollY
          scrollbarOptions={{ visible: false }}
          maxHeight={maxHeight()}
          paddingLeft={1}
          paddingRight={1}
        >
          <For each={grouped()}>
            {(group, groupIdx) => (
              <>
                <Show when={group.category}>
                  <box paddingLeft={2} paddingTop={groupIdx() > 0 ? 1 : 0}>
                    <text fg={t.accent} attributes={1}>
                      {group.category}
                    </text>
                  </box>
                </Show>
                <For each={group.options}>
                  {(opt, idx) => {
                    const absIdx = () => group.offset + idx();
                    const active = () => store.selected === absIdx();
                    return (
                      <box
                        id={optionId(absIdx())}
                        flexDirection="row"
                        paddingLeft={2}
                        paddingRight={2}
                        backgroundColor={active() ? t.selection : "transparent"}
                        gap={1}
                      >
                        <Show
                          when={active()}
                          fallback={
                            <text
                              fg={t.textBright}
                              flexGrow={1}
                              flexShrink={1}
                              overflow="hidden"
                              wrapMode="none"
                            >
                              {opt.title}
                              <Show when={opt.description}>
                                <span style={{ fg: t.textMuted }}>{"  " + opt.description}</span>
                              </Show>
                            </text>
                          }
                        >
                          <text
                            fg={t.text}
                            attributes={1}
                            flexGrow={1}
                            flexShrink={1}
                            overflow="hidden"
                            wrapMode="none"
                          >
                            {opt.title}
                            <Show when={opt.description}>
                              <span style={{ fg: t.primaryOnSelection }}>
                                {"  " + opt.description}
                              </span>
                            </Show>
                          </text>
                        </Show>
                        <Show when={opt.footer}>
                          <box
                            flexShrink={0}
                            paddingLeft={1}
                            paddingRight={1}
                            backgroundColor={active() ? "transparent" : t.field}
                          >
                            <text fg={active() ? t.primaryOnSelection : t.textMuted}>
                              {opt.footer}
                            </text>
                          </box>
                        </Show>
                      </box>
                    );
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <box paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
        <text fg={t.textSubtle}>↑↓/ctrl+np · pgup/dn · home/end</text>
        <text fg={t.textSubtle}>enter select · esc close</text>
      </box>
    </box>
  );
}

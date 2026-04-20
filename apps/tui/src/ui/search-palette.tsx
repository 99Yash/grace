import type { SearchHit } from "@grace/api";
import type { InputRenderable, ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { DAEMON_BASE_URL, hitToMessage, importHit } from "../api.ts";
import { formatRelative, truncate } from "../format.ts";
import { useAppState } from "../state/app-state.tsx";
import { subscribeSseOnce } from "../sse.ts";
import { useTheme } from "../theme/index.tsx";
import { dialog } from "./dialog.tsx";

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 200;

type Phase = "idle" | "searching" | "local-done" | "done" | "error";

function hitId(index: number): string {
  return `search-palette-hit-${index}`;
}

function SearchPalette() {
  const s = useAppState();
  const t = useTheme();

  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [error, setError] = createSignal<string | null>(null);
  const [page, setPage] = createSignal(0);
  const [selected, setSelected] = createSignal(0);

  let inputRef: InputRenderable | undefined;
  let scrollRef: ScrollBoxRenderable | undefined;
  let abort: (() => void) | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (abort) {
      abort();
      abort = null;
    }
    if (debounce) {
      clearTimeout(debounce);
      debounce = null;
    }
  }

  function runSearch(q: string) {
    cancel();
    batch(() => {
      setHits([]);
      setSelected(0);
      setPage(0);
      setError(null);
    });
    if (!q.trim()) {
      setPhase("idle");
      return;
    }
    setPhase("searching");
    const url = `${DAEMON_BASE_URL}/api/search?q=${encodeURIComponent(q)}`;
    abort = subscribeSseOnce(url, {
      onEvent: (type, data) => {
        if (type === "hit") {
          try {
            const hit = JSON.parse(data) as SearchHit;
            setHits((prev) => [...prev, hit]);
          } catch {}
        } else if (type === "phase") {
          try {
            const p = JSON.parse(data) as { phase: string };
            if (p.phase === "local-done") setPhase("local-done");
          } catch {}
        } else if (type === "done") {
          setPhase("done");
        } else if (type === "error") {
          try {
            const p = JSON.parse(data) as { message: string };
            setError(p.message);
            setPhase("error");
          } catch {
            setError("unknown error");
            setPhase("error");
          }
        }
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      },
    });
  }

  createEffect(
    on(
      query,
      (q) => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => runSearch(q), DEBOUNCE_MS);
      },
      { defer: false },
    ),
  );

  onCleanup(cancel);

  const pageCount = createMemo(() => Math.max(1, Math.ceil(hits().length / PAGE_SIZE)));
  const pageHits = createMemo(() => {
    const start = page() * PAGE_SIZE;
    return hits().slice(start, start + PAGE_SIZE);
  });

  function clampSelection() {
    const len = pageHits().length;
    if (len === 0) {
      setSelected(0);
      return;
    }
    if (selected() >= len) setSelected(len - 1);
  }

  createEffect(on([page, hits], clampSelection, { defer: true }));

  function scrollTo(idx: number) {
    scrollRef?.scrollChildIntoView?.(hitId(idx));
  }

  function moveWithin(delta: number) {
    const len = pageHits().length;
    if (len === 0) return;
    let next = selected() + delta;
    if (next < 0) next = 0;
    if (next >= len) next = len - 1;
    setSelected(next);
    scrollTo(next);
  }

  function changePage(delta: number) {
    const next = page() + delta;
    if (next < 0 || next >= pageCount()) return;
    batch(() => {
      setPage(next);
      setSelected(0);
    });
  }

  async function openHit() {
    const hit = pageHits()[selected()];
    if (!hit) return;
    if (!hit.inLocal) {
      try {
        await importHit(hit);
        void s.refetch();
      } catch (err) {
        s.flashToast(`import failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        return;
      }
    }
    s.setActiveMsg(hitToMessage(hit));
    dialog.close("search-palette");
    dialog.close("palette");
    s.setReaderOpen(true);
  }

  useKeyboard((e) => {
    if (e.name === "up" || (e.ctrl && e.name === "p")) {
      e.preventDefault?.();
      moveWithin(-1);
      return;
    }
    if (e.name === "down" || (e.ctrl && e.name === "n")) {
      e.preventDefault?.();
      moveWithin(1);
      return;
    }
    if (e.name === "pageup" || (!e.ctrl && !e.meta && e.name === "[")) {
      e.preventDefault?.();
      changePage(-1);
      return;
    }
    if (e.name === "pagedown" || (!e.ctrl && !e.meta && e.name === "]")) {
      e.preventDefault?.();
      changePage(1);
      return;
    }
    if (e.name === "return") {
      e.preventDefault?.();
      void openHit();
    }
  });

  const statusText = createMemo(() => {
    const err = error();
    if (err) return `error: ${err}`;
    const total = hits().length;
    switch (phase()) {
      case "idle":
        return total === 0 && query().trim() === "" ? "type a Gmail query · esc closes" : "";
      case "searching":
        return total === 0 ? "searching…" : `${total} · searching…`;
      case "local-done":
        return `local ${total} · fetching Gmail…`;
      case "done":
        return `${total} result${total === 1 ? "" : "s"}`;
      case "error":
        return `error: ${err ?? "unknown"}`;
    }
  });

  return (
    <box flexDirection="column" paddingTop={1} paddingBottom={1} gap={1}>
      <box
        flexDirection="row"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={t.surfaceAlt}
      >
        <text attributes={1} fg={t.textBright} flexGrow={1}>
          Search mail
        </text>
        <text fg={t.textSubtle}>esc back</text>
      </box>
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
          placeholder="search subject, from, body…"
          placeholderColor={t.textSubtle}
          textColor={t.text}
          focusedTextColor={t.text}
          cursorColor={t.primary}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          onInput={(v: string) => setQuery(v)}
        />
      </box>
      <Show when={pageHits().length > 0} fallback={<box flexGrow={1} />}>
        <scrollbox
          ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
          scrollY
          scrollbarOptions={{ visible: false }}
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          paddingLeft={1}
          paddingRight={1}
        >
          <For each={pageHits()}>
            {(hit, i) => {
              const active = () => selected() === i();
              const badgeFg = () => (hit.inLocal ? t.success : t.warning);
              return (
                <box
                  id={hitId(i())}
                  flexDirection="row"
                  paddingLeft={2}
                  paddingRight={2}
                  backgroundColor={active() ? t.selection : "transparent"}
                  gap={1}
                >
                  <text fg={badgeFg()} flexShrink={0}>
                    {hit.inLocal ? "●" : "○"}
                  </text>
                  <text
                    fg={active() ? t.text : t.textBright}
                    attributes={active() ? 1 : 0}
                    flexGrow={1}
                    flexShrink={1}
                    overflow="hidden"
                    wrapMode="none"
                  >
                    {truncate(hit.subject ?? "(no subject)", 80)}
                  </text>
                  <text
                    fg={active() ? t.primaryOnSelection : t.textMuted}
                    flexShrink={0}
                    wrapMode="none"
                  >
                    {truncate(hit.fromName ?? hit.fromEmail ?? "", 24)}
                  </text>
                  <text
                    fg={active() ? t.primaryOnSelection : t.textSubtle}
                    flexShrink={0}
                    wrapMode="none"
                  >
                    {formatRelative(hit.date)}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>
      </Show>
      <box paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
        <text fg={t.textSubtle}>{statusText()}</text>
        <Show when={hits().length > PAGE_SIZE}>
          <text fg={t.textSubtle}>
            page {page() + 1}/{pageCount()} · [ prev · ] next
          </text>
        </Show>
      </box>
      <box paddingLeft={2} paddingRight={2} flexDirection="row" justifyContent="space-between">
        <text fg={t.textSubtle}>↑↓/ctrl+np · [ ] pgup/dn</text>
        <text fg={t.textSubtle}>enter open · esc close</text>
      </box>
    </box>
  );
}

export function openSearchPalette() {
  if (dialog.has("search-palette")) return;
  dialog.open({
    id: "search-palette",
    slot: "overlay",
    size: "large",
    render: () => <SearchPalette />,
  });
}

export function closeSearchPalette() {
  dialog.close("search-palette");
}

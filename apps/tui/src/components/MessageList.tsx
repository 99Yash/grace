import { createEffect, createSignal, For, Show } from "solid-js";
import { DEBUG, type Message } from "../api.ts";
import { formatRelative, truncate, visibleLabels } from "../format.ts";
import type { Density } from "../state/app-state.tsx";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";

const COL = {
  flag: 2,
  star: 2,
  sender: 22,
  date: 6,
} as const;

export const [debugTop, setDebugTop] = createSignal(0);
export const [debugView, setDebugView] = createSignal(0);
export const [debugSh, setDebugSh] = createSignal(0);
export const [debugRef, setDebugRef] = createSignal(false);

function MessageRow(props: {
  msg: Message;
  selected: boolean;
  compact: boolean;
  density: Density;
  activeFolder: string;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const t = useTheme();
  const subjectFg = () => (props.selected ? t.text : props.msg.read ? t.textRead : t.textBright);
  const metaFg = () => (props.selected ? t.primaryOnSelection : t.textSubtle);
  const labelFg = () => (props.selected ? t.primaryOnSelection : t.primarySoft);
  const isDense = () => props.density === "compact" || props.compact;
  const showSender = () => !props.compact && props.density !== "compact";
  const showLabels = () => !props.compact && props.density !== "compact";
  const showSecondRow = () => props.density === "comfortable" && !props.compact;
  const pills = () =>
    showLabels() ? visibleLabels(props.msg.labels, props.activeFolder, 2) : { shown: [], extra: 0 };

  let lastClick = 0;
  const handleMouseDown = () => {
    const now = Date.now();
    if (now - lastClick < 350) {
      props.onDoubleClick();
      lastClick = 0;
    } else {
      props.onClick();
      lastClick = now;
    }
  };

  return (
    <box
      flexDirection="column"
      height={showSecondRow() ? 2 : 1}
      flexShrink={0}
      overflow="hidden"
      backgroundColor={props.selected ? t.selection : "transparent"}
      onMouseDown={handleMouseDown}
    >
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={props.msg.read ? t.textGhost : t.primary} width={COL.flag} flexShrink={0}>
          {props.msg.read ? " " : "●"}
        </text>
        <text fg={t.star} width={COL.star} flexShrink={0}>
          {props.msg.starred ? "★" : " "}
        </text>
        <Show when={showLabels()}>
          <For each={pills().shown}>
            {(label) => (
              <text fg={labelFg()} flexShrink={0}>
                {`[${truncate(label, 14)}] `}
              </text>
            )}
          </For>
          <Show when={pills().extra > 0}>
            <text fg={labelFg()} flexShrink={0}>
              {`+${pills().extra} `}
            </text>
          </Show>
        </Show>
        <text fg={subjectFg()} flexGrow={1} flexShrink={1}>
          {truncate(props.msg.subject ?? "(no subject)", isDense() ? 38 : 80)}
        </text>
        <Show when={showSender() && !showSecondRow()}>
          <text fg={metaFg()} width={COL.sender} flexShrink={0}>
            {truncate(props.msg.fromName ?? props.msg.fromEmail ?? "", COL.sender - 1)}
          </text>
        </Show>
        <text fg={metaFg()} width={COL.date} flexShrink={0}>
          {formatRelative(props.msg.date)}
        </text>
      </box>
      <Show when={showSecondRow()}>
        <box
          flexDirection="row"
          height={1}
          flexShrink={0}
          overflow="hidden"
          paddingLeft={5}
          paddingRight={1}
        >
          <text fg={metaFg()} flexGrow={1} flexShrink={1}>
            {truncate(props.msg.fromName ?? props.msg.fromEmail ?? "", 60)}
          </text>
        </box>
      </Show>
    </box>
  );
}

interface ScrollBoxLike {
  scrollTop: number;
  viewport?: { height: number };
  scrollHeight?: number;
  scrollTo?: (p: number | { x: number; y: number }) => void;
}

export function InboxList() {
  const s = useAppState();
  const [scrollRef, setScrollRef] = createSignal<ScrollBoxLike | undefined>(undefined);
  const SCROLL_MARGIN = 6;

  createEffect(() => {
    const sel = s.selected();
    const sb = scrollRef();
    if (DEBUG) setDebugRef(!!sb);
    if (!sb) return;
    const view = sb.viewport?.height ?? 0;
    const top = sb.scrollTop ?? 0;
    if (DEBUG) {
      setDebugTop(top);
      setDebugView(view);
      setDebugSh(sb.scrollHeight ?? 0);
    }
    if (view <= 0) return;
    let next = top;
    if (sel < top + SCROLL_MARGIN) {
      next = Math.max(0, sel - SCROLL_MARGIN);
    } else if (sel >= top + view - SCROLL_MARGIN) {
      next = Math.max(0, sel - view + SCROLL_MARGIN);
    }
    if (next !== top) {
      if (typeof sb.scrollTo === "function") sb.scrollTo(next);
      else sb.scrollTop = next;
    }
  });

  return (
    <scrollbox
      ref={(r: ScrollBoxLike) => setScrollRef(r)}
      scrollY
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
    >
      <For each={s.visibleMessages()}>
        {(msg, i) => (
          <MessageRow
            msg={msg}
            selected={s.selected() === i()}
            compact={s.readerOpen()}
            density={s.density()}
            activeFolder={s.activeFolder()}
            onClick={() => s.setSelected(i())}
            onDoubleClick={() => {
              s.setSelected(i());
              s.setActiveMsg(null);
              s.setReaderOpen(true);
            }}
          />
        )}
      </For>
    </scrollbox>
  );
}

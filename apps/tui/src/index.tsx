import { render, useKeyboard } from "@opentui/solid";
import { treaty } from "@elysiajs/eden";
import type { App as ApiApp, SearchHit } from "@grace/api";
import { DAEMON_DEFAULT_HOST, DAEMON_DEFAULT_PORT } from "@grace/env";
import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { createEffect, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { formatRelative, truncate } from "./format.ts";
import { subscribeSse, subscribeSseOnce } from "./sse.ts";

const client = treaty<ApiApp>(`http://${DAEMON_DEFAULT_HOST}:${DAEMON_DEFAULT_PORT}`);
const DEBUG = Boolean(process.env.GRACE_DEBUG);

type Message = {
  gmMsgid: string;
  gmThrid: string | null;
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  date: number;
  read: boolean;
  starred: boolean;
  labels: string[];
};

type Body = {
  gmMsgid: string;
  text: string | null;
  html: string | null;
  htmlPath: string | null;
  rawPath: string;
  attachments: { filename: string | null; contentType: string; size: number }[];
  sizeBytes: number;
  cached: boolean;
};

type Capabilities = { w3m: boolean };

async function fetchAuth() {
  const r = await client.api.auth.status.get();
  if (r.error) throw r.error;
  return r.data;
}

async function fetchMessages(folder: string): Promise<Message[]> {
  const r = await client.api.messages.get({ query: { folder, limit: "1000" } });
  if (r.error) throw r.error;
  return (r.data?.messages ?? []) as Message[];
}

type Folder = {
  path: string;
  name: string;
  specialUse: string | null;
  noSelect: boolean;
  messages: number | null;
  unseen: number | null;
  tracked: boolean;
};

async function fetchFolders(refresh = false): Promise<Folder[]> {
  const r = await client.api.folders.get({ query: refresh ? { refresh: "1" } : {} });
  if (r.error) throw r.error;
  return ((r.data as { folders?: Folder[] })?.folders ?? []).filter((f) => !f.noSelect);
}

async function activateFolder(path: string): Promise<void> {
  const r = await client.api.folders({ name: path }).activate.post();
  if (r.error) throw r.error;
}

async function fetchCapabilities(): Promise<Capabilities> {
  const r = await client.api.capabilities.get();
  if (r.error) throw r.error;
  return r.data as Capabilities;
}

async function fetchBody(gmMsgid: string): Promise<Body> {
  const r = await client.api.messages({ gmMsgid }).body.get();
  if (r.error) throw r.error;
  return r.data as Body;
}

type MutateAction = "toggle-read" | "toggle-star" | "archive" | "trash";

async function mutateMessage(gmMsgid: string, action: MutateAction): Promise<{ removed: boolean }> {
  const r = await client.api.messages({ gmMsgid }).mutate.post({ action });
  if (r.error) throw r.error;
  return { removed: Boolean((r.data as { removed?: boolean })?.removed) };
}

interface SendResult {
  ok: true;
  messageId: string;
  accepted: string[];
  rejected: string[];
}

async function sendDraft(draft: { to: string; subject: string; text: string }): Promise<SendResult> {
  const r = await client.api.send.post(draft);
  if (r.error) throw r.error;
  return r.data as SendResult;
}

async function importHit(hit: SearchHit): Promise<void> {
  const r = await client.api.messages.import.post({
    gmMsgid: hit.gmMsgid,
    gmThrid: hit.gmThrid,
    folder: hit.folder,
    uid: hit.uid,
    subject: hit.subject,
    fromName: hit.fromName,
    fromEmail: hit.fromEmail,
    date: hit.date,
    read: hit.read,
    starred: hit.starred,
    labels: hit.labels,
  });
  if (r.error) throw r.error;
}

async function w3mDump(htmlPath: string): Promise<string> {
  const proc = Bun.spawn(["w3m", "-dump", "-T", "text/html", htmlPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

function openInBrowser(path: string): void {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([opener, path]);
}

const COL = {
  flag: 2,
  star: 2,
  sender: 22,
  date: 6,
} as const;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

function Spinner(props: { color?: string; label?: string }) {
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
  onCleanup(() => clearInterval(timer));
  const color = () => props.color ?? "#9ca3af";
  return (
    <box flexDirection="row" flexShrink={0}>
      <text fg={color()}>{SPINNER_FRAMES[frame()]}</text>
      <Show when={props.label}>
        <text fg={color()}> {props.label}</text>
      </Show>
    </box>
  );
}

// Deferred visibility: wait 500ms before showing, hold ≥3s once shown.
// Mirrors opencode's startup-loading pattern — prevents flashy spinners on fast ops.
function useDeferredShow(active: () => boolean, showDelayMs = 500, minHoldMs = 3000) {
  const [show, setShow] = createSignal(false);
  let wait: ReturnType<typeof setTimeout> | undefined;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let shownAt = 0;

  createEffect(() => {
    if (active()) {
      if (hold) { clearTimeout(hold); hold = undefined; }
      if (show() || wait) return;
      wait = setTimeout(() => {
        wait = undefined;
        shownAt = Date.now();
        setShow(true);
      }, showDelayMs);
      return;
    }
    if (wait) { clearTimeout(wait); wait = undefined; }
    if (!show() || hold) return;
    const left = minHoldMs - (Date.now() - shownAt);
    if (left <= 0) { setShow(false); return; }
    hold = setTimeout(() => { hold = undefined; setShow(false); }, left);
  });

  onCleanup(() => {
    if (wait) clearTimeout(wait);
    if (hold) clearTimeout(hold);
  });

  return show;
}

function MessageRow(props: { msg: Message; selected: boolean; compact: boolean }) {
  const subjectFg = () => (props.selected ? "#ffffff" : props.msg.read ? "#7a7a7a" : "#e5e7eb");
  const metaFg = () => (props.selected ? "#b8d4ff" : "#6b7280");
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? "#1f3a5f" : "transparent"}
    >
      <text fg={props.msg.read ? "#3b3b3b" : "#4da3ff"} width={COL.flag} flexShrink={0}>
        {props.msg.read ? " " : "●"}
      </text>
      <text fg="#ffb700" width={COL.star} flexShrink={0}>
        {props.msg.starred ? "★" : " "}
      </text>
      <text fg={subjectFg()} flexGrow={1} flexShrink={1}>
        {truncate(props.msg.subject ?? "(no subject)", props.compact ? 38 : 80)}
      </text>
      <Show when={!props.compact}>
        <text fg={metaFg()} width={COL.sender} flexShrink={0}>
          {truncate(props.msg.fromName ?? props.msg.fromEmail ?? "", COL.sender - 1)}
        </text>
      </Show>
      <text fg={metaFg()} width={COL.date} flexShrink={0}>
        {formatRelative(props.msg.date)}
      </text>
    </box>
  );
}

interface ScrollBoxLike {
  scrollTop: number;
  viewport?: { height: number };
  scrollHeight?: number;
  scrollTo?: (p: number | { x: number; y: number }) => void;
}

export const [debugTop, setDebugTop] = createSignal(0);
export const [debugView, setDebugView] = createSignal(0);
export const [debugSh, setDebugSh] = createSignal(0);
export const [debugRef, setDebugRef] = createSignal(false);

function InboxList(props: { messages: Message[]; selected: () => number; compact: boolean }) {
  const [scrollRef, setScrollRef] = createSignal<ScrollBoxLike | undefined>(undefined);
  const SCROLL_MARGIN = 6;

  createEffect(() => {
    const sel = props.selected();
    const s = scrollRef();
    if (DEBUG) setDebugRef(!!s);
    if (!s) return;
    const view = s.viewport?.height ?? 0;
    const top = s.scrollTop ?? 0;
    if (DEBUG) {
      setDebugTop(top);
      setDebugView(view);
      setDebugSh(s.scrollHeight ?? 0);
    }
    if (view <= 0) return;
    let next = top;
    if (sel < top + SCROLL_MARGIN) {
      next = Math.max(0, sel - SCROLL_MARGIN);
    } else if (sel >= top + view - SCROLL_MARGIN) {
      next = Math.max(0, sel - view + SCROLL_MARGIN);
    }
    if (next !== top) {
      if (typeof s.scrollTo === "function") s.scrollTo(next);
      else s.scrollTop = next;
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
      <For each={props.messages}>
        {(msg, i) => <MessageRow msg={msg} selected={props.selected() === i()} compact={props.compact} />}
      </For>
    </scrollbox>
  );
}

function BodyHeader(props: { msg: Message }) {
  const fromLine = () =>
    props.msg.fromName
      ? `${props.msg.fromName} <${props.msg.fromEmail ?? ""}>`
      : (props.msg.fromEmail ?? "(unknown sender)");
  const dateLine = () => {
    const d = new Date(props.msg.date).toLocaleString();
    return props.msg.labels.length > 0 ? `${d}  ·  ${props.msg.labels.join(" · ")}` : d;
  };
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
    >
      <box height={1} flexShrink={0} overflow="hidden">
        <text attributes={1} fg="#ffffff">
          {truncate(props.msg.subject ?? "(no subject)", 200)}
        </text>
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
        <text fg="#9ca3af">{fromLine()}</text>
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
        <text fg="#6b7280">{dateLine()}</text>
      </box>
      <box height={1} flexShrink={0} backgroundColor="#1f2937" />
    </box>
  );
}

function Reader(props: {
  msg: Message;
  body: Body | undefined;
  loading: boolean;
  error: unknown;
  rendered: string | null;
  renderMode: "text" | "w3m";
  w3mBusy: boolean;
  staleLines: string[] | null;
}) {
  const lines = () => {
    if (props.renderMode === "w3m" && props.rendered) return props.rendered.split("\n");
    const text = props.body?.text;
    if (text) return text.split("\n");
    const html = props.body?.html;
    if (html) return ["(no plain-text part — press v for w3m render or V to open in browser)"];
    return [""];
  };
  const showStale = () => props.loading && props.staleLines && props.staleLines.length > 0;
  const displayLines = () => (showStale() ? props.staleLines! : lines());
  const textColor = () => (showStale() ? "#4b5563" : "#d1d5db");

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
      <BodyHeader msg={props.msg} />
      <Show when={!props.error} fallback={
        <box padding={1}><text fg="#f87171">failed to load body: {String(props.error)}</text></box>
      }>
        <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={1} paddingRight={1}>
          <Show when={props.loading && !showStale()}>
            <box flexDirection="row" padding={1}>
              <Spinner color="#6b7280" label="loading body…" />
            </box>
          </Show>
          <Show when={props.w3mBusy}>
            <box flexDirection="row" padding={1}>
              <Spinner color="#6b7280" label="rendering html…" />
            </box>
          </Show>
          <For each={displayLines()}>
            {(line) => (
              <box height={1} flexShrink={0} overflow="hidden">
                <text fg={textColor()}>{line || " "}</text>
              </box>
            )}
          </For>
          <Show when={!showStale() && props.body?.attachments && props.body.attachments.length > 0}>
            <box height={1} flexShrink={0} backgroundColor="#1f2937" />
            <text fg="#9ca3af">attachments:</text>
            <For each={props.body!.attachments}>
              {(a) => (
                <text fg="#6b7280">
                  {"  "}
                  {a.filename ?? "(unnamed)"} · {a.contentType} · {formatBytes(a.size)}
                </text>
              )}
            </For>
          </Show>
        </scrollbox>
      </Show>
    </box>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function SearchHitRow(props: { hit: SearchHit; selected: boolean }) {
  const subjectFg = () => (props.selected ? "#ffffff" : "#e5e7eb");
  const metaFg = () => (props.selected ? "#b8d4ff" : "#6b7280");
  const badgeFg = () => (props.hit.inLocal ? "#4ade80" : "#fbbf24");
  const badge = () => (props.hit.inLocal ? "L" : "R");
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? "#1f3a5f" : "transparent"}
    >
      <text fg={badgeFg()} width={2} flexShrink={0}>
        {badge()}
      </text>
      <text fg={subjectFg()} flexGrow={1} flexShrink={1}>
        {truncate(props.hit.subject ?? "(no subject)", 60)}
      </text>
      <text fg={metaFg()} width={22} flexShrink={0}>
        {truncate(props.hit.fromName ?? props.hit.fromEmail ?? "", 21)}
      </text>
      <text fg={metaFg()} width={6} flexShrink={0}>
        {formatRelative(props.hit.date)}
      </text>
    </box>
  );
}

function SearchOverlay(props: {
  hits: SearchHit[];
  selected: number;
  phase: "idle" | "searching" | "local-done" | "done" | "error";
  errorMessage: string | null;
  hasQuery: boolean;
  onInput: (value: string) => void;
  inputRef: (r: InputRenderable) => void;
}) {
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor="#1f2937"
      >
        <text fg="#9ca3af" flexShrink={0}>
          search:{" "}
        </text>
        <input
          ref={props.inputRef}
          focused
          onInput={props.onInput}
          textColor="#ffffff"
          focusedTextColor="#ffffff"
          cursorColor="#4da3ff"
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          flexShrink={1}
        />
      </box>
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <Switch fallback={<text fg="#6b7280" flexGrow={1}>type Gmail query · esc cancels</text>}>
          <Match when={props.phase === "searching"}>
            <Spinner color="#6b7280" label="searching…" />
          </Match>
          <Match when={props.phase === "local-done"}>
            <Spinner color="#6b7280" label={`local ${props.hits.length} · fetching Gmail…`} />
          </Match>
          <Match when={props.phase === "done"}>
            <text fg="#6b7280" flexGrow={1}>
              {props.hits.length} result{props.hits.length === 1 ? "" : "s"}
            </text>
          </Match>
          <Match when={props.phase === "error"}>
            <text fg="#f87171" flexGrow={1}>error: {props.errorMessage ?? "unknown"}</text>
          </Match>
        </Switch>
      </box>
      <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0}>
        <For each={props.hits} fallback={
          <box padding={1}><text fg="#6b7280">
            <Show when={!props.hasQuery} fallback="no results yet">
              start typing to search local cache + Gmail
            </Show>
          </text></box>
        }>
          {(hit, i) => <SearchHitRow hit={hit} selected={props.selected === i()} />}
        </For>
      </scrollbox>
    </box>
  );
}

const SPECIAL_ORDER: Record<string, number> = {
  "\\Important": 2,
  "\\Flagged": 3,
  "\\Drafts": 4,
  "\\Sent": 5,
  "\\All": 6,
  "\\Junk": 7,
  "\\Trash": 8,
};

function orderFolders(fs: Folder[]): Folder[] {
  const rank = (f: Folder): number => {
    if (f.path === "INBOX") return 1;
    if (f.specialUse && f.specialUse in SPECIAL_ORDER) return SPECIAL_ORDER[f.specialUse]!;
    return 9;
  };
  return [...fs].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
}

function FolderRow(props: { folder: Folder; selected: boolean; focused: boolean }) {
  const fg = () =>
    props.focused && props.selected
      ? "#ffffff"
      : props.selected
        ? "#d1d5db"
        : "#9ca3af";
  const countFg = () => ((props.folder.unseen ?? 0) > 0 ? "#4da3ff" : "#4b5563");
  const label = () => {
    if (props.folder.path === "INBOX") return "Inbox";
    if (props.folder.specialUse === "\\All") return "All Mail";
    if (props.folder.specialUse === "\\Sent") return "Sent";
    if (props.folder.specialUse === "\\Drafts") return "Drafts";
    if (props.folder.specialUse === "\\Trash") return "Trash";
    if (props.folder.specialUse === "\\Junk") return "Spam";
    if (props.folder.specialUse === "\\Flagged") return "Starred";
    if (props.folder.specialUse === "\\Important") return "Important";
    return props.folder.name;
  };
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        props.selected ? (props.focused ? "#1f3a5f" : "#1f2937") : "transparent"
      }
    >
      <text fg={fg()} flexGrow={1} flexShrink={1}>
        {truncate(label(), 18)}
      </text>
      <Show when={(props.folder.unseen ?? 0) > 0}>
        <text fg={countFg()} flexShrink={0}>
          {props.folder.unseen}
        </text>
      </Show>
    </box>
  );
}

type ComposeField = "to" | "subject" | "body";

function ComposeOverlay(props: {
  field: ComposeField;
  sending: boolean;
  showSpinner: boolean;
  statusLine: string;
  onToInput: (v: string) => void;
  onSubjectInput: (v: string) => void;
  onBodyChange: () => void;
  onFieldSubmit: () => void;
  toRef: (r: InputRenderable) => void;
  subjectRef: (r: InputRenderable) => void;
  bodyRef: (r: TextareaRenderable) => void;
}) {
  const cursor = () => (props.sending ? "#4b5563" : "#4da3ff");
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor="#1e293b"
      >
        <text attributes={1} fg="#ffffff" flexGrow={1}>
          compose
        </text>
        <Show when={props.showSpinner} fallback={<text fg="#9ca3af">{props.statusLine}</text>}>
          <Spinner color="#fbbf24" label="sending…" />
        </Show>
      </box>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props.field === "to" ? "#1f2937" : "transparent"}
      >
        <text fg={props.field === "to" ? "#ffffff" : "#6b7280"} width={9} flexShrink={0}>
          To:
        </text>
        <input
          ref={props.toRef}
          focused={props.field === "to"}
          onInput={props.onToInput}
          onSubmit={props.onFieldSubmit}
          textColor="#e5e7eb"
          focusedTextColor="#e5e7eb"
          cursorColor={cursor()}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          placeholder="name@example.com"
          placeholderColor="#4b5563"
          flexGrow={1}
          flexShrink={1}
        />
      </box>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props.field === "subject" ? "#1f2937" : "transparent"}
      >
        <text fg={props.field === "subject" ? "#ffffff" : "#6b7280"} width={9} flexShrink={0}>
          Subject:
        </text>
        <input
          ref={props.subjectRef}
          focused={props.field === "subject"}
          onInput={props.onSubjectInput}
          onSubmit={props.onFieldSubmit}
          textColor="#e5e7eb"
          focusedTextColor="#e5e7eb"
          cursorColor={cursor()}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          flexShrink={1}
        />
      </box>
      <box height={1} flexShrink={0} backgroundColor="#1f2937" />
      <box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={props.field === "body" ? "#1f2937" : "transparent"}
      >
        <textarea
          ref={props.bodyRef}
          focused={props.field === "body"}
          onContentChange={props.onBodyChange}
          textColor="#e5e7eb"
          focusedTextColor="#e5e7eb"
          cursorColor={cursor()}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
        />
      </box>
    </box>
  );
}

function App() {
  const [auth] = createResource(fetchAuth);
  const [caps] = createResource(fetchCapabilities);
  const [activeFolder, setActiveFolder] = createSignal("INBOX");
  const [folders, { refetch: refetchFolders }] = createResource(() => fetchFolders(false));
  const orderedFolders = () => orderFolders(folders() ?? []);
  const [sidebarFocused, setSidebarFocused] = createSignal(false);
  const [folderSelected, setFolderSelected] = createSignal(0);
  const [messages, { refetch }] = createResource(activeFolder, fetchMessages);
  const [selected, setSelected] = createSignal(0);
  const [readerOpen, setReaderOpen] = createSignal(false);
  const [activeMsg, setActiveMsg] = createSignal<Message | null>(null);
  const [lastUpdated, setLastUpdated] = createSignal<number | null>(null);
  const [liveStatus, setLiveStatus] = createSignal<"connecting" | "live" | "offline">("connecting");
  const [newFlash, setNewFlash] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal<string | null>(null);
  const [syncProgress, setSyncProgress] = createSignal<{ done: number; target: number } | null>(null);
  const [renderMode, setRenderMode] = createSignal<"text" | "w3m">("text");
  const [rendered, setRendered] = createSignal<string | null>(null);
  const [w3mBusy, setW3mBusy] = createSignal(false);
  const [staleLines, setStaleLines] = createSignal<string[] | null>(null);

  type PendingPatch = { read?: boolean; starred?: boolean; removed?: boolean };
  const [pending, setPending] = createSignal<Record<string, PendingPatch>>({});

  function patchPending(gmMsgid: string, patch: PendingPatch) {
    setPending((prev) => ({ ...prev, [gmMsgid]: { ...(prev[gmMsgid] ?? {}), ...patch } }));
  }
  function clearPending(gmMsgid: string) {
    setPending((prev) => {
      if (!(gmMsgid in prev)) return prev;
      const next = { ...prev };
      delete next[gmMsgid];
      return next;
    });
  }
  function applyPending(msg: Message): Message {
    const patch = pending()[msg.gmMsgid];
    if (!patch) return msg;
    return {
      ...msg,
      read: patch.read ?? msg.read,
      starred: patch.starred ?? msg.starred,
    };
  }

  const [composeOpen, setComposeOpen] = createSignal(false);
  const [composeField, setComposeField] = createSignal<ComposeField>("to");
  let composeTo = "";
  let composeSubject = "";
  let composeBody = "";
  let toInput: InputRenderable | undefined;
  let subjectInput: InputRenderable | undefined;
  let bodyArea: TextareaRenderable | undefined;
  const [composeSending, setComposeSending] = createSignal(false);
  const showComposeSpinner = useDeferredShow(composeSending);
  const [composeStatus, setComposeStatus] = createSignal("tab field · ctrl+s send · esc close");

  function openCompose() {
    composeTo = "";
    composeSubject = "";
    composeBody = "";
    toInput?.setText("");
    subjectInput?.setText("");
    bodyArea?.setText("");
    setComposeField("to");
    setComposeStatus("tab field · ctrl+s send · esc close");
    setComposeOpen(true);
  }

  function closeCompose() {
    setComposeOpen(false);
    setComposeSending(false);
  }

  function nextField(cur: ComposeField, reverse = false): ComposeField {
    const order: ComposeField[] = ["to", "subject", "body"];
    const i = order.indexOf(cur);
    const next = reverse ? (i + order.length - 1) % order.length : (i + 1) % order.length;
    return order[next]!;
  }

  async function doSend() {
    if (composeSending()) return;
    const to = composeTo.trim();
    const subject = composeSubject.trim();
    const text = composeBody;
    if (!to) { setComposeStatus("error: recipient required"); setComposeField("to"); return; }
    if (!subject) { setComposeStatus("error: subject required"); setComposeField("subject"); return; }
    if (!text.trim()) { setComposeStatus("error: body required"); setComposeField("body"); return; }

    setComposeSending(true);
    setComposeStatus("sending…");
    try {
      const res = await sendDraft({ to, subject, text });
      flashToast(`sent to ${res.accepted.join(", ")}`);
      closeCompose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setComposeStatus(`send failed: ${msg}`);
      setComposeSending(false);
    }
  }

  const [searchOpen, setSearchOpen] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchHits, setSearchHits] = createSignal<SearchHit[]>([]);
  const [searchSelected, setSearchSelected] = createSignal(0);
  const [searchPhase, setSearchPhase] = createSignal<"idle" | "searching" | "local-done" | "done" | "error">("idle");
  const [searchError, setSearchError] = createSignal<string | null>(null);
  let searchInput: InputRenderable | undefined;
  let searchAbort: (() => void) | null = null;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  function hitToMessage(h: SearchHit): Message {
    return {
      gmMsgid: h.gmMsgid,
      gmThrid: h.gmThrid,
      subject: h.subject,
      fromName: h.fromName,
      fromEmail: h.fromEmail,
      date: h.date,
      read: h.read,
      starred: h.starred,
      labels: h.labels,
    };
  }

  const visibleMessages = (): Message[] => {
    const list = messages();
    if (!list) return [];
    const p = pending();
    return list
      .filter((m) => !p[m.gmMsgid]?.removed)
      .map((m) => applyPending(m));
  };

  const currentMsg = (): Message | null => {
    const override = activeMsg();
    if (override) return applyPending(override);
    const list = visibleMessages();
    if (list.length === 0) return null;
    return list[selected()] ?? null;
  };

  const bodySource = () => {
    if (!readerOpen()) return null;
    const m = currentMsg();
    return m ? m.gmMsgid : null;
  };

  function cancelSearch() {
    if (searchAbort) {
      searchAbort();
      searchAbort = null;
    }
    if (searchDebounce) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
  }

  function closeSearch() {
    cancelSearch();
    setSearchOpen(false);
    setSearchQuery("");
    setSearchHits([]);
    setSearchSelected(0);
    setSearchPhase("idle");
    setSearchError(null);
  }

  function runSearch(q: string) {
    cancelSearch();
    setSearchHits([]);
    setSearchSelected(0);
    setSearchError(null);
    if (!q.trim()) {
      setSearchPhase("idle");
      return;
    }
    setSearchPhase("searching");
    const url = `http://${DAEMON_DEFAULT_HOST}:${DAEMON_DEFAULT_PORT}/api/search?q=${encodeURIComponent(q)}`;
    searchAbort = subscribeSseOnce(url, {
      onEvent: (type, data) => {
        if (type === "hit") {
          try {
            const hit = JSON.parse(data) as SearchHit;
            setSearchHits((prev) => [...prev, hit]);
          } catch {}
        } else if (type === "phase") {
          try {
            const p = JSON.parse(data) as { phase: string };
            if (p.phase === "local-done") setSearchPhase("local-done");
          } catch {}
        } else if (type === "done") {
          setSearchPhase("done");
        } else if (type === "error") {
          try {
            const p = JSON.parse(data) as { message: string };
            setSearchError(p.message);
            setSearchPhase("error");
            flashToast(`search: ${p.message}`);
          } catch {
            setSearchError("unknown error");
            setSearchPhase("error");
            flashToast("search: unknown error");
          }
        }
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setSearchError(msg);
        setSearchPhase("error");
        flashToast(`search: ${msg}`);
      },
    });
  }

  createEffect(() => {
    if (!searchOpen()) return;
    const q = searchQuery();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => runSearch(q), 200);
  });

  onCleanup(() => cancelSearch());

  async function openSelectedHit() {
    const hits = searchHits();
    const hit = hits[searchSelected()];
    if (!hit) return;
    if (!hit.inLocal) {
      try {
        await importHit(hit);
        void refetch();
      } catch (err) {
        flashToast(`import failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    setActiveMsg(hitToMessage(hit));
    closeSearch();
    setReaderOpen(true);
  }

  const [body] = createResource(bodySource, async (id) => {
    if (!id) return undefined;
    return fetchBody(id);
  });

  // Snapshot the currently-rendered body lines so we can keep them dimmed
  // while the next message loads (instead of blanking the pane).
  createEffect(() => {
    const id = bodySource();
    const b = body();
    if (!id) {
      setStaleLines(null);
      return;
    }
    if (body.loading) return;
    if (b) {
      const text = b.text;
      setStaleLines(text ? text.split("\n") : null);
    }
  });

  createEffect(() => {
    const id = bodySource();
    if (id) {
      setRenderMode("text");
      setRendered(null);
      setW3mBusy(false);
    }
  });

  createEffect(() => {
    const list = visibleMessages();
    if (messages()) setLastUpdated(Date.now());
    if (selected() >= list.length) setSelected(Math.max(0, list.length - 1));
  });

  async function switchFolder(path: string) {
    if (path === activeFolder()) {
      setSidebarFocused(false);
      return;
    }
    setPending({});
    setSelected(0);
    setReaderOpen(false);
    setActiveMsg(null);
    closeSearch();
    setActiveFolder(path);
    setSidebarFocused(false);
    try {
      await activateFolder(path);
      void refetch();
      void refetchFolders();
    } catch (err) {
      flashToast(`activate failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  createEffect(() => {
    const list = orderedFolders();
    if (list.length === 0) return;
    const idx = list.findIndex((f) => f.path === activeFolder());
    if (idx >= 0) setFolderSelected(idx);
  });

  async function runMutation(msg: Message, action: MutateAction) {
    const before = { read: msg.read, starred: msg.starred };
    const willRemove = action === "archive" || action === "trash";
    // Capture active-ness BEFORE mutating pending, otherwise filtering the
    // removed row out of visibleMessages() shifts currentMsg() to a neighbour
    // and the reader stays open on the wrong message.
    const isActiveReader = willRemove && readerOpen() && currentMsg()?.gmMsgid === msg.gmMsgid;

    if (action === "toggle-read") patchPending(msg.gmMsgid, { read: !msg.read });
    else if (action === "toggle-star") patchPending(msg.gmMsgid, { starred: !msg.starred });
    else patchPending(msg.gmMsgid, { removed: true });

    if (isActiveReader) {
      setReaderOpen(false);
      setActiveMsg(null);
    }

    try {
      await mutateMessage(msg.gmMsgid, action);
      flashToast(toastFor(action));
    } catch (err) {
      patchPending(msg.gmMsgid, { read: before.read, starred: before.starred, removed: false });
      clearPending(msg.gmMsgid);
      flashToast(`${action} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function toastFor(a: MutateAction): string {
    switch (a) {
      case "archive": return "archived";
      case "trash": return "moved to trash";
      case "toggle-read": return "toggled read";
      case "toggle-star": return "toggled star";
    }
  }

  function flashToast(msg: string, ms = 2500) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  }

  function triggerW3m() {
    if (!caps()?.w3m) {
      flashToast("w3m not installed — install to enable rich view");
      return;
    }
    const b = body();
    if (!b?.htmlPath) {
      flashToast("no HTML part in this message");
      return;
    }
    if (w3mBusy()) return;
    setW3mBusy(true);
    // Fire-and-forget: awaiting inside the keyboard handler freezes the TUI
    // for the duration of the subprocess (500ms+ on big HTML).
    void w3mDump(b.htmlPath)
      .then((dump) => {
        setRendered(dump);
        setRenderMode("w3m");
      })
      .catch((err) => {
        flashToast(`w3m failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setW3mBusy(false));
  }

  onMount(() => {
    const url = `http://${DAEMON_DEFAULT_HOST}:${DAEMON_DEFAULT_PORT}/api/events`;
    const stop = subscribeSse(url, {
      onOpen: () => setLiveStatus("live"),
      onError: () => setLiveStatus("offline"),
      onEvent: (type, data) => {
        if (type === "mail.received") {
          try {
            const parsed = JSON.parse(data) as { folder: string; subject: string | null };
            if (parsed.folder === activeFolder()) {
              setNewFlash(`new: ${parsed.subject ?? "(no subject)"}`);
              setTimeout(() => setNewFlash(null), 4000);
              void refetch();
            }
            void refetchFolders();
          } catch {}
        } else if (type === "mail.updated") {
          try {
            const parsed = JSON.parse(data) as { gmMsgid?: string };
            if (parsed.gmMsgid) clearPending(parsed.gmMsgid);
          } catch {}
          void refetch();
        } else if (type === "folder.sync.progress") {
          try {
            const parsed = JSON.parse(data) as { folder: string; done: number; target: number };
            if (parsed.folder !== activeFolder()) return;
            setSyncProgress({ done: parsed.done, target: parsed.target });
            if (parsed.done >= parsed.target) {
              void refetch();
              setTimeout(() => setSyncProgress(null), 2500);
            }
          } catch {}
        }
      },
    });
    onCleanup(stop);
  });

  useKeyboard((e) => {
    const list = visibleMessages();
    const total = list.length;

    // Compose: native input/textarea handle typing. We only intercept shortcuts.
    if (composeOpen()) {
      if (composeSending()) {
        if (e.name === "escape") { e.preventDefault(); closeCompose(); }
        return;
      }
      if (e.name === "escape") { e.preventDefault(); closeCompose(); return; }
      if (e.ctrl && (e.name === "s" || e.name === "return")) {
        e.preventDefault();
        void doSend();
        return;
      }
      if (e.name === "tab") {
        e.preventDefault();
        setComposeField((f) => nextField(f, e.shift));
        return;
      }
      return;
    }

    if (e.name === "tab" && !searchOpen() && !readerOpen()) {
      setSidebarFocused((f) => !f);
      return;
    }

    if (sidebarFocused() && !readerOpen() && !searchOpen()) {
      const fs = orderedFolders();
      if (e.name === "escape") { setSidebarFocused(false); return; }
      if (e.name === "j" || e.name === "down") {
        setFolderSelected((s) => Math.min(Math.max(0, fs.length - 1), s + 1));
        return;
      }
      if (e.name === "k" || e.name === "up") {
        setFolderSelected((s) => Math.max(0, s - 1));
        return;
      }
      if (e.name === "return") {
        const picked = fs[folderSelected()];
        if (picked) void switchFolder(picked.path);
        return;
      }
      return;
    }

    // Search: native input handles typing; only intercept non-char keys.
    if (searchOpen() && !readerOpen()) {
      if (e.name === "escape") { e.preventDefault(); closeSearch(); return; }
      if (e.name === "return") {
        e.preventDefault();
        void openSelectedHit();
        return;
      }
      if (e.name === "down" || (e.ctrl && e.name === "j")) {
        e.preventDefault();
        setSearchSelected((s) => Math.min(Math.max(0, searchHits().length - 1), s + 1));
        return;
      }
      if (e.name === "up" || (e.ctrl && e.name === "k")) {
        e.preventDefault();
        setSearchSelected((s) => Math.max(0, s - 1));
        return;
      }
      return;
    }

    if (readerOpen()) {
      if (e.name === "escape") {
        setReaderOpen(false);
        setActiveMsg(null);
        return;
      }
      if (!e.ctrl && !e.meta) {
        const m = currentMsg();
        if (m) {
          if (e.name === "m" && !e.shift) { void runMutation(m, "toggle-read"); return; }
          if (e.name === "s" && !e.shift) { void runMutation(m, "toggle-star"); return; }
          if (e.name === "e" && !e.shift) { void runMutation(m, "archive"); return; }
          if (e.name === "#" || (e.shift && e.name === "3")) { void runMutation(m, "trash"); return; }
        }
      }
      if (e.name === "v" && !e.shift && !e.ctrl && !e.meta) {
        triggerW3m();
        return;
      }
      if (e.name === "v" && e.shift) {
        const b = body();
        if (!b?.htmlPath) { flashToast("no HTML part to open"); return; }
        openInBrowser(b.htmlPath);
        flashToast("opened in browser");
        return;
      }
      if (e.name === "t" && !e.shift && !e.ctrl && !e.meta) {
        setRenderMode("text");
        setRendered(null);
        return;
      }
    }

    if (e.name === "/" && !e.ctrl && !e.meta && !searchOpen()) {
      setSearchOpen(true);
      return;
    }
    if (e.name === "c" && !e.ctrl && !e.meta && !e.shift) {
      openCompose();
      return;
    }
    if (e.name === "r" && !e.ctrl && !e.meta) {
      void refetch();
      return;
    }
    if (!total) return;
    if (e.name === "j" || e.name === "down") {
      setSelected((s) => Math.min(total - 1, s + 1));
    } else if (e.name === "k" || e.name === "up") {
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.name === "g" && !e.shift) {
      setSelected(0);
    } else if (e.name === "g" && e.shift) {
      setSelected(total - 1);
    } else if (e.name === "return") {
      setActiveMsg(null);
      setReaderOpen(true);
    } else if (!e.ctrl && !e.meta) {
      const m = list[selected()];
      if (!m) return;
      if (e.name === "m" && !e.shift) { void runMutation(m, "toggle-read"); return; }
      if (e.name === "s" && !e.shift) { void runMutation(m, "toggle-star"); return; }
      if (e.name === "e" && !e.shift) { void runMutation(m, "archive"); return; }
      if (e.name === "#" || (e.shift && e.name === "3")) { void runMutation(m, "trash"); return; }
    }
  });

  return (
    <box flexDirection="column" style={{ height: "100%" }}>
      {/* Top bar */}
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor="#0b1220"
      >
        <text attributes={1} fg="#ffffff" flexGrow={1}>
          grace
        </text>
        <text fg="#6b7280">
          <Switch fallback="connecting…">
            <Match when={auth.error}>daemon unreachable</Match>
            <Match when={auth()?.signedIn}>{auth()!.email}</Match>
            <Match when={auth() && !auth()!.signedIn}>not signed in</Match>
          </Switch>
        </text>
      </box>

      {/* Folder header */}
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor="#111827"
      >
        <text fg="#9ca3af" flexGrow={1}>
          {activeFolder()}{messages() ? ` · ${visibleMessages().length}` : ""}
        </text>
        <Show when={syncProgress()}>
          <text fg="#60a5fa" paddingRight={2}>
            {syncProgress()!.done}/{syncProgress()!.target}
            {syncProgress()!.done < syncProgress()!.target ? " syncing" : " synced ✓"}
          </text>
        </Show>
        <Show when={toast()}>
          <text fg="#fbbf24" paddingRight={2}>
            {toast()}
          </text>
        </Show>
        <Show when={newFlash()}>
          <text fg="#4ade80" paddingRight={2}>
            {newFlash()}
          </text>
        </Show>
        <text fg={liveStatus() === "live" ? "#4ade80" : liveStatus() === "offline" ? "#f87171" : "#6b7280"} paddingRight={2}>
          {liveStatus() === "live" ? "● live" : liveStatus() === "offline" ? "○ offline" : "◌ ..."}
        </text>
        <text fg="#4b5563">
          <Switch fallback="">
            <Match when={messages.loading}>syncing…</Match>
            <Match when={lastUpdated()}>updated {formatRelative(lastUpdated()!)}</Match>
          </Switch>
        </text>
      </box>

      {/* Sidebar + list + optional reader */}
      <Show
        when={messages()}
        fallback={
          <box flexGrow={1} padding={1}>
            <text fg="#6b7280">loading inbox…</text>
          </box>
        }
      >
        <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0}>
          <box
            flexDirection="column"
            width={22}
            flexShrink={0}
            minHeight={0}
            overflow="hidden"
            backgroundColor={sidebarFocused() ? "#0f172a" : "#0b1220"}
          >
            <box
              flexDirection="row"
              height={1}
              flexShrink={0}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={sidebarFocused() ? "#1e293b" : "#111827"}
            >
              <text fg={sidebarFocused() ? "#ffffff" : "#9ca3af"} flexGrow={1}>
                folders
              </text>
            </box>
            <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0}>
              <For each={orderedFolders()} fallback={
                <box padding={1}><text fg="#6b7280">loading…</text></box>
              }>
                {(f, i) => (
                  <FolderRow
                    folder={f}
                    selected={
                      sidebarFocused()
                        ? folderSelected() === i()
                        : f.path === activeFolder()
                    }
                    focused={sidebarFocused()}
                  />
                )}
              </For>
            </scrollbox>
          </box>
          <box width={1} flexShrink={0} backgroundColor="#1f2937" />
          <Show
            when={!composeOpen()}
            fallback={
              <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} minWidth={0}>
                <ComposeOverlay
                  field={composeField()}
                  sending={composeSending()}
                  showSpinner={showComposeSpinner()}
                  statusLine={composeStatus()}
                  onToInput={(v) => { composeTo = v; }}
                  onSubjectInput={(v) => { composeSubject = v; }}
                  onBodyChange={() => { composeBody = bodyArea?.plainText ?? ""; }}
                  onFieldSubmit={() => setComposeField((f) => nextField(f))}
                  toRef={(r) => { toInput = r; }}
                  subjectRef={(r) => { subjectInput = r; }}
                  bodyRef={(r) => { bodyArea = r; }}
                />
              </box>
            }
          >
          <box
            flexDirection="column"
            flexGrow={readerOpen() ? 0 : 1}
            flexShrink={1}
            minHeight={0}
            minWidth={0}
            {...(readerOpen() ? { width: 48 } : {})}
          >
            <Show
              when={searchOpen()}
              fallback={
                <InboxList messages={visibleMessages()} selected={selected} compact={readerOpen()} />
              }
            >
              <SearchOverlay
                hits={searchHits()}
                selected={searchSelected()}
                phase={searchPhase()}
                errorMessage={searchError()}
                hasQuery={searchQuery() !== ""}
                onInput={setSearchQuery}
                inputRef={(r) => { searchInput = r; }}
              />
            </Show>
          </box>
          <Show when={readerOpen() && currentMsg()}>
            <box width={1} flexShrink={0} backgroundColor="#1f2937" />
            <Reader
              msg={currentMsg()!}
              body={body()}
              loading={body.loading}
              error={body.error}
              rendered={rendered()}
              renderMode={renderMode()}
              w3mBusy={w3mBusy()}
              staleLines={staleLines()}
            />
          </Show>
          </Show>
        </box>
      </Show>

      {/* Bottom help bar */}
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor="#0b1220"
      >
        <text fg="#4b5563" flexGrow={1}>
          <Switch fallback="tab folders · j/k nav · enter open · c compose · m read · s star · e archive · # trash · / search">
            <Match when={composeOpen()}>
              tab field · ctrl+s send · esc close
            </Match>
            <Match when={sidebarFocused()}>
              j/k nav · enter switch · tab/esc back to list
            </Match>
            <Match when={searchOpen() && !readerOpen()}>
              type to search · ↑↓ nav · enter open · esc cancel
            </Match>
            <Match when={readerOpen()}>
              m read · s star · e archive · # trash{caps()?.w3m ? " · v rich" : ""} · V browser · t text · esc close
            </Match>
          </Switch>
        </text>
        <Show when={DEBUG}>
          <text fg="#ef4444" paddingRight={2}>
            sel={selected()} top={debugTop()} view={debugView()} sh={debugSh()} ref={debugRef() ? "y" : "n"}
          </text>
        </Show>
        <text fg="#4b5563">ctrl+c exit</text>
      </box>
    </box>
  );
}

render(() => <App />);

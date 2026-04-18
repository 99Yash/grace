import { render, useKeyboard } from "@opentui/solid";
import { treaty } from "@elysiajs/eden";
import type { App as ApiApp, SearchHit } from "@grace/api";
import { DAEMON_DEFAULT_HOST, DAEMON_DEFAULT_PORT } from "@grace/env";
import { createEffect, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { formatRelative, truncate } from "./format.ts";
import { subscribeSse, subscribeSseOnce } from "./sse.ts";

const client = treaty<ApiApp>(`http://${DAEMON_DEFAULT_HOST}:${DAEMON_DEFAULT_PORT}`);

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

// Reactive debug state so UI actually updates. Set from InboxList.
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
    setDebugRef(!!s);
    if (!s) return;
    const view = s.viewport?.height ?? 0;
    const top = s.scrollTop ?? 0;
    setDebugTop(top);
    setDebugView(view);
    setDebugSh(s.scrollHeight ?? 0);
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
}) {
  const lines = () => {
    if (props.renderMode === "w3m" && props.rendered) return props.rendered.split("\n");
    const text = props.body?.text;
    if (text) return text.split("\n");
    const html = props.body?.html;
    if (html) return ["(no plain-text part — press v for w3m render or V to open in browser)"];
    return [""];
  };
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
      <BodyHeader msg={props.msg} />
      <Show when={!props.error} fallback={
        <box padding={1}><text fg="#f87171">failed to load body: {String(props.error)}</text></box>
      }>
        <Show when={!props.loading} fallback={
          <box padding={1}><text fg="#6b7280">loading body…</text></box>
        }>
          <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={1} paddingRight={1}>
            <For each={lines()}>
              {(line) => (
                <box height={1} flexShrink={0} overflow="hidden">
                  <text fg="#d1d5db">{line || " "}</text>
                </box>
              )}
            </For>
            <Show when={props.body?.attachments && props.body.attachments.length > 0}>
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
  query: string;
  hits: SearchHit[];
  selected: number;
  phase: "idle" | "searching" | "local-done" | "done" | "error";
  errorMessage: string | null;
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
        <text fg="#ffffff" flexGrow={1} flexShrink={1}>
          {props.query}
        </text>
        <text fg="#4da3ff" flexShrink={0}>
          ▌
        </text>
      </box>
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <text fg="#6b7280" flexGrow={1}>
          <Switch fallback="type Gmail query · esc cancels">
            <Match when={props.phase === "searching"}>searching…</Match>
            <Match when={props.phase === "local-done"}>local {props.hits.length} · fetching Gmail…</Match>
            <Match when={props.phase === "done"}>{props.hits.length} result{props.hits.length === 1 ? "" : "s"}</Match>
            <Match when={props.phase === "error"}>error: {props.errorMessage ?? "unknown"}</Match>
          </Switch>
        </text>
      </box>
      <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0}>
        <For each={props.hits} fallback={
          <box padding={1}><text fg="#6b7280">
            <Show when={props.query === ""} fallback="no results yet">
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
  to: string;
  subject: string;
  body: string;
  field: ComposeField;
  sending: boolean;
  statusLine: string;
}) {
  const fieldRow = (label: string, value: string, focused: boolean, multiline = false) => {
    const lines = multiline ? (value === "" ? [""] : value.split("\n")) : [value];
    return (
      <box
        flexDirection="row"
        flexShrink={multiline ? 1 : 0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={focused ? "#1f2937" : "transparent"}
      >
        <text fg={focused ? "#ffffff" : "#6b7280"} width={9} flexShrink={0}>
          {label}
        </text>
        <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={multiline ? 0 : 1}>
          <For each={lines}>
            {(line, i) => (
              <box height={1} flexShrink={0} overflow="hidden" flexDirection="row">
                <text fg="#e5e7eb" flexGrow={1} flexShrink={1}>
                  {line || " "}
                </text>
                <Show when={focused && i() === lines.length - 1}>
                  <text fg="#4da3ff" flexShrink={0}>▌</text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </box>
    );
  };

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
        <text fg="#9ca3af">{props.statusLine}</text>
      </box>
      {fieldRow("To:", props.to, props.field === "to")}
      {fieldRow("Subject:", props.subject, props.field === "subject")}
      <box height={1} flexShrink={0} backgroundColor="#1f2937" />
      <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0}>
        {fieldRow("", props.body, props.field === "body", true)}
      </scrollbox>
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
  const [composeTo, setComposeTo] = createSignal("");
  const [composeSubject, setComposeSubject] = createSignal("");
  const [composeBody, setComposeBody] = createSignal("");
  const [composeSending, setComposeSending] = createSignal(false);
  const [composeStatus, setComposeStatus] = createSignal("tab field · ctrl+s send · esc close");

  function openCompose() {
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeField("to");
    setComposeStatus("tab field · ctrl+s send · esc close");
    setComposeOpen(true);
  }

  function closeCompose() {
    setComposeOpen(false);
    setComposeSending(false);
  }

  function composeGetter(f: ComposeField): string {
    if (f === "to") return composeTo();
    if (f === "subject") return composeSubject();
    return composeBody();
  }
  function composeSetter(f: ComposeField, updater: (s: string) => string) {
    if (f === "to") setComposeTo(updater(composeTo()));
    else if (f === "subject") setComposeSubject(updater(composeSubject()));
    else setComposeBody(updater(composeBody()));
  }

  function nextField(cur: ComposeField, reverse = false): ComposeField {
    const order: ComposeField[] = ["to", "subject", "body"];
    const i = order.indexOf(cur);
    const next = reverse ? (i + order.length - 1) % order.length : (i + 1) % order.length;
    return order[next]!;
  }

  async function doSend() {
    if (composeSending()) return;
    const to = composeTo().trim();
    const subject = composeSubject().trim();
    const text = composeBody();
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
          } catch {
            // ignore malformed
          }
        } else if (type === "phase") {
          try {
            const p = JSON.parse(data) as { phase: string };
            if (p.phase === "local-done") setSearchPhase("local-done");
          } catch {
            // ignore
          }
        } else if (type === "done") {
          setSearchPhase("done");
        } else if (type === "error") {
          try {
            const p = JSON.parse(data) as { message: string };
            setSearchError(p.message);
            setSearchPhase("error");
          } catch {
            setSearchError("unknown error");
            setSearchPhase("error");
          }
        }
      },
      onError: (err) => {
        setSearchError(err instanceof Error ? err.message : String(err));
        setSearchPhase("error");
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

  createEffect(() => {
    const id = bodySource();
    if (id) {
      setRenderMode("text");
      setRendered(null);
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
    if (action === "toggle-read") patchPending(msg.gmMsgid, { read: !msg.read });
    else if (action === "toggle-star") patchPending(msg.gmMsgid, { starred: !msg.starred });
    else patchPending(msg.gmMsgid, { removed: true });

    const willRemove = action === "archive" || action === "trash";
    if (willRemove && readerOpen() && currentMsg()?.gmMsgid === msg.gmMsgid) {
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
          } catch {
            // ignore
          }
        } else if (type === "mail.updated") {
          try {
            const parsed = JSON.parse(data) as { gmMsgid?: string };
            if (parsed.gmMsgid) clearPending(parsed.gmMsgid);
          } catch {
            // ignore
          }
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
          } catch {
            // ignore
          }
        }
      },
    });
    onCleanup(stop);
  });

  useKeyboard(async (e) => {
    const list = visibleMessages();
    const total = list.length;

    if (composeOpen()) {
      if (composeSending()) {
        if (e.name === "escape") { closeCompose(); return; }
        return;
      }
      if (e.name === "escape") { closeCompose(); return; }
      if (e.ctrl && (e.name === "s" || e.name === "return")) { void doSend(); return; }
      if (e.name === "tab" && !e.shift) { setComposeField((f) => nextField(f)); return; }
      if (e.name === "tab" && e.shift) { setComposeField((f) => nextField(f, true)); return; }

      const f = composeField();
      if (e.name === "backspace") {
        if (e.meta) composeSetter(f, () => "");
        else composeSetter(f, (s) => s.slice(0, -1));
        return;
      }
      if (e.name === "space") { composeSetter(f, (s) => s + " "); return; }
      if (e.name === "return") {
        if (f === "body") composeSetter(f, (s) => s + "\n");
        else setComposeField((cur) => nextField(cur));
        return;
      }
      const seq = (e as { sequence?: string }).sequence;
      if (seq && seq.length === 1 && !e.ctrl && !e.meta) {
        const code = seq.charCodeAt(0);
        if (code >= 0x20 && code !== 0x7f) composeSetter(f, (s) => s + seq);
      }
      return;
    }

    if (e.name === "tab" && !searchOpen() && !readerOpen()) {
      setSidebarFocused((f) => !f);
      return;
    }

    if (sidebarFocused() && !readerOpen() && !searchOpen()) {
      const fs = orderedFolders();
      if (e.name === "escape") {
        setSidebarFocused(false);
        return;
      }
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

    if (searchOpen() && !readerOpen()) {
      if (e.name === "escape") {
        closeSearch();
        return;
      }
      if (e.name === "return") {
        await openSelectedHit();
        return;
      }
      if (e.name === "down" || (e.ctrl && e.name === "j")) {
        setSearchSelected((s) => Math.min(Math.max(0, searchHits().length - 1), s + 1));
        return;
      }
      if (e.name === "up" || (e.ctrl && e.name === "k")) {
        setSearchSelected((s) => Math.max(0, s - 1));
        return;
      }
      if (e.name === "backspace") {
        if (e.meta) setSearchQuery("");
        else setSearchQuery((q) => q.slice(0, -1));
        return;
      }
      if (e.name === "space") {
        setSearchQuery((q) => q + " ");
        return;
      }
      const seq = (e as { sequence?: string }).sequence;
      if (seq && seq.length === 1 && !e.ctrl && !e.meta) {
        const code = seq.charCodeAt(0);
        if (code >= 0x20 && code !== 0x7f) {
          setSearchQuery((q) => q + seq);
        }
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
        const b = body();
        if (!caps()?.w3m) {
          flashToast("w3m not installed — install to enable rich view");
          return;
        }
        if (!b?.htmlPath) {
          flashToast("no HTML part in this message");
          return;
        }
        try {
          const dump = await w3mDump(b.htmlPath);
          setRendered(dump);
          setRenderMode("w3m");
        } catch (err) {
          flashToast(`w3m failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      if (e.name === "v" && e.shift) {
        const b = body();
        if (!b?.htmlPath) {
          flashToast("no HTML part to open");
          return;
        }
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
      await refetch();
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
                  to={composeTo()}
                  subject={composeSubject()}
                  body={composeBody()}
                  field={composeField()}
                  sending={composeSending()}
                  statusLine={composeStatus()}
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
                query={searchQuery()}
                hits={searchHits()}
                selected={searchSelected()}
                phase={searchPhase()}
                errorMessage={searchError()}
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
        <text fg="#ef4444" paddingRight={2}>
          sel={selected()} top={debugTop()} view={debugView()} sh={debugSh()} ref={debugRef() ? "y" : "n"}
        </text>
        <text fg="#4b5563">ctrl+c exit</text>
      </box>
    </box>
  );
}

render(() => <App />);

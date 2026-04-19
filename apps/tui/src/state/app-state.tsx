import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import type { SearchHit } from "@grace/api";
import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type JSX,
} from "solid-js";
import {
  activateFolder,
  type Body,
  type ComposeField,
  DAEMON_BASE_URL,
  deleteCurrentDraft,
  fetchAuth,
  fetchBody,
  fetchCapabilities,
  fetchCurrentDraft,
  fetchFolders,
  fetchMessages,
  hitToMessage,
  importHit,
  labelMessage,
  type Message,
  mutateMessage,
  type MutateAction,
  openInBrowser,
  orderFolders,
  saveCurrentDraft,
  sendDraft,
  toastForAction,
  w3mDump,
} from "../api.ts";
import { ComposeOverlay } from "../components/Compose.tsx";
import { SearchOverlay } from "../components/Search.tsx";
import {
  buildQuotedBody,
  buildReferences,
  buildReplySubject,
  extractUrls,
} from "../format.ts";
import { useDeferredShow } from "../hooks/useDeferredShow.ts";
import { subscribeSse, subscribeSseOnce } from "../sse.ts";
import { dialog } from "../ui/dialog.tsx";
import { toast, type ToastVariant } from "../ui/toast.tsx";

type PendingPatch = { read?: boolean; starred?: boolean; removed?: boolean };
type LiveStatus = "connecting" | "live" | "offline";
type SearchPhase = "idle" | "searching" | "local-done" | "done" | "error";

export function createAppState() {
  const [auth, { refetch: refetchAuth }] = createResource(fetchAuth);
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
  const [liveStatus, setLiveStatus] = createSignal<LiveStatus>("connecting");
  const [newFlash, setNewFlash] = createSignal<string | null>(null);
  const [syncProgress, setSyncProgress] = createSignal<{ done: number; target: number } | null>(null);
  const [renderMode, setRenderMode] = createSignal<"text" | "w3m">("text");
  const [rendered, setRendered] = createSignal<string | null>(null);
  const [w3mBusy, setW3mBusy] = createSignal(false);
  const [staleLines, setStaleLines] = createSignal<string[] | null>(null);
  const [quotesExpanded, setQuotesExpanded] = createSignal(false);

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

  type ReplyContext = {
    inReplyTo: string;
    references: string[];
  };

  const [composeField, setComposeField] = createSignal<ComposeField>("to");
  const [composeTo, setComposeTo] = createSignal("");
  const [composeCc, setComposeCc] = createSignal("");
  const [composeBcc, setComposeBcc] = createSignal("");
  const [composeAttachments, setComposeAttachments] = createSignal("");
  const [composeSubject, setComposeSubject] = createSignal("");
  const [composeBody, setComposeBody] = createSignal("");
  const [composeShowCc, setComposeShowCc] = createSignal(false);
  const [composeShowBcc, setComposeShowBcc] = createSignal(false);
  const [composeShowAttachments, setComposeShowAttachments] = createSignal(false);
  const [replyContext, setReplyContext] = createSignal<ReplyContext | null>(null);
  let toInput: InputRenderable | undefined;
  let ccInput: InputRenderable | undefined;
  let bccInput: InputRenderable | undefined;
  let attachmentsInput: InputRenderable | undefined;
  let subjectInput: InputRenderable | undefined;
  let bodyArea: TextareaRenderable | undefined;
  const [composeSending, setComposeSending] = createSignal(false);
  const showComposeSpinner = useDeferredShow(composeSending);
  const [composeStatus, setComposeStatus] = createSignal(
    "tab field · alt+c cc · alt+b bcc · alt+a attach · ctrl+s send",
  );
  const composeOpen = () => dialog.has("compose");

  function mountComposePrefill(
    prefill: {
      to: string;
      cc?: string;
      bcc?: string;
      attachments?: string;
      subject: string;
      text: string;
    },
    field: ComposeField,
  ) {
    const cc = prefill.cc ?? "";
    const bcc = prefill.bcc ?? "";
    const attachments = prefill.attachments ?? "";
    setComposeTo(prefill.to);
    setComposeCc(cc);
    setComposeBcc(bcc);
    setComposeAttachments(attachments);
    setComposeSubject(prefill.subject);
    setComposeBody(prefill.text);
    setComposeShowCc(cc.length > 0);
    setComposeShowBcc(bcc.length > 0);
    setComposeShowAttachments(attachments.length > 0);
    toInput?.setText(prefill.to);
    ccInput?.setText(cc);
    bccInput?.setText(bcc);
    attachmentsInput?.setText(attachments);
    subjectInput?.setText(prefill.subject);
    bodyArea?.setText(prefill.text);
    setComposeField(field);
  }

  async function openCompose() {
    if (composeOpen()) return;
    setReplyContext(null);
    let prefill: {
      to: string;
      cc?: string;
      bcc?: string;
      attachments?: string;
      subject: string;
      text: string;
    } = {
      to: "",
      subject: "",
      text: "",
    };
    try {
      const draft = await fetchCurrentDraft();
      if (draft) prefill = {
        to: draft.to,
        ...(draft.cc ? { cc: draft.cc } : {}),
        ...(draft.bcc ? { bcc: draft.bcc } : {}),
        ...(draft.attachments ? { attachments: draft.attachments } : {}),
        subject: draft.subject,
        text: draft.text,
      };
    } catch {
      // Daemon unreachable or corrupt draft — start empty.
    }
    mountComposePrefill(prefill, "to");
    const restored =
      prefill.to || prefill.subject || prefill.text || prefill.attachments;
    setComposeStatus(
      restored
        ? "draft restored · tab field · alt+c cc · alt+b bcc · alt+a attach · ctrl+s send"
        : "tab field · alt+c cc · alt+b bcc · alt+a attach · ctrl+s send",
    );
    dialog.open({
      id: "compose",
      slot: "content",
      element: <ComposeOverlay />,
      onClose: () => {
        setComposeSending(false);
        setReplyContext(null);
      },
    });
  }

  async function openReply() {
    if (composeOpen()) return;
    const m = currentMsg();
    if (!m) { flashToast("no message to reply to", "warning"); return; }
    const b = body();
    if (!b) { flashToast("body still loading — try again in a moment", "warning"); return; }
    if (!b.messageId) {
      flashToast("no message-id on this message — sending without threading", "warning");
    }

    const to = m.fromEmail ?? "";
    const subject = buildReplySubject(m.subject);
    const quoted = buildQuotedBody(m, b.text ?? "");
    const references = buildReferences(b.references, b.messageId);

    // Drop any unrelated draft so the reply doesn't fight with stale compose state.
    await deleteCurrentDraft().catch(() => {});
    lastSavedKey = "";

    setReplyContext(b.messageId ? { inReplyTo: b.messageId, references } : null);
    mountComposePrefill({ to, subject, text: quoted }, to ? "body" : "to");
    setComposeStatus(
      b.messageId
        ? `replying to ${m.fromName ?? m.fromEmail ?? "sender"} · ctrl+s send · esc close`
        : "reply without threading · ctrl+s send · esc close",
    );
    dialog.open({
      id: "compose",
      slot: "content",
      element: <ComposeOverlay />,
      onClose: () => {
        setComposeSending(false);
        setReplyContext(null);
      },
    });
  }

  function closeCompose() {
    dialog.close("compose");
  }

  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSavedKey = "";
  createEffect(() => {
    if (!composeOpen()) return;
    if (composeSending()) return;
    const to = composeTo();
    const cc = composeCc();
    const bcc = composeBcc();
    const attachments = composeAttachments();
    const subject = composeSubject();
    const text = composeBody();
    const key = `${to}\0${cc}\0${bcc}\0${attachments}\0${subject}\0${text}`;
    if (key === lastSavedKey) return;
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      lastSavedKey = key;
      if (
        to.trim() ||
        cc.trim() ||
        bcc.trim() ||
        attachments.trim() ||
        subject.trim() ||
        text.trim()
      ) {
        void saveCurrentDraft({
          to,
          ...(cc.trim() ? { cc } : {}),
          ...(bcc.trim() ? { bcc } : {}),
          ...(attachments.trim() ? { attachments } : {}),
          subject,
          text,
        }).catch(() => {});
      } else {
        void deleteCurrentDraft().catch(() => {});
      }
    }, 500);
  });

  onCleanup(() => {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
  });

  function nextField(cur: ComposeField, reverse = false): ComposeField {
    const order: ComposeField[] = ["to"];
    if (composeShowCc()) order.push("cc");
    if (composeShowBcc()) order.push("bcc");
    if (composeShowAttachments()) order.push("attachments");
    order.push("subject", "body");
    const i = order.indexOf(cur);
    if (i < 0) return "to";
    const next = reverse ? (i + order.length - 1) % order.length : (i + 1) % order.length;
    return order[next]!;
  }

  function toggleComposeCc() {
    const next = !composeShowCc();
    setComposeShowCc(next);
    if (!next) {
      setComposeCc("");
      ccInput?.setText("");
      if (composeField() === "cc") setComposeField("to");
    } else {
      setComposeField("cc");
    }
  }

  function toggleComposeBcc() {
    const next = !composeShowBcc();
    setComposeShowBcc(next);
    if (!next) {
      setComposeBcc("");
      bccInput?.setText("");
      if (composeField() === "bcc") setComposeField("to");
    } else {
      setComposeField("bcc");
    }
  }

  function toggleComposeAttachments() {
    const next = !composeShowAttachments();
    setComposeShowAttachments(next);
    if (!next) {
      setComposeAttachments("");
      attachmentsInput?.setText("");
      if (composeField() === "attachments") setComposeField("to");
    } else {
      setComposeField("attachments");
    }
  }

  async function doSend() {
    if (composeSending()) return;
    const to = composeTo().trim();
    const cc = composeCc().trim();
    const bcc = composeBcc().trim();
    const attachRaw = composeAttachments().trim();
    const subject = composeSubject().trim();
    const text = composeBody();
    if (!to) { setComposeStatus("error: recipient required"); setComposeField("to"); return; }
    if (!subject) { setComposeStatus("error: subject required"); setComposeField("subject"); return; }
    if (!text.trim()) { setComposeStatus("error: body required"); setComposeField("body"); return; }

    const attachments = attachRaw
      ? attachRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    setComposeSending(true);
    setComposeStatus("sending…");
    if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null; }
    try {
      const reply = replyContext();
      const res = await sendDraft({
        to,
        ...(cc ? { cc } : {}),
        ...(bcc ? { bcc } : {}),
        subject,
        text,
        ...(reply ? { inReplyTo: reply.inReplyTo, references: reply.references } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      flashToast(`sent to ${res.accepted.join(", ")}`, "success");
      lastSavedKey = "";
      await deleteCurrentDraft().catch(() => {});
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeAttachments("");
      setComposeSubject("");
      setComposeBody("");
      setComposeShowCc(false);
      setComposeShowBcc(false);
      setComposeShowAttachments(false);
      setReplyContext(null);
      closeCompose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setComposeStatus(`send failed: ${msg}`);
      setComposeSending(false);
      if (/^attachment /.test(msg)) setComposeField("attachments");
    }
  }

  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchHits, setSearchHits] = createSignal<SearchHit[]>([]);
  const [searchSelected, setSearchSelected] = createSignal(0);
  const [searchPhase, setSearchPhase] = createSignal<SearchPhase>("idle");
  const [searchError, setSearchError] = createSignal<string | null>(null);
  let searchInput: InputRenderable | undefined;
  let searchAbort: (() => void) | null = null;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  const searchOpen = () => dialog.has("search");

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

  function resetSearchState() {
    cancelSearch();
    setSearchQuery("");
    setSearchHits([]);
    setSearchSelected(0);
    setSearchPhase("idle");
    setSearchError(null);
  }

  function openSearch() {
    if (searchOpen()) return;
    dialog.open({
      id: "search",
      slot: "list",
      element: <SearchOverlay />,
      onClose: resetSearchState,
    });
  }

  function closeSearch() {
    dialog.close("search");
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
    const url = `${DAEMON_BASE_URL}/api/search?q=${encodeURIComponent(q)}`;
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
            flashToast(`search: ${p.message}`, "error");
          } catch {
            setSearchError("unknown error");
            setSearchPhase("error");
            flashToast("search: unknown error", "error");
          }
        }
      },
      onError: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setSearchError(msg);
        setSearchPhase("error");
        flashToast(`search: ${msg}`, "error");
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
        flashToast(`import failed: ${err instanceof Error ? err.message : String(err)}`, "error");
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

  const readerText = (): string => {
    if (renderMode() === "w3m" && rendered()) return rendered()!;
    return body()?.text ?? "";
  };
  const readerLinks = createMemo(() => extractUrls(readerText()));
  function toggleQuotes() { setQuotesExpanded((v) => !v); }
  function openReaderLink(index: number): boolean {
    const url = readerLinks()[index];
    if (!url) return false;
    openInBrowser(url);
    flashToast(`opened link ${index + 1}`, "success");
    return true;
  }

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
      setQuotesExpanded(false);
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
      flashToast(`activate failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  createEffect(() => {
    const list = orderedFolders();
    if (list.length === 0) return;
    const idx = list.findIndex((f) => f.path === activeFolder());
    if (idx >= 0) setFolderSelected(idx);
  });

  async function applyLabelChange(
    gmMsgid: string,
    change: { add?: string[]; remove?: string[] },
  ): Promise<void> {
    const addCount = change.add?.length ?? 0;
    const removeCount = change.remove?.length ?? 0;
    if (addCount + removeCount === 0) return;
    try {
      await labelMessage(gmMsgid, change);
      const noun =
        addCount > 0 && removeCount === 0
          ? `added ${labelJoin(change.add!)}`
          : removeCount > 0 && addCount === 0
            ? `removed ${labelJoin(change.remove!)}`
            : "updated labels";
      flashToast(noun, "success");
      void refetch();
    } catch (err) {
      flashToast(`label failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

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
      flashToast(toastForAction(action), "success");
    } catch (err) {
      patchPending(msg.gmMsgid, { read: before.read, starred: before.starred, removed: false });
      clearPending(msg.gmMsgid);
      flashToast(`${action} failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  function flashToast(message: string, variant: ToastVariant = "info") {
    toast.show({ message, variant });
  }

  function labelJoin(arr: string[]): string {
    const names = arr.map((l) => (l.startsWith("\\") ? l.slice(1) : l));
    if (names.length === 1) return `[${names[0]}]`;
    return `${names.length} labels`;
  }

  function triggerW3m() {
    if (!caps()?.w3m) {
      flashToast("w3m not installed — install to enable rich view", "warning");
      return;
    }
    const b = body();
    if (!b?.htmlPath) {
      flashToast("no HTML part in this message", "warning");
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
        flashToast(`w3m failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      })
      .finally(() => setW3mBusy(false));
  }

  function openHtmlInBrowser() {
    const b = body();
    if (!b?.htmlPath) { flashToast("no HTML part to open", "warning"); return; }
    openInBrowser(b.htmlPath);
    flashToast("opened in browser", "success");
  }

  function setTextMode() {
    setRenderMode("text");
    setRendered(null);
  }

  onMount(() => {
    const url = `${DAEMON_BASE_URL}/api/events`;
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
        } else if (type === "auth.signed-in") {
          void refetchAuth();
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

  return {
    // resources/signals (read)
    auth,
    caps,
    folders,
    messages,
    body,
    activeFolder,
    sidebarFocused,
    folderSelected,
    selected,
    readerOpen,
    activeMsg,
    lastUpdated,
    liveStatus,
    newFlash,
    syncProgress,
    renderMode,
    rendered,
    w3mBusy,
    staleLines,
    quotesExpanded,
    readerLinks,
    composeOpen,
    composeField,
    composeSending,
    showComposeSpinner,
    composeStatus,
    composeShowCc,
    composeShowBcc,
    composeShowAttachments,
    searchOpen,
    searchQuery,
    searchHits,
    searchSelected,
    searchPhase,
    searchError,

    // setters (direct)
    setSidebarFocused,
    setFolderSelected,
    setSelected,
    setReaderOpen,
    setActiveMsg,
    setSearchQuery,
    setSearchSelected,
    setComposeField,

    // derived
    orderedFolders,
    visibleMessages,
    currentMsg,

    // actions
    openCompose,
    openReply,
    closeCompose,
    doSend,
    toggleComposeCc,
    toggleComposeBcc,
    toggleComposeAttachments,
    replyContext,
    nextField,
    openSearch,
    closeSearch,
    openSelectedHit,
    switchFolder,
    runMutation,
    applyLabelChange,
    triggerW3m,
    openHtmlInBrowser,
    setTextMode,
    toggleQuotes,
    openReaderLink,
    flashToast,
    refetch,
    refetchAuth,

    // compose field writers (native input callbacks)
    writeComposeTo: (v: string) => setComposeTo(v),
    writeComposeCc: (v: string) => setComposeCc(v),
    writeComposeBcc: (v: string) => setComposeBcc(v),
    writeComposeAttachments: (v: string) => setComposeAttachments(v),
    writeComposeSubject: (v: string) => setComposeSubject(v),
    syncComposeBodyFromArea: () => setComposeBody(bodyArea?.plainText ?? ""),

    // ref setters (native input/textarea mounting)
    mountToInput: (r: InputRenderable) => {
      toInput = r;
      const v = composeTo();
      if (v) r.setText(v);
    },
    mountCcInput: (r: InputRenderable) => {
      ccInput = r;
      const v = composeCc();
      if (v) r.setText(v);
    },
    mountBccInput: (r: InputRenderable) => {
      bccInput = r;
      const v = composeBcc();
      if (v) r.setText(v);
    },
    mountAttachmentsInput: (r: InputRenderable) => {
      attachmentsInput = r;
      const v = composeAttachments();
      if (v) r.setText(v);
    },
    mountSubjectInput: (r: InputRenderable) => {
      subjectInput = r;
      const v = composeSubject();
      if (v) r.setText(v);
    },
    mountBodyArea: (r: TextareaRenderable) => {
      bodyArea = r;
      const v = composeBody();
      if (v) r.setText(v);
    },
    mountSearchInput: (r: InputRenderable) => { searchInput = r; },
  };
}

export type AppState = ReturnType<typeof createAppState>;

const AppStateContext = createContext<AppState>();

export function AppStateProvider(props: { children: JSX.Element }) {
  const state = createAppState();
  return <AppStateContext.Provider value={state}>{props.children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState called outside AppStateProvider");
  return ctx;
}

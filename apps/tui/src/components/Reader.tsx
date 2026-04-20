import { createMemo, For, Show } from "solid-js";
import type { Message } from "../api.ts";
import { parseReaderBody, truncate } from "../format.ts";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { Spinner } from "./Spinner.tsx";

function BodyHeader(props: { msg: Message; onBack: () => void }) {
  const t = useTheme();
  const fromLine = () =>
    props.msg.fromName
      ? `${props.msg.fromName} <${props.msg.fromEmail ?? ""}>`
      : (props.msg.fromEmail ?? "(unknown sender)");
  const dateLine = () => {
    const d = new Date(props.msg.date).toLocaleString();
    return props.msg.labels?.length > 0 ? `${d}  ·  ${props.msg.labels.join(" · ")}` : d;
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
      <box flexDirection="row" height={1} flexShrink={0} overflow="hidden">
        <box
          flexShrink={0}
          paddingRight={1}
          onMouseDown={(e) => { e.preventDefault(); props.onBack(); }}
        >
          <text fg={t.primarySoft}>← Back</text>
        </box>
        <text fg={t.textFaint} flexGrow={1}>
          esc · tab for folders
        </text>
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
        <text attributes={1} fg={t.text}>
          {truncate(props.msg.subject ?? "(no subject)", 200)}
        </text>
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
        <text fg={t.textMuted}>{fromLine()}</text>
      </box>
      <box height={1} flexShrink={0} overflow="hidden">
        <text fg={t.textSubtle}>{dateLine()}</text>
      </box>
      <box height={1} flexShrink={0} backgroundColor={t.field} />
    </box>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function Reader() {
  const s = useAppState();
  const t = useTheme();
  const msg = () => s.currentMsg()!;

  const htmlOnlyHint = () => {
    if (s.renderMode() === "w3m" && s.rendered()) return null;
    const b = s.body();
    if (!b) return null;
    if (!b.text && b.html) return "(no plain-text part — press v for w3m render or V to open in browser)";
    return null;
  };

  const rawText = () => {
    if (s.renderMode() === "w3m" && s.rendered()) return s.rendered()!;
    return s.body()?.text ?? "";
  };

  const showStale = () => {
    const stale = s.staleLines();
    return s.body.loading && stale && stale.length > 0;
  };

  const displayText = () => (showStale() ? s.staleLines()!.join("\n") : rawText());
  const segments = createMemo(() => parseReaderBody(displayText()));
  const bodyColor = () => (showStale() ? t.textFaint : t.textBody);
  const quoteColor = () => (showStale() ? t.textGhost : t.textSubtle);

  const back = () => {
    s.setReaderOpen(false);
    s.setActiveMsg(null);
  };

  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
      <BodyHeader msg={msg()} onBack={back} />
      <Show when={!s.body.error} fallback={
        <box padding={1}><text fg={t.error}>{`failed to load body: ${s.body.error instanceof Error ? s.body.error.message : String(s.body.error)}`}</text></box>
      }>
        <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0} paddingLeft={1} paddingRight={1}>
          <Show when={s.body.loading && !showStale()}>
            <box flexDirection="row" padding={1}>
              <Spinner color={t.textSubtle} label="loading body…" />
            </box>
          </Show>
          <Show when={s.w3mBusy()}>
            <box flexDirection="row" padding={1}>
              <Spinner color={t.textSubtle} label="rendering html…" />
            </box>
          </Show>
          <Show when={htmlOnlyHint()}>
            <text fg={t.textMuted} wrapMode="word" width="100%">{htmlOnlyHint() ?? ""}</text>
          </Show>
          <For each={segments()}>
            {(seg) => {
              if (seg.kind === "blank") {
                return <box height={1} flexShrink={0} />;
              }
              if (seg.kind === "text") {
                return (
                  <text fg={bodyColor()} wrapMode="word" width="100%">
                    {seg.text || " "}
                  </text>
                );
              }
              return (
                <Show
                  when={s.quotesExpanded()}
                  fallback={
                    <text fg={quoteColor()} attributes={2}>
                      {`— ${seg.count} quoted line${seg.count === 1 ? "" : "s"} · press z to expand —`}
                    </text>
                  }
                >
                  <text fg={quoteColor()} wrapMode="word" width="100%">
                    {seg.content}
                  </text>
                </Show>
              );
            }}
          </For>
          <Show when={!showStale() && s.readerLinks().length > 0}>
            <box height={1} flexShrink={0} />
            <text fg={t.textMuted}>links:</text>
            <For each={s.readerLinks()}>
              {(url, i) => (
                <text fg={t.primarySoft} wrapMode="word" width="100%">
                  {`[${i() + 1}] ${url}`}
                </text>
              )}
            </For>
          </Show>
          <Show when={!showStale() && s.body()?.attachments && s.body()!.attachments.length > 0}>
            <box height={1} flexShrink={0} backgroundColor={t.field} />
            <text fg={t.textMuted}>attachments:</text>
            <For each={s.body()!.attachments}>
              {(a) => (
                <text fg={t.textSubtle}>
                  {`  ${a.filename ?? "(unnamed)"} · ${a.contentType ?? "unknown"} · ${formatBytes(a.size)}`}
                </text>
              )}
            </For>
          </Show>
        </scrollbox>
      </Show>
    </box>
  );
}

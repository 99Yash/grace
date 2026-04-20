import type { SearchHit } from "@grace/api";
import { For, Match, Show, Switch } from "solid-js";
import { formatRelative, truncate } from "../format.ts";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { Spinner } from "./Spinner.tsx";

function SearchHitRow(props: { hit: SearchHit; selected: boolean }) {
  const t = useTheme();
  const subjectFg = () => (props.selected ? t.text : t.textBright);
  const metaFg = () => (props.selected ? t.primaryOnSelection : t.textSubtle);
  const badgeFg = () => (props.hit.inLocal ? t.success : t.warning);
  const badge = () => (props.hit.inLocal ? "L" : "R");
  return (
    <box
      flexDirection="row"
      height={1}
      flexShrink={0}
      overflow="hidden"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? t.selection : "transparent"}
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

export function SearchOverlay() {
  const s = useAppState();
  const t = useTheme();
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        overflow="hidden"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.field}
      >
        <text fg={t.textMuted} flexShrink={0}>
          search:{" "}
        </text>
        <input
          ref={s.mountSearchInput}
          focused
          onInput={s.setSearchQuery}
          textColor={t.text}
          focusedTextColor={t.text}
          cursorColor={t.primary}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          flexShrink={1}
        />
      </box>
      <box flexDirection="row" height={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
        <Switch
          fallback={
            <text fg={t.textSubtle} flexGrow={1}>
              type Gmail query · esc cancels
            </text>
          }
        >
          <Match when={s.searchPhase() === "searching"}>
            <Spinner color={t.textSubtle} label="searching…" />
          </Match>
          <Match when={s.searchPhase() === "local-done"}>
            <Spinner
              color={t.textSubtle}
              label={`local ${s.searchHits().length} · fetching Gmail…`}
            />
          </Match>
          <Match when={s.searchPhase() === "done"}>
            <text fg={t.textSubtle} flexGrow={1}>
              {`${s.searchHits().length} result${s.searchHits().length === 1 ? "" : "s"}`}
            </text>
          </Match>
          <Match when={s.searchPhase() === "error"}>
            <text fg={t.error} flexGrow={1}>
              error: {s.searchError() ?? "unknown"}
            </text>
          </Match>
        </Switch>
      </box>
      <scrollbox scrollY flexGrow={1} flexShrink={1} minHeight={0}>
        <For
          each={s.searchHits()}
          fallback={
            <box padding={1}>
              <text fg={t.textSubtle}>
                <Show when={s.searchQuery() === ""} fallback="no results yet">
                  start typing to search local cache + Gmail
                </Show>
              </text>
            </box>
          }
        >
          {(hit, i) => <SearchHitRow hit={hit} selected={s.searchSelected() === i()} />}
        </For>
      </scrollbox>
    </box>
  );
}

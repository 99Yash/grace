import { Show } from "solid-js";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { Spinner } from "./Spinner.tsx";

export function ComposeOverlay() {
  const s = useAppState();
  const t = useTheme();
  const cursor = () => (s.composeSending() ? t.textFaint : t.primary);
  const field = () => s.composeField();
  return (
    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0}>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={t.surfaceAlt}
      >
        <text attributes={1} fg={t.text} flexGrow={1}>
          compose
        </text>
        <Show when={s.showComposeSpinner()} fallback={<text fg={t.textMuted}>{s.composeStatus()}</text>}>
          <Spinner color={t.warning} label="sending…" />
        </Show>
      </box>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={field() === "to" ? t.field : "transparent"}
      >
        <text fg={field() === "to" ? t.text : t.textSubtle} width={9} flexShrink={0}>
          To:
        </text>
        <input
          ref={s.mountToInput}
          focused={field() === "to"}
          onInput={s.writeComposeTo}
          onSubmit={() => s.setComposeField((f) => s.nextField(f))}
          textColor={t.textBright}
          focusedTextColor={t.textBright}
          cursorColor={cursor()}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          placeholder="name@example.com"
          placeholderColor={t.textFaint}
          flexGrow={1}
          flexShrink={1}
        />
        <Show when={!s.composeShowCc() || !s.composeShowBcc()}>
          <text fg={t.textFaint} flexShrink={0}>
            {`  ${!s.composeShowCc() ? "alt+c cc" : ""}${!s.composeShowCc() && !s.composeShowBcc() ? " · " : ""}${!s.composeShowBcc() ? "alt+b bcc" : ""}`}
          </text>
        </Show>
      </box>
      <Show when={s.composeShowCc()}>
        <box
          flexDirection="row"
          height={1}
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={field() === "cc" ? t.field : "transparent"}
        >
          <text fg={field() === "cc" ? t.text : t.textSubtle} width={9} flexShrink={0}>
            Cc:
          </text>
          <input
            ref={s.mountCcInput}
            focused={field() === "cc"}
            onInput={s.writeComposeCc}
            onSubmit={() => s.setComposeField((f) => s.nextField(f))}
            textColor={t.textBright}
            focusedTextColor={t.textBright}
            cursorColor={cursor()}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            placeholder="comma-separated"
            placeholderColor={t.textFaint}
            flexGrow={1}
            flexShrink={1}
          />
        </box>
      </Show>
      <Show when={s.composeShowBcc()}>
        <box
          flexDirection="row"
          height={1}
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={field() === "bcc" ? t.field : "transparent"}
        >
          <text fg={field() === "bcc" ? t.text : t.textSubtle} width={9} flexShrink={0}>
            Bcc:
          </text>
          <input
            ref={s.mountBccInput}
            focused={field() === "bcc"}
            onInput={s.writeComposeBcc}
            onSubmit={() => s.setComposeField((f) => s.nextField(f))}
            textColor={t.textBright}
            focusedTextColor={t.textBright}
            cursorColor={cursor()}
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            placeholder="comma-separated"
            placeholderColor={t.textFaint}
            flexGrow={1}
            flexShrink={1}
          />
        </box>
      </Show>
      <box
        flexDirection="row"
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={field() === "subject" ? t.field : "transparent"}
      >
        <text fg={field() === "subject" ? t.text : t.textSubtle} width={9} flexShrink={0}>
          Subject:
        </text>
        <input
          ref={s.mountSubjectInput}
          focused={field() === "subject"}
          onInput={s.writeComposeSubject}
          onSubmit={() => s.setComposeField((f) => s.nextField(f))}
          textColor={t.textBright}
          focusedTextColor={t.textBright}
          cursorColor={cursor()}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          flexGrow={1}
          flexShrink={1}
        />
      </box>
      <box height={1} flexShrink={0} backgroundColor={t.field} />
      <box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={field() === "body" ? t.field : "transparent"}
      >
        <textarea
          ref={s.mountBodyArea}
          focused={field() === "body"}
          onContentChange={s.syncComposeBodyFromArea}
          textColor={t.textBright}
          focusedTextColor={t.textBright}
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

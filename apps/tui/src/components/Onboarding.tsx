import { useKeyboard } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { startLogin } from "../api.ts";
import { useAppState } from "../state/app-state.tsx";
import { useTheme } from "../theme/index.tsx";
import { Spinner } from "./Spinner.tsx";

export function Onboarding() {
  const s = useAppState();
  const t = useTheme();
  const [signingIn, setSigningIn] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  useKeyboard((e) => {
    const a = s.auth();
    if (!a || a.signedIn) return;
    if (signingIn()) return;
    if (e.name !== "return") return;
    setError(null);
    setSigningIn(true);
    startLogin()
      .then(() => {
        void s.refetchAuth();
        void s.refetch();
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setSigningIn(false));
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
      paddingLeft={2}
      paddingRight={2}
    >
      <text attributes={1} fg={t.text}>
        grace
      </text>
      <text fg={t.textMuted}>a tiny terminal email client</text>
      <box height={2} />
      <Show
        when={signingIn()}
        fallback={
          <box flexDirection="column" alignItems="center">
            <text fg={t.textBody}>sign in with Google to connect your Gmail</text>
            <box height={1} />
            <text fg={t.primarySoft}>press enter to authorize</text>
            <Show when={error()}>
              <box height={1} />
              <text fg={t.error}>{error()}</text>
              <text fg={t.textFaint}>press enter to retry</text>
            </Show>
          </box>
        }
      >
        <Spinner label="opening browser · complete sign-in there" />
        <box height={1} />
        <text fg={t.textFaint}>the daemon is waiting for the Google callback</text>
      </Show>
    </box>
  );
}

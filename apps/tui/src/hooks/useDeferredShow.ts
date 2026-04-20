import { createEffect, createSignal, onCleanup } from "solid-js";

// Deferred visibility: wait 500ms before showing, hold ≥3s once shown.
// Mirrors opencode's startup-loading pattern — prevents flashy spinners on fast ops.
export function useDeferredShow(active: () => boolean, showDelayMs = 500, minHoldMs = 3000) {
  const [show, setShow] = createSignal(false);
  let wait: ReturnType<typeof setTimeout> | undefined;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let shownAt = 0;

  createEffect(() => {
    if (active()) {
      if (hold) {
        clearTimeout(hold);
        hold = undefined;
      }
      if (show() || wait) return;
      wait = setTimeout(() => {
        wait = undefined;
        shownAt = Date.now();
        setShow(true);
      }, showDelayMs);
      return;
    }
    if (wait) {
      clearTimeout(wait);
      wait = undefined;
    }
    if (!show() || hold) return;
    const left = minHoldMs - (Date.now() - shownAt);
    if (left <= 0) {
      setShow(false);
      return;
    }
    hold = setTimeout(() => {
      hold = undefined;
      setShow(false);
    }, left);
  });

  onCleanup(() => {
    if (wait) clearTimeout(wait);
    if (hold) clearTimeout(hold);
  });

  return show;
}

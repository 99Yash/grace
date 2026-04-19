import { render, useKeyboard } from "@opentui/solid";
import { Match, Show, Switch } from "solid-js";
import { CommandRegistry } from "./commands.tsx";
import { DaemonOffline } from "./components/DaemonOffline.tsx";
import { FolderHeader, TopBar } from "./components/Header.tsx";
import { HelpBar } from "./components/HelpBar.tsx";
import { InboxList } from "./components/MessageList.tsx";
import { Onboarding } from "./components/Onboarding.tsx";
import { Reader } from "./components/Reader.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { KeybindProvider, useKeybind } from "./keybind/index.tsx";
import { AppStateProvider, useAppState } from "./state/app-state.tsx";
import { ThemeProvider, useTheme } from "./theme/index.tsx";
import { openPalette } from "./ui/command-palette.tsx";
import { DialogHost, DialogSlot } from "./ui/dialog.tsx";
import { openHelp } from "./ui/help-dialog.tsx";
import { openThemes } from "./ui/theme-dialog.tsx";
import { ToastHost } from "./ui/toast.tsx";

function Layout() {
  const s = useAppState();
  const t = useTheme();
  const kb = useKeybind();

  useKeyboard((e) => {
    // Onboarding + daemon-offline screens own their own keys.
    if (s.auth.error) return;
    if (s.auth() && !s.auth()!.signedIn) return;

    const list = s.visibleMessages();
    const total = list.length;

    // Compose: native input/textarea handle typing. Esc handled by DialogHost.
    if (s.composeOpen()) {
      if (s.composeSending()) return;
      if (kb.match("compose.send", e)) {
        e.preventDefault();
        void s.doSend();
        return;
      }
      if (kb.match("compose.prevField", e)) {
        e.preventDefault();
        s.setComposeField((f) => s.nextField(f, true));
        return;
      }
      if (kb.match("compose.nextField", e)) {
        e.preventDefault();
        s.setComposeField((f) => s.nextField(f));
        return;
      }
      return;
    }

    if (kb.match("sidebar.toggle", e) && !s.searchOpen() && !s.readerOpen()) {
      s.setSidebarFocused((f) => !f);
      return;
    }

    if (s.sidebarFocused() && !s.readerOpen() && !s.searchOpen()) {
      const fs = s.orderedFolders();
      if (kb.match("dialog.close", e)) { s.setSidebarFocused(false); return; }
      if (kb.match("nav.down", e)) {
        s.setFolderSelected((v) => Math.min(Math.max(0, fs.length - 1), v + 1));
        return;
      }
      if (kb.match("nav.up", e)) {
        s.setFolderSelected((v) => Math.max(0, v - 1));
        return;
      }
      if (kb.match("list.open", e)) {
        const picked = fs[s.folderSelected()];
        if (picked) void s.switchFolder(picked.path);
        return;
      }
      return;
    }

    // Search: native input handles typing; Esc handled by DialogHost.
    if (s.searchOpen() && !s.readerOpen()) {
      if (kb.match("list.open", e)) {
        e.preventDefault();
        void s.openSelectedHit();
        return;
      }
      if (kb.match("search.next", e)) {
        e.preventDefault();
        s.setSearchSelected((v) => Math.min(Math.max(0, s.searchHits().length - 1), v + 1));
        return;
      }
      if (kb.match("search.prev", e)) {
        e.preventDefault();
        s.setSearchSelected((v) => Math.max(0, v - 1));
        return;
      }
      return;
    }

    if (s.readerOpen()) {
      const m = s.currentMsg();
      if (m) {
        if (kb.match("mail.toggleRead", e)) { void s.runMutation(m, "toggle-read"); return; }
        if (kb.match("mail.toggleStar", e)) { void s.runMutation(m, "toggle-star"); return; }
        if (kb.match("mail.archive", e)) { void s.runMutation(m, "archive"); return; }
        if (kb.match("mail.trash", e)) { void s.runMutation(m, "trash"); return; }
      }
      if (kb.match("reader.w3m", e)) { s.triggerW3m(); return; }
      if (kb.match("reader.browser", e)) { s.openHtmlInBrowser(); return; }
      if (kb.match("reader.textMode", e)) { s.setTextMode(); return; }
      if (kb.match("reader.toggleQuotes", e)) { s.toggleQuotes(); return; }
      if (!e.ctrl && !e.meta && !e.shift && /^[1-9]$/.test(e.name ?? "")) {
        if (s.openReaderLink(Number(e.name) - 1)) return;
      }
    }

    if (kb.match("app.help", e)) { openHelp(); return; }
    if (kb.match("app.palette", e)) { openPalette(); return; }
    if (kb.match("app.themes", e)) { openThemes(); return; }
    if (kb.match("app.search", e) && !s.searchOpen()) { s.openSearch(); return; }
    if (kb.match("app.compose", e)) { s.openCompose(); return; }
    if (kb.match("app.refresh", e)) { void s.refetch(); return; }
    if (!total) return;
    if (kb.match("nav.down", e)) {
      s.setSelected((v) => Math.min(total - 1, v + 1));
    } else if (kb.match("nav.up", e)) {
      s.setSelected((v) => Math.max(0, v - 1));
    } else if (kb.match("nav.top", e)) {
      s.setSelected(0);
    } else if (kb.match("nav.bottom", e)) {
      s.setSelected(total - 1);
    } else if (kb.match("list.open", e)) {
      s.setActiveMsg(null);
      s.setReaderOpen(true);
    } else {
      const m = list[s.selected()];
      if (!m) return;
      if (kb.match("mail.toggleRead", e)) { void s.runMutation(m, "toggle-read"); return; }
      if (kb.match("mail.toggleStar", e)) { void s.runMutation(m, "toggle-star"); return; }
      if (kb.match("mail.archive", e)) { void s.runMutation(m, "archive"); return; }
      if (kb.match("mail.trash", e)) { void s.runMutation(m, "trash"); return; }
    }
  });

  return (
    <box flexDirection="column" backgroundColor={t.background} style={{ height: "100%" }}>
      <DialogHost />
      <ToastHost />
      <CommandRegistry />
      <TopBar />
      <Switch
        fallback={
          <>
            <FolderHeader />
            <Show
              when={s.messages()}
              fallback={
                <box flexGrow={1} padding={1}>
                  <text fg={t.textSubtle}>loading inbox…</text>
                </box>
              }
            >
              <box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0}>
                <Sidebar />
                <box width={1} flexShrink={0} backgroundColor={t.field} />
                <DialogSlot
                  slot="content"
                  wrap={(el) => (
                    <box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} minWidth={0}>
                      {el}
                    </box>
                  )}
                  fallback={
                    <>
                      <box
                        flexDirection="column"
                        flexGrow={s.readerOpen() ? 0 : 1}
                        flexShrink={1}
                        minHeight={0}
                        minWidth={0}
                        {...(s.readerOpen() ? { width: 48 } : {})}
                      >
                        <DialogSlot slot="list" fallback={<InboxList />} />
                      </box>
                      <Show when={s.readerOpen() && s.currentMsg()}>
                        <box width={1} flexShrink={0} backgroundColor={t.field} />
                        <Reader />
                      </Show>
                    </>
                  }
                />
              </box>
            </Show>
          </>
        }
      >
        <Match when={s.auth.error}>
          <DaemonOffline />
        </Match>
        <Match when={s.auth() && !s.auth()!.signedIn}>
          <Onboarding />
        </Match>
      </Switch>
      <HelpBar />
    </box>
  );
}

render(() => (
  <ThemeProvider>
    <KeybindProvider>
      <AppStateProvider>
        <Layout />
      </AppStateProvider>
    </KeybindProvider>
  </ThemeProvider>
));

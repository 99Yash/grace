import { decodeIdToken, runLoginFlow, saveActiveAccount, saveTokens } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";

const { clientId, clientSecret } = requireGoogleOAuth();

console.log("Opening browser for Google sign-in…");

const tokens = await runLoginFlow({
  clientId,
  clientSecret,
  onOpenUrl: async (url) => {
    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
      Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" });
    } catch {
      // fall through to the printed URL below
    }
    console.log(`\nIf the browser didn't open, paste this URL:\n  ${url}\n`);
  },
});

const { email } = tokens.idToken ? decodeIdToken(tokens.idToken) : {};
if (!email) {
  console.error("✗ No email in id_token (openid+email scopes missing from response).");
  process.exit(1);
}

saveTokens(email, tokens);
saveActiveAccount(email);

console.log(`✓ Signed in as ${email}`);
console.log(`  Tokens stored in macOS Keychain under service "grace".`);

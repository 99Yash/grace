import { clearActiveAccount, deleteTokens, loadActiveAccount, loadTokens } from "@grace/auth";

const argEmail = process.argv[2]?.trim();

const active = loadActiveAccount();
const target = argEmail || active;

if (!target) {
  console.log("No account signed in. Nothing to do.");
  console.log("  (run `bun run oauth:login` to sign in)");
  process.exit(0);
}

const tokens = loadTokens(target);
if (!tokens) {
  console.log(`No keychain entry for ${target}.`);
  if (active === target) {
    clearActiveAccount();
    console.log("  Cleared stale active-account pointer.");
  }
  process.exit(0);
}

deleteTokens(target);
if (!argEmail || argEmail === active) {
  clearActiveAccount();
}

console.log(`✓ Signed out ${target}`);
console.log("  Removed refresh + access tokens from macOS Keychain.");
if (!argEmail || argEmail === active) {
  console.log("  Cleared active-account pointer.");
}
console.log("  (local message cache at ~/.grace/ is untouched — delete manually to wipe)");

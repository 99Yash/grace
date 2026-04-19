import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getFreshAccessToken, loadActiveAccount, loadTokens } from "@grace/auth";
import { DAEMON_DEFAULT_HOST, DAEMON_DEFAULT_PORT } from "@grace/env";
import { openDb } from "@grace/db";
import { createImapClient } from "@grace/mail";

const OK = "✓";
const WARN = "⚠";
const FAIL = "✗";
const ARROW = "→";

let failed = false;
let warned = false;

function pass(msg: string): void {
  console.log(`  ${OK} ${msg}`);
}
function warn(msg: string): void {
  console.log(`  ${WARN} ${msg}`);
  warned = true;
}
function fail(msg: string): void {
  console.log(`  ${FAIL} ${msg}`);
  failed = true;
}
function detail(msg: string): void {
  console.log(`    ${msg}`);
}
function section(name: string): void {
  console.log(`\n${name}`);
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

console.log("grace doctor — runtime health check");

section("env");
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) pass(`.env found at ${envPath}`);
else warn(`.env not found at ${envPath} — copy .env.example or export inline`);

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (clientId) pass(`GOOGLE_OAUTH_CLIENT_ID set (${clientId.slice(0, 12)}…)`);
else fail("GOOGLE_OAUTH_CLIENT_ID missing — OAuth sign-in will fail");
if (clientSecret) pass("GOOGLE_OAUTH_CLIENT_SECRET set");
else fail("GOOGLE_OAUTH_CLIENT_SECRET missing");

const anthropicKey = process.env.ANTHROPIC_API_KEY;
if (anthropicKey) pass(`ANTHROPIC_API_KEY set (${anthropicKey.slice(0, 7)}…)`);
else warn("ANTHROPIC_API_KEY not set — M11 features (summarize/draft/nl-select) disabled");

section("keychain");
const email = loadActiveAccount();
if (!email) {
  warn("no active account — run `bun run oauth:login`");
} else {
  pass(`active account: ${email}`);
  const tokens = loadTokens(email);
  if (!tokens) {
    fail(`tokens missing for ${email} — re-run \`oauth:login\``);
  } else {
    if (tokens.refreshToken) pass("refresh token present");
    else fail("refresh token missing — re-run `oauth:login`");
    const remaining = tokens.expiresAt - Date.now();
    if (remaining > 60_000) pass(`access token expires in ${Math.round(remaining / 60_000)}m`);
    else if (remaining > 0) warn(`access token expires in ${Math.round(remaining / 1000)}s (auto-refresh on next use)`);
    else warn("access token expired (auto-refresh on next use)");
    if (tokens.scope?.includes("https://mail.google.com/")) pass("scope includes mail.google.com");
    else fail(`scope missing mail.google.com (got: ${tokens.scope ?? "(none)"})`);
  }
}

section("database");
const dataDir = process.env.GRACE_DATA_DIR ?? `${process.env.HOME ?? "."}/.grace`;
const dbPath = `${dataDir}/grace.db`;
if (!existsSync(dbPath)) {
  warn(`${dbPath} does not exist — will be created on first server boot`);
} else {
  pass(`${dbPath} (${formatBytes(statSync(dbPath).size)})`);
  try {
    const { sqlite } = openDb(dbPath);
    const row = (sql: string) => sqlite.prepare(sql).get() as { c: number };
    const f = row("SELECT COUNT(*) AS c FROM folders").c;
    const m = row("SELECT COUNT(*) AS c FROM messages").c;
    const b = row("SELECT COUNT(*) AS c FROM bodies").c;
    detail(`folders=${f}  messages=${m}  bodies=${b}`);
  } catch (err) {
    fail(`db read failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

section("capabilities");
const w3mPath = Bun.which("w3m");
if (w3mPath) pass(`w3m found at ${w3mPath}`);
else warn("w3m not found — `v` rich-render disabled. `brew install w3m` to enable");

section("daemon");
const host = process.env.GRACE_HOST ?? DAEMON_DEFAULT_HOST;
const port = Number(process.env.GRACE_PORT ?? DAEMON_DEFAULT_PORT);
try {
  const res = await fetch(`http://${host}:${port}/api/health`, {
    signal: AbortSignal.timeout(1000),
  });
  if (res.ok) {
    const body = (await res.json()) as { name?: string; pid?: number };
    if (body?.name === "grace") {
      pass(`running at http://${host}:${port} (pid ${body.pid ?? "?"})`);
    } else {
      warn(`http://${host}:${port} responded but not as grace — port collision?`);
    }
  } else {
    warn(`unexpected ${res.status} from http://${host}:${port}/api/health`);
  }
} catch {
  warn(`not reachable at http://${host}:${port} — start with \`bun run dev:server\``);
}

section("imap");
if (!email) {
  warn("skipped — no active account");
} else if (!clientId || !clientSecret) {
  warn("skipped — OAuth env missing");
} else {
  try {
    console.log(`  ${ARROW} refreshing access token…`);
    const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
    pass(`access token OK (${accessToken.length} chars)`);
    console.log(`  ${ARROW} connecting to imap.gmail.com:993…`);
    const client = createImapClient({ email, accessToken });
    await client.connect();
    pass("IMAP handshake OK");
    const list = await client.list();
    pass(`${list.length} mailboxes visible`);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mb = client.mailbox;
      if (typeof mb === "object") {
        detail(`INBOX: exists=${mb.exists}  uidNext=${mb.uidNext}`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    pass("logged out cleanly");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`IMAP check failed: ${msg}`);
    if (msg.includes("simultaneous connections") || msg.includes("Too many")) {
      detail("hint: Gmail caps at 15 concurrent IMAP conns — kill stray dev daemons");
    }
  }
}

console.log("");
if (failed) {
  console.log(`${FAIL} one or more checks failed.`);
  process.exit(1);
} else if (warned) {
  console.log(`${WARN} all critical checks passed (with warnings).`);
  process.exit(0);
} else {
  console.log(`${OK} all checks passed.`);
  process.exit(0);
}

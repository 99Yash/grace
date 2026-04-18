import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { openDb } from "@grace/db";
import { env as getEnv, requireGoogleOAuth } from "@grace/env/server";
import { bootstrapFolder, createImapClient } from "@grace/mail";

const email = loadActiveAccount();
if (!email) {
  console.error("✗ Not signed in. Run `bun run oauth:login`.");
  process.exit(1);
}

const { clientId, clientSecret } = requireGoogleOAuth();
const env = getEnv();

const dbPath = `${env.GRACE_DATA_DIR}/grace.db`;
console.log(`→ db:     ${dbPath}`);
const { db } = openDb(dbPath);
console.log(`✓ db opened`);

console.log(`→ auth:   ${email}`);
const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });

const client = createImapClient({ email, accessToken });
await client.connect();
console.log(`✓ imap connected`);

const folderName = Bun.argv[2] ?? "INBOX";
const limit = Number(Bun.argv[3] ?? 500);
console.log(`→ bootstrap ${folderName} (limit ${limit})`);
const started = performance.now();

const result = await bootstrapFolder({
  client,
  db,
  folderName,
  limit,
  onProgress: (done, total) => {
    process.stdout.write(`\r  ${done}/${total}  `);
  },
});

const secs = ((performance.now() - started) / 1000).toFixed(1);
console.log(`\n✓ inserted ${result.inserted} rows (folderId=${result.folderId}) in ${secs}s`);

await client.logout();
console.log(`✓ logged out`);

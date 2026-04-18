import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import { createImapClient } from "@grace/mail";

const email = loadActiveAccount();
if (!email) {
  console.error("✗ Not signed in. Run `bun run oauth:login` first.");
  process.exit(1);
}

const { clientId, clientSecret } = requireGoogleOAuth();

console.log(`→ email:          ${email}`);
console.log(`→ refreshing access token if needed…`);
const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
console.log(`✓ access token:   ${accessToken.slice(0, 14)}… (${accessToken.length} chars)`);

const client = createImapClient({ email, accessToken });

console.log(`→ connecting to imap.gmail.com…`);
await client.connect();
console.log(`✓ connected`);

console.log(`\n→ mailboxes:`);
const list = await client.list();
for (const m of list) {
  const tag = m.specialUse ? `  ${m.specialUse}` : "";
  console.log(`    ${m.path}${tag}`);
}

console.log(`\n→ opening INBOX:`);
const lock = await client.getMailboxLock("INBOX");
try {
  const mb = client.mailbox;
  if (typeof mb === "object") {
    console.log(`    exists:         ${mb.exists}`);
    console.log(`    unseen:         ${mb.unseen ?? "(unset)"}`);
    console.log(`    uidValidity:    ${mb.uidValidity}`);
    console.log(`    uidNext:        ${mb.uidNext}`);
    console.log(`    highestModseq:  ${mb.highestModseq ?? "(unset)"}`);
  }
} finally {
  lock.release();
}

console.log(`\n→ logging out`);
await client.logout();
console.log(`✓ done`);

import { getFreshAccessToken, loadActiveAccount } from "@grace/auth";
import { requireGoogleOAuth } from "@grace/env/server";
import { createImapClient, type ImapFlow } from "@grace/mail";

let cached: ImapFlow | null = null;
let opening: Promise<ImapFlow> | null = null;

async function openFresh(): Promise<ImapFlow> {
  const email = loadActiveAccount();
  if (!email) throw new Error("not signed in — run `bun run oauth:login`");
  const { clientId, clientSecret } = requireGoogleOAuth();
  const accessToken = await getFreshAccessToken({ email, clientId, clientSecret });
  const client = createImapClient({ email, accessToken });
  await client.connect();
  return client;
}

async function getClient(): Promise<ImapFlow> {
  if (cached && cached.usable) return cached;
  if (!opening) {
    opening = openFresh()
      .then((c) => {
        cached = c;
        return c;
      })
      .finally(() => {
        opening = null;
      });
  }
  return opening;
}

export async function withActionClient<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  let client = await getClient();
  try {
    return await fn(client);
  } catch (err) {
    if (cached === client) {
      try {
        await cached.logout();
      } catch {
        // ignore
      }
      cached = null;
    }
    client = await getClient();
    return await fn(client);
  }
}

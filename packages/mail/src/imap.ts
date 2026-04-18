import { ImapFlow, type ImapFlowOptions } from "imapflow";

export interface GmailConnectOpts {
  email: string;
  accessToken: string;
}

export function createImapClient(opts: GmailConnectOpts & { debug?: boolean }): ImapFlow {
  const config: ImapFlowOptions = {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: opts.email,
      accessToken: opts.accessToken,
    },
    logger: opts.debug
      ? {
          debug: (m) => console.log(`[imap] ${typeof m === "string" ? m : JSON.stringify(m)}`),
          info: (m) => console.log(`[imap:info] ${typeof m === "string" ? m : JSON.stringify(m)}`),
          warn: (m) => console.warn(`[imap:warn] ${typeof m === "string" ? m : JSON.stringify(m)}`),
          error: (m) => console.error(`[imap:err] ${typeof m === "string" ? m : JSON.stringify(m)}`),
        }
      : false,
    qresync: true,
  };
  return new ImapFlow(config);
}

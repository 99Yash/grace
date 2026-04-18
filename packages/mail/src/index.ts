export { createImapClient, type GmailConnectOpts } from "./imap.ts";
export type { ImapFlow } from "imapflow";
export {
  bootstrapFolder,
  DEFAULT_BOOTSTRAP_LIMIT,
  type BootstrapOpts,
  type BootstrapResult,
} from "./bootstrap.ts";
export { startIdleWorker, type IdleWorkerOpts, type IdleWorker } from "./idle.ts";
export {
  runBackfill,
  DEFAULT_BACKFILL_TARGET,
  DEFAULT_BACKFILL_BATCH,
  type BackfillOpts,
} from "./backfill.ts";
export { FETCH_HEADER_FIELDS, persistHeaderMessage } from "./persist.ts";
export {
  fetchMessageBody,
  deriveTextFromHtml,
  isTextUseful,
  type FetchBodyOpts,
  type FetchBodyResult,
  type AttachmentMeta,
} from "./fetch-body.ts";

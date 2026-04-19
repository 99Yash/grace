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
  applyMutation,
  applyLabelChange,
  GMAIL_ALL_MAIL,
  GMAIL_TRASH,
  type MutationAction,
  type MutationTarget,
  type ApplyMutationResult,
  type LabelChange,
} from "./mutations.ts";
export { listFolders, type FolderEntry } from "./list-folders.ts";
export {
  sendMessage,
  parseRecipients,
  type SendMessageOpts,
  type SendMessageResult,
} from "./send.ts";
export {
  fetchMessageBody,
  deriveTextFromHtml,
  extractReplyHeaders,
  isTextUseful,
  type FetchBodyOpts,
  type FetchBodyResult,
  type AttachmentMeta,
} from "./fetch-body.ts";

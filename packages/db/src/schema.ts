import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  uidValidity: integer("uid_validity"),
  highestModseq: text("highest_modseq"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
});

export const messages = sqliteTable(
  "messages",
  {
    gmMsgid: text("gm_msgid").primaryKey(),
    gmThrid: text("gm_thrid"),
    folderId: integer("folder_id").notNull().references(() => folders.id),
    uid: integer("uid").notNull(),
    subject: text("subject"),
    fromName: text("from_name"),
    fromEmail: text("from_email"),
    date: integer("date", { mode: "timestamp_ms" }).notNull(),
    snippet: text("snippet"),
    flags: text("flags").notNull().default("[]"),
    labels: text("labels").notNull().default("[]"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    byFolderDate: index("messages_folder_date_idx").on(t.folderId, t.date),
    byThread: index("messages_thread_idx").on(t.gmThrid),
  }),
);

export const bodies = sqliteTable("bodies", {
  gmMsgid: text("gm_msgid")
    .primaryKey()
    .references(() => messages.gmMsgid, { onDelete: "cascade" }),
  text: text("text"),
  htmlPath: text("html_path"),
  rawPath: text("raw_path"),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
});

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Body = typeof bodies.$inferSelect;
export type NewBody = typeof bodies.$inferInsert;

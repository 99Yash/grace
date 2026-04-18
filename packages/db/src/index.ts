export * as schema from "./schema.ts";
export { folders, messages, bodies } from "./schema.ts";
export type { Folder, NewFolder, Message, NewMessage, Body, NewBody } from "./schema.ts";
export { openDb, type GraceDB } from "./client.ts";

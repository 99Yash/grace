import { Elysia } from "elysia";
import { activateRoutes } from "./routes/activate.ts";
import { authRoutes } from "./routes/auth.ts";
import { bodyRoutes } from "./routes/body.ts";
import { capabilityRoutes } from "./routes/capabilities.ts";
import { draftRoutes } from "./routes/drafts.ts";
import { eventRoutes } from "./routes/events.ts";
import { folderRoutes } from "./routes/folders.ts";
import { messageRoutes } from "./routes/messages.ts";
import { mutateRoutes } from "./routes/mutate.ts";
import { labelRoutes } from "./routes/labels.ts";
import { importRoutes } from "./routes/import.ts";
import { searchRoutes } from "./routes/search.ts";
import { sendRoutes } from "./routes/send.ts";

export { bus, type BusEvent } from "./bus.ts";
export { getCapabilities, type Capabilities } from "./capabilities.ts";
export type { DraftRecord } from "./routes/drafts.ts";
export type { SearchHit } from "./routes/search.ts";

export const app = new Elysia({ prefix: "/api" })
  .get("/health", () => ({ ok: true, name: "grace", pid: process.pid }))
  .post("/shutdown", () => {
    setTimeout(() => process.exit(0), 100);
    return { ok: true };
  })
  .use(authRoutes)
  .use(capabilityRoutes)
  .use(folderRoutes)
  .use(activateRoutes)
  .use(messageRoutes)
  .use(bodyRoutes)
  .use(mutateRoutes)
  .use(labelRoutes)
  .use(importRoutes)
  .use(searchRoutes)
  .use(sendRoutes)
  .use(draftRoutes)
  .use(eventRoutes);

export type App = typeof app;

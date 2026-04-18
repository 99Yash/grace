import { Elysia } from "elysia";
import { authRoutes } from "./routes/auth.ts";
import { bodyRoutes } from "./routes/body.ts";
import { capabilityRoutes } from "./routes/capabilities.ts";
import { eventRoutes } from "./routes/events.ts";
import { folderRoutes } from "./routes/folders.ts";
import { messageRoutes } from "./routes/messages.ts";
import { importRoutes } from "./routes/import.ts";
import { searchRoutes } from "./routes/search.ts";

export { bus, type BusEvent } from "./bus.ts";
export { getCapabilities, type Capabilities } from "./capabilities.ts";
export type { SearchHit } from "./routes/search.ts";

export const app = new Elysia({ prefix: "/api" })
  .get("/health", () => ({ ok: true, name: "grace" }))
  .use(authRoutes)
  .use(capabilityRoutes)
  .use(folderRoutes)
  .use(messageRoutes)
  .use(bodyRoutes)
  .use(importRoutes)
  .use(searchRoutes)
  .use(eventRoutes);

export type App = typeof app;

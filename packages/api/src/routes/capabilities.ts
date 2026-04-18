import { Elysia } from "elysia";
import { getCapabilities } from "../capabilities.ts";

export const capabilityRoutes = new Elysia().get("/capabilities", () => getCapabilities());

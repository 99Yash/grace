import { Elysia, t } from "elysia";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "@grace/env/server";

export type DraftRecord = {
  id: "current";
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  updatedAt: number;
};

function draftsPath(): string {
  return `${env().GRACE_DATA_DIR}/drafts/drafts.jsonl`;
}

async function readCurrentDraft(): Promise<DraftRecord | null> {
  const file = Bun.file(draftsPath());
  if (!(await file.exists())) return null;
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    try {
      const parsed = JSON.parse(line) as DraftRecord;
      if (parsed.id === "current") return parsed;
    } catch {
      // Skip corrupt line, keep scanning older entries.
    }
  }
  return null;
}

async function writeCurrentDraft(record: DraftRecord): Promise<void> {
  const path = draftsPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(record)}\n`);
}

async function clearCurrentDraft(): Promise<void> {
  const file = Bun.file(draftsPath());
  if (!(await file.exists())) return;
  await Bun.write(draftsPath(), "");
}

export const draftRoutes = new Elysia({ prefix: "/drafts" })
  .get("/current", async () => {
    const draft = await readCurrentDraft();
    return { draft };
  })
  .put(
    "/current",
    async ({ body }) => {
      const record: DraftRecord = {
        id: "current",
        to: body.to,
        ...(body.cc && body.cc.length > 0 ? { cc: body.cc } : {}),
        ...(body.bcc && body.bcc.length > 0 ? { bcc: body.bcc } : {}),
        subject: body.subject,
        text: body.text,
        updatedAt: Date.now(),
      };
      await writeCurrentDraft(record);
      return { ok: true as const, updatedAt: record.updatedAt };
    },
    {
      body: t.Object({
        to: t.String(),
        cc: t.Optional(t.String()),
        bcc: t.Optional(t.String()),
        subject: t.String(),
        text: t.String(),
      }),
    },
  )
  .delete("/current", async () => {
    await clearCurrentDraft();
    return { ok: true as const };
  });

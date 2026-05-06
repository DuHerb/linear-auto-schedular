import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? "/app/data/scheduler.db";
const SECRET = process.env.LINEAR_WEBHOOK_SECRET;
const MAX_BODY_BYTES = 1_048_576; // 1 MiB; Linear payloads are well under this.

if (!SECRET) {
  console.error("[listener] FATAL: LINEAR_WEBHOOK_SECRET env var required");
  process.exit(1);
}

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
// Schema is owned by scheduler-state; we share the volume + WAL so the
// listener writes into the same `signals` table the MCP reads from. We do
// NOT create or alter tables here — that would race scheduler-state's boot.
const insertSignal = db.prepare(
  "INSERT INTO signals (signal_id, source, kind, payload) VALUES (?, ?, ?, ?)",
);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function verifySignature(body: Buffer, header: string | undefined): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", SECRET as string)
    .update(body)
    .digest("hex");
  // timingSafeEqual throws on length mismatch; treat that as failed verify.
  try {
    const a = Buffer.from(header, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function deriveKind(payload: unknown): string {
  // Linear webhook envelope: { action: "create"|"update"|"remove", type: "Issue"|... }
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "unknown";
    const action = typeof p.action === "string" ? p.action : "event";
    return `${type}.${action}`;
  }
  return "unknown.event";
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Buffer;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413).end();
    return;
  }

  const sigHeader = req.headers["linear-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!verifySignature(body, signature)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid_signature" }));
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf-8"));
  } catch {
    // Signature passed but body isn't JSON. Surface as 400; do NOT log to signals.
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
    return;
  }

  const signalId = randomUUID();
  const kind = deriveKind(payload);
  try {
    insertSignal.run(signalId, "linear", kind, body.toString("utf-8"));
  } catch (err) {
    console.error(
      `[listener] insert failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "persist_failed" }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, signal_id: signalId, kind }));
  console.error(`[listener] signal ${signalId} kind=${kind}`);
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/webhooks/linear") {
    void handleWebhook(req, res);
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.error(`[listener] listening on :${PORT}; db=${DB_PATH}`);
});

function shutdown(signal: string): void {
  console.error(`[listener] ${signal} received; closing`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

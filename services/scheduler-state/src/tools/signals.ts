import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";

export const signalsTools = [
  {
    name: "log_signal",
    description:
      "Records a webhook/external signal for later processing. Args: { source, kind, payload }. Returns { signal_id }. The webhook listener writes signals directly via SQLite (shared volume) — this MCP tool exists for manual injection from claude (replay, testing).",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string" },
        kind: { type: "string" },
        payload: {},
      },
      required: ["source", "kind", "payload"],
      additionalProperties: false,
    },
  },
  {
    name: "list_signals",
    description:
      "Lists signals filtered by source/processed. Args: { source?, processed? }. When processed=true returns only processed signals; when processed=false returns only unprocessed; when omitted returns all. Ordered by received_at ascending so /process-signals drains FIFO.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string" },
        processed: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mark_signal_processed",
    description:
      "Marks a signal as processed with optional resolution note. Args: { signal_id, resolution? }. Atomic guard mirrors mark_plan_applied: only stamps processed_at when still NULL, throws on already-processed or unknown signal_id so re-drains surface loudly instead of silently re-stamping.",
    inputSchema: {
      type: "object" as const,
      properties: {
        signal_id: { type: "string" },
        resolution: { type: "string" },
      },
      required: ["signal_id"],
      additionalProperties: false,
    },
  },
];

const LogSignalArgs = z.object({
  source: z.string().min(1),
  kind: z.string().min(1),
  payload: z.unknown(),
});

const ListSignalsArgs = z.object({
  source: z.string().min(1).optional(),
  processed: z.boolean().optional(),
});

const MarkSignalProcessedArgs = z.object({
  signal_id: z.string().uuid(),
  resolution: z.string().optional(),
});

interface SignalRow {
  signal_id: string;
  source: string;
  kind: string;
  payload: string;
  received_at: string;
  processed_at: string | null;
  resolution: string | null;
}

export interface Signal {
  signal_id: string;
  source: string;
  kind: string;
  payload: unknown;
  received_at: string;
  processed_at: string | null;
  resolution: string | null;
}

export function handleLogSignal(rawArgs: unknown): { signal_id: string } {
  const args = LogSignalArgs.parse(rawArgs);
  const signalId = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO signals (signal_id, source, kind, payload) VALUES (?, ?, ?, ?)",
    )
    .run(signalId, args.source, args.kind, JSON.stringify(args.payload));
  return { signal_id: signalId };
}

export function handleListSignals(rawArgs: unknown): Signal[] {
  const args = ListSignalsArgs.parse(rawArgs ?? {});
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (args.source !== undefined) {
    clauses.push("source = ?");
    params.push(args.source);
  }
  if (args.processed === true) {
    clauses.push("processed_at IS NOT NULL");
  } else if (args.processed === false) {
    clauses.push("processed_at IS NULL");
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `SELECT signal_id, source, kind, payload, received_at, processed_at, resolution
         FROM signals
         ${where}
         ORDER BY received_at ASC, signal_id ASC`,
    )
    .all(...params) as SignalRow[];
  return rows.map((r) => ({
    ...r,
    payload: JSON.parse(r.payload) as unknown,
  }));
}

export function handleMarkSignalProcessed(rawArgs: unknown): {
  signal_id: string;
  processed_at: string;
  resolution: string | null;
} {
  const { signal_id, resolution } = MarkSignalProcessedArgs.parse(rawArgs);
  const db = getDb();
  const processedAt = new Date().toISOString();
  // Atomic guard: only stamp when still NULL. Mirrors mark_plan_applied so two
  // overlapping /process-signals invocations can't both claim the same signal.
  const result = db
    .prepare(
      "UPDATE signals SET processed_at = ?, resolution = ? WHERE signal_id = ? AND processed_at IS NULL",
    )
    .run(processedAt, resolution ?? null, signal_id);
  if (result.changes === 0) {
    const existing = db
      .prepare("SELECT processed_at FROM signals WHERE signal_id = ?")
      .get(signal_id) as { processed_at: string | null } | undefined;
    if (!existing) {
      throw new Error(`signal ${signal_id} not found`);
    }
    throw new Error(
      `signal ${signal_id} already processed at ${existing.processed_at}; refusing to overwrite`,
    );
  }
  return { signal_id, processed_at: processedAt, resolution: resolution ?? null };
}

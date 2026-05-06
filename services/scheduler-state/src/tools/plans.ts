import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";

export const plansTools = [
  {
    name: "save_plan",
    description:
      "Persists a plan from /plan-week. Args: { content: { week_of, sessions: [...] } }. Returns { plan_id }. The minimum session shape (issue IDs + ISO 8601 timestamps + session indices) is validated; descriptive fields like title/reasoning pass through as opaque JSON.",
    inputSchema: {
      type: "object" as const,
      properties: { content: { type: "object" } },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "get_latest_plan",
    description:
      "Returns the most recently generated plan (by generated_at desc), or null if no plans exist. Used by /apply-plan to pick up what /plan-week produced.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "mark_plan_applied",
    description:
      "Marks a plan as applied (sets applied_at = now). Args: { plan_id }. Stub in v1 — implemented in Story 2 (DUS-7).",
    inputSchema: {
      type: "object" as const,
      properties: { plan_id: { type: "string" } },
      required: ["plan_id"],
      additionalProperties: false,
    },
  },
];

// Minimum session shape that /apply-plan (DUS-7) will rely on. Other fields
// (title, reasoning, linear_url, estimate_minutes) pass through via .passthrough()
// — they're descriptive, owned by the slash command, and not load-bearing for
// downstream MCP handlers.
const SessionSchema = z
  .object({
    linear_issue_id: z.string().min(1),
    linear_issue_identifier: z.string().min(1),
    session_index: z.number().int().positive(),
    total_sessions: z.number().int().positive(),
    planned_start: z.string().datetime({ offset: true }),
    planned_end: z.string().datetime({ offset: true }),
  })
  .passthrough();

const PlanContentSchema = z
  .object({
    week_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "week_of must be YYYY-MM-DD"),
    sessions: z.array(SessionSchema).min(1, "plan must have at least one session"),
  })
  .passthrough();

const SavePlanArgs = z.object({
  content: PlanContentSchema,
});

export type PlanContent = z.infer<typeof PlanContentSchema>;

interface PlanRow {
  plan_id: string;
  generated_at: string;
  applied_at: string | null;
  content: string;
}

export interface Plan {
  plan_id: string;
  generated_at: string;
  applied_at: string | null;
  content: PlanContent;
}

export function handleSavePlan(rawArgs: unknown): { plan_id: string } {
  const args = SavePlanArgs.parse(rawArgs);
  const planId = randomUUID();
  // Re-stringify the parsed content so unknown extra fields are preserved
  // verbatim but the validated subset is canonical (no whitespace surprises,
  // no non-string keys).
  getDb()
    .prepare("INSERT INTO plans (plan_id, content) VALUES (?, ?)")
    .run(planId, JSON.stringify(args.content));
  return { plan_id: planId };
}

export function handleGetLatestPlan(): Plan | null {
  const row = getDb()
    .prepare(
      "SELECT plan_id, generated_at, applied_at, content FROM plans ORDER BY generated_at DESC, plan_id DESC LIMIT 1",
    )
    .get() as PlanRow | undefined;
  if (!row) return null;
  return {
    plan_id: row.plan_id,
    generated_at: row.generated_at,
    applied_at: row.applied_at,
    content: JSON.parse(row.content) as PlanContent,
  };
}

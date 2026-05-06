import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";

export const plansTools = [
  {
    name: "save_plan",
    description:
      "Persists a plan from /plan-week. Args: { content: object }. Returns { plan_id }. The content shape is defined by the slash command — stored as opaque JSON.",
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

const SavePlanArgs = z.object({
  content: z.record(z.string(), z.unknown()),
});

interface PlanRow {
  plan_id: string;
  generated_at: string;
  applied_at: string | null;
  content: string;
}

export function handleSavePlan(rawArgs: unknown): { plan_id: string } {
  const args = SavePlanArgs.parse(rawArgs);
  const planId = randomUUID();
  getDb()
    .prepare("INSERT INTO plans (plan_id, content) VALUES (?, ?)")
    .run(planId, JSON.stringify(args.content));
  return { plan_id: planId };
}

export function handleGetLatestPlan(): {
  plan_id: string;
  generated_at: string;
  applied_at: string | null;
  content: unknown;
} | null {
  const row = getDb()
    .prepare(
      "SELECT plan_id, generated_at, applied_at, content FROM plans ORDER BY generated_at DESC LIMIT 1",
    )
    .get() as PlanRow | undefined;
  if (!row) return null;
  return {
    plan_id: row.plan_id,
    generated_at: row.generated_at,
    applied_at: row.applied_at,
    content: JSON.parse(row.content),
  };
}

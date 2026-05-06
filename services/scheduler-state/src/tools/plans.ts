export const plansTools = [
  {
    name: "save_plan",
    description:
      "Persists a plan from /plan-week. Args: { content: object }. Returns { plan_id }. Stub in v1 — implemented in Story 1.",
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
      "Returns the most recently generated plan, or null. Used by /apply-plan. Stub in v1 — implemented in Story 1.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "mark_plan_applied",
    description:
      "Marks a plan as applied (sets applied_at). Args: { plan_id }. Stub in v1 — implemented in Story 2.",
    inputSchema: {
      type: "object" as const,
      properties: { plan_id: { type: "string" } },
      required: ["plan_id"],
      additionalProperties: false,
    },
  },
];

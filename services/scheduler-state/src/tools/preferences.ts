export const preferencesTools = [
  {
    name: "get_preferences",
    description:
      "Returns parsed preferences.yaml: timezone, working_hours, defaults, fixed_blocks, calendars. Stub in v1 — implemented in Story 1.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
];

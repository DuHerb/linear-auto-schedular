export const signalsTools = [
  {
    name: "log_signal",
    description:
      "Records a webhook/external signal for later processing. Args: { source, kind, payload }. Stub in v1 — implemented in Story 4.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source: { type: "string" },
        kind: { type: "string" },
        payload: { type: "object" },
      },
      required: ["source", "kind", "payload"],
      additionalProperties: false,
    },
  },
  {
    name: "list_signals",
    description:
      "Lists signals filtered by since/source/processed. Stub in v1 — implemented in Story 4.",
    inputSchema: {
      type: "object" as const,
      properties: {
        since: { type: "string" },
        source: { type: "string" },
        processed: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mark_signal_processed",
    description:
      "Marks a signal as processed with optional resolution note. Stub in v1 — implemented in Story 4.",
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

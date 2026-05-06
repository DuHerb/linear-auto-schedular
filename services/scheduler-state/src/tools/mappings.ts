export const mappingsTools = [
  {
    name: "record_mapping",
    description:
      "Records a Linear-issue ↔ calendar-event mapping. Stub in v1 — implemented in Story 2.",
    inputSchema: {
      type: "object" as const,
      properties: {
        linear_issue_id: { type: "string" },
        linear_issue_identifier: { type: "string" },
        calendar_event_id: { type: "string" },
        calendar_id: { type: "string" },
        session_index: { type: "integer" },
        total_sessions: { type: "integer" },
        planned_start: { type: "string" },
        planned_end: { type: "string" },
        status: { type: "string" },
        plan_id: { type: "string" },
      },
      required: [
        "linear_issue_id",
        "linear_issue_identifier",
        "calendar_event_id",
        "calendar_id",
        "session_index",
        "total_sessions",
        "planned_start",
        "planned_end",
        "status",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "get_mappings_for_issue",
    description:
      "Returns all mappings for a given Linear issue. Stub in v1 — implemented in Story 2.",
    inputSchema: {
      type: "object" as const,
      properties: { linear_issue_id: { type: "string" } },
      required: ["linear_issue_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_mapping_for_event",
    description:
      "Returns the mapping for a given calendar event, or null. Stub in v1 — implemented in Story 4.",
    inputSchema: {
      type: "object" as const,
      properties: { calendar_event_id: { type: "string" } },
      required: ["calendar_event_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_active_mappings",
    description:
      "Returns mappings with status in ('scheduled','in_progress'). Stub in v1 — implemented in Story 2.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "update_mapping_status",
    description:
      "Updates a mapping's status. Args: { mapping_id, status, note? }. Stub in v1 — implemented in Story 4.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mapping_id: { type: "string" },
        status: { type: "string" },
        note: { type: "string" },
      },
      required: ["mapping_id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_mapping",
    description: "Deletes a mapping row. Stub in v1 — implemented in Story 4.",
    inputSchema: {
      type: "object" as const,
      properties: { mapping_id: { type: "string" } },
      required: ["mapping_id"],
      additionalProperties: false,
    },
  },
];

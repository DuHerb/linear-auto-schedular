import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";

export const mappingsTools = [
  {
    name: "record_mapping",
    description:
      "Records a Linear-issue ↔ calendar-event mapping after /apply-plan creates an event. Returns { mapping_id }. All timestamp fields must be ISO 8601 with offset.",
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
      "Returns all mappings for a given Linear issue, ordered by session_index. Used by /process-signals to find existing schedules for Done/Cancelled events and to detect already-scheduled issues for idempotency on retries.",
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
      "Returns the mapping for a given calendar event, or null.",
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
      "Returns mappings with status in ('scheduled','in_progress'), ordered by planned_start ascending.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "update_mapping_status",
    description:
      "Updates a mapping's status (scheduled | in_progress | completed | cancelled) and bumps updated_at. Used by /process-signals when Linear issue state changes drive calendar lifecycle. Args: { mapping_id, status }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mapping_id: { type: "string" },
        status: { type: "string" },
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

const MappingStatus = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
]);

const GetMappingsForIssueArgs = z.object({
  linear_issue_id: z.string().min(1),
});

const GetMappingForEventArgs = z.object({
  calendar_event_id: z.string().min(1),
});

const UpdateMappingStatusArgs = z.object({
  mapping_id: z.string().uuid(),
  status: MappingStatus,
});

const RecordMappingArgs = z
  .object({
    linear_issue_id: z.string().min(1),
    linear_issue_identifier: z.string().min(1),
    calendar_event_id: z.string().min(1),
    calendar_id: z.string().min(1),
    session_index: z.number().int().positive(),
    total_sessions: z.number().int().positive(),
    planned_start: z.string().datetime({ offset: true }),
    planned_end: z.string().datetime({ offset: true }),
    status: MappingStatus,
    plan_id: z.string().uuid().optional(),
  })
  .refine((a) => a.session_index <= a.total_sessions, {
    message: "session_index must be <= total_sessions",
    path: ["session_index"],
  });

interface MappingRow {
  mapping_id: string;
  linear_issue_id: string;
  linear_issue_identifier: string;
  calendar_event_id: string;
  calendar_id: string;
  session_index: number;
  total_sessions: number;
  planned_start: string;
  planned_end: string;
  status: string;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
}

export type Mapping = MappingRow;

export function handleRecordMapping(rawArgs: unknown): { mapping_id: string } {
  const args = RecordMappingArgs.parse(rawArgs);
  const mappingId = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO mappings (
         mapping_id, linear_issue_id, linear_issue_identifier,
         calendar_event_id, calendar_id,
         session_index, total_sessions,
         planned_start, planned_end,
         status, plan_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      mappingId,
      args.linear_issue_id,
      args.linear_issue_identifier,
      args.calendar_event_id,
      args.calendar_id,
      args.session_index,
      args.total_sessions,
      args.planned_start,
      args.planned_end,
      args.status,
      args.plan_id ?? null,
    );
  return { mapping_id: mappingId };
}

export function handleGetMappingsForIssue(rawArgs: unknown): Mapping[] {
  const { linear_issue_id } = GetMappingsForIssueArgs.parse(rawArgs);
  const rows = getDb()
    .prepare(
      `SELECT mapping_id, linear_issue_id, linear_issue_identifier,
              calendar_event_id, calendar_id,
              session_index, total_sessions,
              planned_start, planned_end,
              status, plan_id, created_at, updated_at
         FROM mappings
        WHERE linear_issue_id = ?
        ORDER BY session_index ASC`,
    )
    .all(linear_issue_id) as MappingRow[];
  return rows;
}

export function handleGetMappingForEvent(rawArgs: unknown): Mapping | null {
  const { calendar_event_id } = GetMappingForEventArgs.parse(rawArgs);
  const row = getDb()
    .prepare(
      `SELECT mapping_id, linear_issue_id, linear_issue_identifier,
              calendar_event_id, calendar_id,
              session_index, total_sessions,
              planned_start, planned_end,
              status, plan_id, created_at, updated_at
         FROM mappings
        WHERE calendar_event_id = ?`,
    )
    .get(calendar_event_id) as MappingRow | undefined;
  return row ?? null;
}

export function handleUpdateMappingStatus(rawArgs: unknown): {
  mapping_id: string;
  status: string;
  updated_at: string;
} {
  const { mapping_id, status } = UpdateMappingStatusArgs.parse(rawArgs);
  const updatedAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      "UPDATE mappings SET status = ?, updated_at = ? WHERE mapping_id = ?",
    )
    .run(status, updatedAt, mapping_id);
  if (result.changes === 0) {
    throw new Error(`mapping ${mapping_id} not found`);
  }
  return { mapping_id, status, updated_at: updatedAt };
}

export function handleListActiveMappings(): Mapping[] {
  const rows = getDb()
    .prepare(
      `SELECT mapping_id, linear_issue_id, linear_issue_identifier,
              calendar_event_id, calendar_id,
              session_index, total_sessions,
              planned_start, planned_end,
              status, plan_id, created_at, updated_at
         FROM mappings
        WHERE status IN ('scheduled', 'in_progress')
        ORDER BY planned_start ASC, session_index ASC`,
    )
    .all() as MappingRow[];
  return rows;
}

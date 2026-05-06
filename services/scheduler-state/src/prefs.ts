import { readFileSync, existsSync } from "node:fs";
import { load } from "js-yaml";
import { z } from "zod";

const PREFS_PATH = process.env.PREFS_PATH ?? "/app/config/preferences.yaml";

const HoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const FixedBlockSchema = z.object({
  name: z.string(),
  days: z.array(z.string()),
  start: z.string().optional(),
  window_start: z.string().optional(),
  window_end: z.string().optional(),
  duration_minutes: z.number().int().positive().optional(),
  type: z.enum(["block", "flexible"]),
});

const PreferencesSchema = z.object({
  timezone: z.string(),
  working_hours: z.record(z.string(), HoursSchema),
  defaults: z.object({
    session_min_minutes: z.number().int().positive(),
    session_max_minutes: z.number().int().positive(),
    break_after_minutes: z.number().int().positive(),
    break_duration_minutes: z.number().int().positive(),
    buffer_around_meetings_minutes: z.number().int().nonnegative(),
  }),
  fixed_blocks: z.array(FixedBlockSchema).default([]),
  calendars: z.object({
    primary_email: z.string(),
    agent_writes_to: z.string(),
    // Calendars whose busy intervals the planner should treat as conflicts.
    // When omitted, /plan-week defaults to every calendar the user has
    // access to (via list-calendars) minus `agent_writes_to`. Set this
    // explicitly to narrow the scope. An empty array disables conflict
    // checking entirely — to use the default expansion, omit the field.
    conflict_sources: z.array(z.string()).optional(),
  }),
});

export type Preferences = z.infer<typeof PreferencesSchema>;

export function loadPreferences(): Preferences {
  if (!existsSync(PREFS_PATH)) {
    throw new Error(`preferences.yaml not found at ${PREFS_PATH}`);
  }
  const raw = readFileSync(PREFS_PATH, "utf-8");
  const parsed = load(raw);
  const result = PreferencesSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `preferences.yaml validation failed: ${JSON.stringify(result.error.format())}`,
    );
  }
  return result.data;
}

export function tryLoadPreferences(): { ok: true; prefs: Preferences } | { ok: false; error: string } {
  try {
    return { ok: true, prefs: loadPreferences() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function getPrefsPath(): string {
  return PREFS_PATH;
}

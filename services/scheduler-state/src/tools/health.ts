import { getDb, getDbPath } from "../db.js";
import { tryLoadPreferences, getPrefsPath } from "../prefs.js";

export const healthCheckTool = {
  name: "health_check",
  description:
    "Returns liveness state for the scheduler-state MCP. Confirms SQLite is open, schema is applied, and preferences.yaml parses.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
};

export function handleHealthCheck() {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const prefsResult = tryLoadPreferences();

  return {
    ok: true,
    db_path: getDbPath(),
    prefs_path: getPrefsPath(),
    prefs_loaded: prefsResult.ok,
    prefs_error: prefsResult.ok ? undefined : prefsResult.error,
    schema_version: 1,
    tables: tables.map((t) => t.name),
  };
}

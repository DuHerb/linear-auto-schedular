import { loadPreferences } from "../prefs.js";

export const preferencesTools = [
  {
    name: "get_preferences",
    description:
      "Returns parsed preferences.yaml: timezone, working_hours, defaults, fixed_blocks, calendars (primary_email, agent_writes_to, optional conflict_sources). Throws if the file is missing or fails schema validation.",
    inputSchema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
];

export function handleGetPreferences() {
  return loadPreferences();
}

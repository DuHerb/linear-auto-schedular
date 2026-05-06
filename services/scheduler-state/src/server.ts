import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { healthCheckTool, handleHealthCheck } from "./tools/health.js";
import { preferencesTools, handleGetPreferences } from "./tools/preferences.js";
import {
  plansTools,
  handleSavePlan,
  handleGetLatestPlan,
  handleMarkPlanApplied,
} from "./tools/plans.js";
import {
  mappingsTools,
  handleRecordMapping,
  handleListActiveMappings,
  handleGetMappingsForIssue,
  handleGetMappingForEvent,
  handleUpdateMappingStatus,
} from "./tools/mappings.js";
import {
  signalsTools,
  handleLogSignal,
  handleListSignals,
  handleMarkSignalProcessed,
} from "./tools/signals.js";

const allTools = [
  healthCheckTool,
  ...preferencesTools,
  ...plansTools,
  ...mappingsTools,
  ...signalsTools,
];

type Handler = (args: unknown) => unknown;

const handlers: Record<string, Handler> = {
  health_check: () => handleHealthCheck(),
  get_preferences: () => handleGetPreferences(),
  save_plan: (args) => handleSavePlan(args),
  get_latest_plan: () => handleGetLatestPlan(),
  mark_plan_applied: (args) => handleMarkPlanApplied(args),
  record_mapping: (args) => handleRecordMapping(args),
  list_active_mappings: () => handleListActiveMappings(),
  get_mappings_for_issue: (args) => handleGetMappingsForIssue(args),
  get_mapping_for_event: (args) => handleGetMappingForEvent(args),
  update_mapping_status: (args) => handleUpdateMappingStatus(args),
  log_signal: (args) => handleLogSignal(args),
  list_signals: (args) => handleListSignals(args),
  mark_signal_processed: (args) => handleMarkSignalProcessed(args),
};

export function createServer(): Server {
  const server = new Server(
    { name: "scheduler-state", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];

    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "not_implemented",
              tool: name,
              note: "Stub registered in scaffold. Real handler arrives in the story that owns this tool — see PLANNING.md.",
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const result = handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: false, error: message, tool: name }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

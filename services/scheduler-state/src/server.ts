import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { healthCheckTool, handleHealthCheck } from "./tools/health.js";
import { preferencesTools } from "./tools/preferences.js";
import { plansTools } from "./tools/plans.js";
import { mappingsTools } from "./tools/mappings.js";
import { signalsTools } from "./tools/signals.js";

const allTools = [
  healthCheckTool,
  ...preferencesTools,
  ...plansTools,
  ...mappingsTools,
  ...signalsTools,
];

export function createServer(): Server {
  const server = new Server(
    { name: "scheduler-state", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;

    if (name === "health_check") {
      const result = handleHealthCheck();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

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
  });

  return server;
}

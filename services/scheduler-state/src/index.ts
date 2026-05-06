import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getDb, getDbPath } from "./db.js";

async function main() {
  const db = getDb();
  process.stderr.write(
    `[scheduler-state] schema applied; db=${getDbPath()}; tables=${db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
      .join(",")}\n`,
  );

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[scheduler-state] mcp stdio transport ready\n");
}

main().catch((err) => {
  process.stderr.write(`[scheduler-state] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { createEmailService } from "./email-service.js";
import { credsFromEnv } from "./config.js";

// Lokální varianta serveru přes stdio (Claude Desktop / Claude Code).
// Online (claude.ai) varianta je v http.ts.
async function main() {
  const server = createMcpServer(createEmailService(credsFromEnv()));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logujeme VÝHRADNĚ na stderr — stdout je vyhrazen pro MCP protokol.
  console.error("email-mcp běží (stdio). Připraveno přijímat nástroje.");
}

main().catch((err) => {
  console.error("Fatální chyba při startu email-mcp:", err);
  process.exit(1);
});

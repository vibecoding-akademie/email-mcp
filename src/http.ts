import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.js";
import { createAuth } from "./auth.js";
import { config } from "./config.js";

// ── Odvození a kontrola povinné konfigurace pro online režim ──────────────────
function publicUrl(): string {
  const raw =
    config.PUBLIC_URL ||
    (config.RAILWAY_PUBLIC_DOMAIN ? `https://${config.RAILWAY_PUBLIC_DOMAIN}` : "");
  return raw.replace(/\/+$/, "");
}

function requireOnlineConfig(): { publicUrl: string; ownerPassword: string; jwtSecret: string } {
  const missing: string[] = [];
  const url = publicUrl();
  if (!url) missing.push("PUBLIC_URL (nebo RAILWAY_PUBLIC_DOMAIN)");
  if (!config.OWNER_PASSWORD) missing.push("OWNER_PASSWORD");
  if (!config.JWT_SECRET) missing.push("JWT_SECRET");
  if (missing.length > 0) {
    console.error(
      "❌ Online (HTTP) režim vyžaduje tyto proměnné prostředí:\n" +
        missing.map((m) => `  • ${m}`).join("\n"),
    );
    process.exit(1);
  }
  return { publicUrl: url, ownerPassword: config.OWNER_PASSWORD!, jwtSecret: config.JWT_SECRET! };
}

const online = requireOnlineConfig();
const auth = createAuth(online);

const app = express();
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"],
    exposedHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
  }),
);
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));

// OAuth endpointy (discovery, register, authorize, token)
app.use(auth.router);

// Health-check (veřejný, bez přihlášení) — pro Railway a rychlou kontrolu
app.get("/", (_req, res) => {
  res.json({ name: "email-mcp", status: "ok", transport: "streamable-http" });
});

// ── MCP endpoint (Streamable HTTP, session-based) — chráněný OAuth tokenem ─────
// Sessions drží v paměti. Jsou krátké; po restartu se klient znovu inicializuje
// (OAuth token je stateless, takže přihlášení zůstává v platnosti).
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", auth.requireOwner, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) delete transports[transport!.sessionId];
      };
      const server = createMcpServer();
      await server.connect(transport);
    } else if (!transport) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Chybí platné Mcp-Session-Id (nejdřív pošli initialize)." },
        id: null,
      });
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Chyba při zpracování MCP požadavku:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Interní chyba serveru" },
        id: null,
      });
    }
  }
});

// GET = SSE stream serveru, DELETE = ukončení session.
async function handleSession(req: express.Request, res: express.Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Neznámé nebo chybějící Mcp-Session-Id." },
      id: null,
    });
  }
  await transport.handleRequest(req, res);
}
app.get("/mcp", auth.requireOwner, handleSession);
app.delete("/mcp", auth.requireOwner, handleSession);

app.listen(config.PORT, () => {
  console.log(`email-mcp (online) běží na portu ${config.PORT}`);
  console.log(`Veřejná adresa: ${online.publicUrl}`);
  console.log(`Connector URL do claude.ai: ${online.publicUrl}/mcp`);
});

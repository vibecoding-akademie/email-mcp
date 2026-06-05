import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./server.js";
import { createEmailService } from "./email-service.js";
import { createAuth } from "./auth.js";
import { createStore } from "./store.js";
import { makeCrypto } from "./crypto.js";
import { guideHtml } from "./guide.js";
import { config } from "./config.js";

// ── Povinná konfigurace pro online režim ──────────────────────────────────────
function publicUrl(): string {
  const raw =
    config.PUBLIC_URL ||
    (config.RAILWAY_PUBLIC_DOMAIN ? `https://${config.RAILWAY_PUBLIC_DOMAIN}` : "");
  return raw.replace(/\/+$/, "");
}

function requireOnlineConfig() {
  const missing: string[] = [];
  const url = publicUrl();
  if (!url) missing.push("PUBLIC_URL (nebo RAILWAY_PUBLIC_DOMAIN)");
  if (!config.JWT_SECRET) missing.push("JWT_SECRET");
  if (!config.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
  if (missing.length > 0) {
    console.error("❌ Online režim vyžaduje:\n" + missing.map((m) => `  • ${m}`).join("\n"));
    process.exit(1);
  }
  return { publicUrl: url, jwtSecret: config.JWT_SECRET!, encryptionKey: config.ENCRYPTION_KEY! };
}

const online = requireOnlineConfig();
const crypto = makeCrypto(online.encryptionKey);
const store = createStore({ databaseUrl: config.DATABASE_URL, crypto });
const auth = createAuth({ publicUrl: online.publicUrl, jwtSecret: online.jwtSecret, store });

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
app.use(auth.router);

app.get("/", (_req, res) => {
  res.json({ name: "email-mcp", status: "ok", transport: "streamable-http", store: store.kind });
});

// Návod (sdílitelná stránka) — adresu serveru doplní za __PUBLIC_URL__.
app.get("/navod", (_req, res) => {
  res.type("html").send(guideHtml.replaceAll("__PUBLIC_URL__", online.publicUrl));
});

// ── MCP endpoint (session-based) — chráněno OAuth tokenem ──────────────────────
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", auth.requireAuth, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports[sessionId] : undefined;
    const reqId = (req.body as { id?: string | number | null } | undefined)?.id ?? null;
    res.on("finish", () =>
      console.error(`[mcp] ${req.body?.method ?? "?"} session=${sessionId ? "ano" : "ne"} -> ${res.statusCode}`),
    );

    if (!transport && isInitializeRequest(req.body)) {
      // Načti údaje schránky tohoto uživatele (z tokenu -> DB) a sváž je se session.
      const credentialId = res.locals.credentialId as string;
      const creds = await store.get(credentialId);
      if (!creds) {
        return res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Údaje schránky nenalezeny — přidej connector znovu." },
          id: reqId,
        });
      }
      const service = createEmailService(creds);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) delete transports[transport!.sessionId];
      };
      const server = createMcpServer(service);
      await server.connect(transport);
    } else if (sessionId && !transport) {
      // Neznámá/expirovaná session → 404 = signál pro klienta poslat nový initialize.
      return res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session nenalezena nebo vypršela. Pošli prosím initialize." },
        id: reqId,
      });
    } else if (!transport) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Chybí platné Mcp-Session-Id (nejdřív pošli initialize)." },
        id: reqId,
      });
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Chyba při zpracování MCP požadavku:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Interní chyba serveru" }, id: null });
    }
  }
});

async function handleSession(req: express.Request, res: express.Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) {
    return res.status(sessionId ? 404 : 400).json({
      jsonrpc: "2.0",
      error: { code: sessionId ? -32001 : -32000, message: sessionId ? "Session nenalezena nebo vypršela." : "Chybí Mcp-Session-Id." },
      id: null,
    });
  }
  await transport.handleRequest(req, res);
}
app.get("/mcp", auth.requireAuth, handleSession);
app.delete("/mcp", auth.requireAuth, handleSession);

async function main() {
  await store.init();
  app.listen(config.PORT, () => {
    console.log(`email-mcp (online) běží na portu ${config.PORT} | úložiště: ${store.kind}`);
    console.log(`Veřejná adresa: ${online.publicUrl}`);
    console.log(`Connector URL do claude.ai: ${online.publicUrl}/mcp`);
    if (store.kind === "memory") {
      console.error("⚠️  DATABASE_URL není nastaveno → údaje schránek běží jen v paměti (po restartu zmizí). Přidej Postgres.");
    }
  });
}

main().catch((err) => {
  console.error("Fatální chyba při startu:", err);
  process.exit(1);
});

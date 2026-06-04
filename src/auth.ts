import { Router, type Request, type Response } from "express";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "node:crypto";

/**
 * Minimální OAuth 2.1 autorizační server pro jednoho vlastníka (single-tenant).
 *
 * - Přihlášení = jediné heslo OWNER_PASSWORD (ten, kdo si server nasadil).
 * - Tokeny jsou podepsané JWT (HS256) → server je STATELESS: nepotřebuje databázi
 *   a přežije restart/redeploy bez ztráty platnosti tokenů.
 * - Podporuje PKCE (S256) a Dynamic Client Registration (claude.ai se registruje sám).
 *
 * Endpointy (dle MCP authorization spec):
 *   GET  /.well-known/oauth-protected-resource
 *   GET  /.well-known/oauth-authorization-server
 *   POST /register
 *   GET  /authorize   (přihlašovací formulář)
 *   POST /authorize   (ověření hesla → vydání kódu)
 *   POST /token       (authorization_code i refresh_token)
 */

export interface AuthConfig {
  publicUrl: string; // bez koncového lomítka, např. https://email-mcp.up.railway.app
  ownerPassword: string;
  jwtSecret: string;
}

const SCOPE = "email";
const ACCESS_TTL = 3600; // 1 h
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30 dní
const CODE_TTL = 600; // 10 min

type TokenType = "access" | "refresh" | "code" | "client";

export function createAuth(cfg: AuthConfig) {
  const key = new TextEncoder().encode(cfg.jwtSecret);
  const prmPath = "/.well-known/oauth-protected-resource";

  async function sign(payload: JWTPayload, tt: TokenType, ttl?: number): Promise<string> {
    const builder = new SignJWT({ ...payload, tt })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(cfg.publicUrl)
      .setIssuedAt();
    if (ttl) builder.setExpirationTime(`${ttl}s`);
    return builder.sign(key);
  }

  async function verify(token: string, tt: TokenType): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, key, { issuer: cfg.publicUrl });
    if (payload.tt !== tt) throw new Error(`Špatný typ tokenu (čekal ${tt}).`);
    return payload;
  }

  const pkceS256 = (verifier: string) =>
    createHash("sha256").update(verifier).digest("base64url");

  // ── Klient (Dynamic Client Registration) — stateless: redirect_uris jsou zašité v client_id
  const makeClientId = (redirectUris: string[], name?: string) =>
    sign({ redirect_uris: redirectUris, client_name: name }, "client");
  const readClientId = async (clientId: string) => {
    const p = await verify(clientId, "client");
    return { redirectUris: (p.redirect_uris as string[]) ?? [], name: p.client_name as string };
  };

  const router = Router();

  // ── Discovery metadata ───────────────────────────────────────────────────────
  const prm = (_req: Request, res: Response) =>
    res.json({
      resource: `${cfg.publicUrl}/mcp`,
      authorization_servers: [cfg.publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    });
  router.get(prmPath, prm);
  router.get(`${prmPath}/mcp`, prm); // některé klienty ptají resource-specific cestu

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: cfg.publicUrl,
      authorization_endpoint: `${cfg.publicUrl}/authorize`,
      token_endpoint: `${cfg.publicUrl}/token`,
      registration_endpoint: `${cfg.publicUrl}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
    });
  });

  // ── Dynamic Client Registration ──────────────────────────────────────────────
  router.post("/register", async (req, res) => {
    const redirectUris: unknown = req.body?.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uris je povinné pole." });
    }
    const uris = redirectUris.map(String);
    const clientId = await makeClientId(uris, req.body?.client_name);
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      client_name: req.body?.client_name,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // ── Authorize (přihlašovací formulář) ────────────────────────────────────────
  router.get("/authorize", async (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const { redirectUris } = await readClientId(q.client_id);
      if (!redirectUris.includes(q.redirect_uri)) {
        return res.status(400).send(errorPage("Neplatné redirect_uri pro tohoto klienta."));
      }
      if (q.code_challenge_method !== "S256" || !q.code_challenge) {
        return res.status(400).send(errorPage("Vyžadováno PKCE (code_challenge_method=S256)."));
      }
      res.status(200).send(loginPage({ ...q, error: "" }));
    } catch {
      res.status(400).send(errorPage("Neplatný nebo neznámý client_id."));
    }
  });

  router.post("/authorize", async (req, res) => {
    try {
      const b = req.body as Record<string, string>;
      const { redirectUris } = await readClientId(b.client_id);
      if (!redirectUris.includes(b.redirect_uri)) {
        return res.status(400).send(errorPage("Neplatné redirect_uri pro tohoto klienta."));
      }
      if (b.password !== cfg.ownerPassword) {
        return res.status(401).send(loginPage({ ...b, error: "Špatné heslo." }));
      }
      const code = await sign(
        {
          client_id: b.client_id,
          redirect_uri: b.redirect_uri,
          code_challenge: b.code_challenge,
          scope: b.scope || SCOPE,
        },
        "code",
        CODE_TTL,
      );
      const url = new URL(b.redirect_uri);
      url.searchParams.set("code", code);
      if (b.state) url.searchParams.set("state", b.state);
      res.redirect(302, url.toString());
    } catch {
      res.status(400).send(errorPage("Autorizace selhala."));
    }
  });

  // ── Token endpoint ────────────────────────────────────────────────────────────
  router.post("/token", async (req, res) => {
    const b = req.body as Record<string, string>;
    try {
      if (b.grant_type === "authorization_code") {
        const code = await verify(b.code, "code");
        if (b.redirect_uri && code.redirect_uri !== b.redirect_uri) {
          return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri nesouhlasí." });
        }
        if (!b.code_verifier || pkceS256(b.code_verifier) !== code.code_challenge) {
          return res.status(400).json({ error: "invalid_grant", error_description: "PKCE ověření selhalo." });
        }
        return res.json(await issueTokens((code.scope as string) || SCOPE));
      }
      if (b.grant_type === "refresh_token") {
        const r = await verify(b.refresh_token, "refresh");
        return res.json(await issueTokens((r.scope as string) || SCOPE));
      }
      return res.status(400).json({ error: "unsupported_grant_type" });
    } catch {
      return res.status(400).json({ error: "invalid_grant", error_description: "Token je neplatný nebo vypršel." });
    }
  });

  async function issueTokens(scope: string) {
    const access_token = await sign({ sub: "owner", scope }, "access", ACCESS_TTL);
    const refresh_token = await sign({ sub: "owner", scope }, "refresh", REFRESH_TTL);
    return { access_token, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token, scope };
  }

  // ── Middleware: ochrana /mcp ─────────────────────────────────────────────────
  const challenge = `Bearer resource_metadata="${cfg.publicUrl}${prmPath}"`;
  async function requireOwner(req: Request, res: Response, next: () => void) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.setHeader("WWW-Authenticate", challenge);
      return res.status(401).json({ error: "unauthorized", error_description: "Chybí přístupový token." });
    }
    try {
      await verify(header.slice(7), "access");
      next();
    } catch {
      res.setHeader("WWW-Authenticate", `${challenge}, error="invalid_token"`);
      res.status(401).json({ error: "invalid_token", error_description: "Token je neplatný nebo vypršel." });
    }
  }

  return { router, requireOwner };
}

// ── HTML stránky ───────────────────────────────────────────────────────────────
function esc(s = ""): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function loginPage(q: Record<string, string>): string {
  const hidden = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`)
    .join("\n      ");
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Přihlášení k e-mailovému MCP</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}
  form{background:#1e293b;padding:2rem;border-radius:12px;width:min(92vw,360px);box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:1.1rem;margin:0 0 .25rem} p{color:#94a3b8;font-size:.85rem;margin:0 0 1.25rem}
  label{display:block;font-size:.8rem;margin:0 0 .35rem;color:#cbd5e1}
  input[type=password]{width:100%;padding:.7rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;box-sizing:border-box}
  button{width:100%;margin-top:1rem;padding:.7rem;border:0;border-radius:8px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#f87171;font-size:.8rem;margin-top:.6rem}
</style></head><body>
  <form method="post" action="/authorize">
    <h1>📧 E-mailový MCP</h1>
    <p>Přihlas se přístupovým heslem k tomuto serveru.</p>
    <label for="pw">Přístupové heslo serveru</label>
    <input id="pw" type="password" name="password" autocomplete="current-password" autofocus>
    ${q.error ? `<div class="err">${esc(q.error)}</div>` : ""}
    ${hidden}
    <button type="submit">Přihlásit a povolit</button>
  </form>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Chyba</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Chyba autorizace</h1><p>${esc(message)}</p></body></html>`;
}

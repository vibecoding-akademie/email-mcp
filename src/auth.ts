import { Router, type Request, type Response } from "express";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "node:crypto";
import type { CredentialStore } from "./store.js";
import type { MailboxCreds } from "./email-service.js";

/**
 * OAuth 2.1 autorizační server (multi-tenant).
 *
 * Při přidávání connectoru uživatel zadá údaje SVÉ schránky (IMAP/SMTP/e-mail/heslo).
 * Ty se uloží ŠIFROVANĚ do `store` a vrácený OAuth token nese jen jejich `credentialId`
 * (claim `sub`). Heslo tedy necestuje v tokenu — token jen odkazuje na záznam v DB.
 *
 * Stateless tokeny (JWT, HS256), PKCE (S256), Dynamic Client Registration.
 */
export interface AuthConfig {
  publicUrl: string;
  jwtSecret: string;
  store: CredentialStore;
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
    const b = new SignJWT({ ...payload, tt }).setProtectedHeader({ alg: "HS256" }).setIssuer(cfg.publicUrl).setIssuedAt();
    if (ttl) b.setExpirationTime(`${ttl}s`);
    return b.sign(key);
  }
  async function verify(token: string, tt: TokenType): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, key, { issuer: cfg.publicUrl });
    if (payload.tt !== tt) throw new Error(`Špatný typ tokenu (čekal ${tt}).`);
    return payload;
  }
  const pkceS256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

  const makeClientId = (redirectUris: string[], name?: string) =>
    sign({ redirect_uris: redirectUris, client_name: name }, "client");
  const readClientId = async (clientId: string) => {
    const p = await verify(clientId, "client");
    return { redirectUris: (p.redirect_uris as string[]) ?? [] };
  };

  const router = Router();

  // ── Discovery ────────────────────────────────────────────────────────────────
  const prm = (_req: Request, res: Response) =>
    res.json({
      resource: `${cfg.publicUrl}/mcp`,
      authorization_servers: [cfg.publicUrl],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ["header"],
    });
  router.get(prmPath, prm);
  router.get(`${prmPath}/mcp`, prm);

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

  // ── Dynamic Client Registration ───────────────────────────────────────────────
  router.post("/register", async (req, res) => {
    const redirectUris: unknown = req.body?.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return res.status(400).json({ error: "invalid_redirect_uri" });
    }
    const uris = redirectUris.map(String);
    res.status(201).json({
      client_id: await makeClientId(uris, req.body?.client_name),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // ── Authorize — formulář s údaji schránky ─────────────────────────────────────
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
      res.status(200).send(credsFormPage({ ...q, error: "" }));
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

      const missing = ["email", "password", "imap_host", "smtp_host"].filter((k) => !b[k]?.trim());
      if (missing.length > 0) {
        return res.status(400).send(credsFormPage({ ...b, error: `Vyplň prosím: ${missing.join(", ")}.` }));
      }

      const imapPort = Number(b.imap_port) || 993;
      const smtpPort = Number(b.smtp_port) || 465;
      const creds: MailboxCreds = {
        user: b.email.trim(),
        password: b.password,
        imapHost: b.imap_host.trim(),
        imapPort,
        imapSecure: imapPort === 993,
        smtpHost: b.smtp_host.trim(),
        smtpPort,
        smtpSecure: smtpPort === 465,
        fromName: b.from_name?.trim() || undefined,
      };
      const credentialId = await cfg.store.save(creds);

      const code = await sign(
        { client_id: b.client_id, redirect_uri: b.redirect_uri, code_challenge: b.code_challenge, scope: b.scope || SCOPE, sub: credentialId },
        "code",
        CODE_TTL,
      );
      const url = new URL(b.redirect_uri);
      url.searchParams.set("code", code);
      if (b.state) url.searchParams.set("state", b.state);
      res.redirect(302, url.toString());
    } catch (e) {
      console.error("[auth] /authorize selhalo:", e instanceof Error ? e.message : e);
      res.status(400).send(errorPage("Uložení údajů selhalo. Zkus to prosím znovu."));
    }
  });

  // ── Token ──────────────────────────────────────────────────────────────────────
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
        return res.json(await issueTokens(String(code.sub), (code.scope as string) || SCOPE));
      }
      if (b.grant_type === "refresh_token") {
        const r = await verify(b.refresh_token, "refresh");
        return res.json(await issueTokens(String(r.sub), (r.scope as string) || SCOPE));
      }
      return res.status(400).json({ error: "unsupported_grant_type" });
    } catch {
      return res.status(400).json({ error: "invalid_grant", error_description: "Token je neplatný nebo vypršel." });
    }
  });

  async function issueTokens(sub: string, scope: string) {
    return {
      access_token: await sign({ sub, scope }, "access", ACCESS_TTL),
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      refresh_token: await sign({ sub, scope }, "refresh", REFRESH_TTL),
      scope,
    };
  }

  // ── Middleware: ochrana /mcp ───────────────────────────────────────────────────
  const challenge = `Bearer resource_metadata="${cfg.publicUrl}${prmPath}"`;
  async function requireAuth(req: Request, res: Response, next: () => void) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      console.error("[auth] 401 — chybí Bearer token");
      res.setHeader("WWW-Authenticate", challenge);
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const payload = await verify(header.slice(7), "access");
      res.locals.credentialId = String(payload.sub);
      next();
    } catch (e) {
      console.error("[auth] 401 — neplatný/expirovaný token:", e instanceof Error ? e.message : e);
      res.setHeader("WWW-Authenticate", `${challenge}, error="invalid_token"`);
      res.status(401).json({ error: "invalid_token" });
    }
  }

  return { router, requireAuth };
}

// ── HTML ─────────────────────────────────────────────────────────────────────
function esc(s = ""): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function credsFormPage(q: Record<string, string>): string {
  const hidden = ["client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`)
    .join("");
  const field = (name: string, label: string, type = "text", value = "", ph = "") =>
    `<label>${label}<input type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(ph)}" ${type === "password" ? "" : "autocapitalize=off autocorrect=off"}></label>`;
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Připojení schránky</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}
  form{background:#1e293b;padding:1.75rem;border-radius:12px;width:min(94vw,420px);box-shadow:0 10px 40px rgba(0,0,0,.4)}
  h1{font-size:1.1rem;margin:0 0 .25rem} p.sub{color:#94a3b8;font-size:.82rem;margin:0 0 1.1rem}
  label{display:block;font-size:.78rem;color:#cbd5e1;margin:.55rem 0 0}
  input{width:100%;padding:.6rem;margin-top:.25rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;box-sizing:border-box}
  .row{display:flex;gap:.5rem}.row>label{flex:1}
  button{width:100%;margin-top:1.1rem;padding:.7rem;border:0;border-radius:8px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#f87171;font-size:.8rem;margin-top:.6rem}.hint{color:#64748b;font-size:.72rem;margin-top:.9rem;line-height:1.4}
</style></head><body>
  <form method="post" action="/authorize">
    <h1>📧 Připojení e-mailové schránky</h1>
    <p class="sub">Zadej údaje své schránky. Uloží se <b>šifrovaně</b> a použijí se jen pro přístup k tvé poště.</p>
    ${field("email", "E-mailová adresa (= přihlašovací jméno)", "text", q.email, "jmeno@domena.cz")}
    ${field("password", "Heslo ke schránce (ideálně heslo pro aplikace)", "password")}
    <div class="row">
      ${field("imap_host", "IMAP server", "text", q.imap_host, "imap.seznam.cz")}
      ${field("imap_port", "Port", "text", q.imap_port || "993")}
    </div>
    <div class="row">
      ${field("smtp_host", "SMTP server", "text", q.smtp_host, "smtp.seznam.cz")}
      ${field("smtp_port", "Port", "text", q.smtp_port || "465")}
    </div>
    ${q.error ? `<div class="err">${esc(q.error)}</div>` : ""}
    ${hidden}
    <button type="submit">Připojit schránku</button>
    <p class="hint">Seznam: imap.seznam.cz / smtp.seznam.cz · Webglobe: mail.webglobe.cz · Gmail: imap.gmail.com / smtp.gmail.com (App Password). SMTP port 465 = SSL, 587 = STARTTLS.</p>
  </form>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Chyba</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Chyba autorizace</h1><p>${esc(message)}</p></body></html>`;
}

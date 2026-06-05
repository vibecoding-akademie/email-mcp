import { config as loadEnv } from "dotenv";
import { z } from "zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MailboxCreds } from "./email-service.js";

// Načteme .env.local z aktuálního adresáře i z kořene balíčku (ať to funguje
// bez ohledu na to, odkud MCP klient server spustí). dotenv NEpřepisuje už
// nastavené proměnné, takže env předané MCP klientem má vždy přednost.
// quiet: true — dotenv v17 jinak vypisuje "tipy" na stdout, což by rozbilo
// stdio MCP protokol (stdout je vyhrazen pro JSON-RPC).
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: resolve(here, "..", ".env.local"), quiet: true });
loadEnv({ quiet: true }); // .env jako poslední fallback

/** Bezpečné parsování boolean z env (z.coerce.boolean() bere "false" jako true). */
const boolish = (def: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === "") return def;
    if (typeof v === "boolean") return v;
    return ["1", "true", "yes", "y", "on"].includes(String(v).trim().toLowerCase());
  }, z.boolean());

const EnvSchema = z.object({
  // V online (multi-tenant) režimu jsou údaje per-uživatel z DB → tady volitelné.
  // Pro stdio (lokální) režim jsou povinné — kontroluje credsFromEnv().
  EMAIL_USER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_FROM_NAME: z.string().optional(),

  IMAP_HOST: z.string().min(1).default("mail.webglobe.cz"),
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_SECURE: boolish(true),

  SMTP_HOST: z.string().min(1).default("mail.webglobe.cz"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: boolish(true),

  DRAFTS_FOLDER: z.string().optional(),
  SENT_FOLDER: z.string().optional(),

  TLS_REJECT_UNAUTHORIZED: boolish(true),

  // ── Pouze pro online (HTTP) režim — viz http.ts ──────────────────────────────
  PORT: z.coerce.number().int().positive().default(3000),
  // Veřejná HTTPS adresa serveru (např. https://email-mcp.up.railway.app).
  // Na Railway se automaticky odvodí z RAILWAY_PUBLIC_DOMAIN, pokud není zadána.
  PUBLIC_URL: z.string().optional(),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional(),
  // Heslo, kterým se přihlásíš při napojování connectoru (OAuth login) — nepovinné.
  OWNER_PASSWORD: z.string().optional(),
  // Tajný klíč pro podepisování OAuth tokenů (libovolný dlouhý náhodný řetězec).
  JWT_SECRET: z.string().optional(),
  // Postgres (Railway) pro uložení šifrovaných údajů schránek (online multi-tenant).
  DATABASE_URL: z.string().optional(),
  // Klíč pro šifrování údajů schránek v DB (32 bajtů; hex/base64 nebo delší heslo).
  ENCRYPTION_KEY: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema>;

function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    // POZOR: vše musí jít na stderr — stdout je vyhrazen pro MCP protokol.
    console.error(
      "❌ Chybná konfigurace e-mailu. Zkontroluj .env.local (viz .env.example):\n" + issues,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();

/** Sestaví údaje schránky z env (pro lokální stdio režim). Vyžaduje EMAIL_USER/PASSWORD. */
export function credsFromEnv(): MailboxCreds {
  if (!config.EMAIL_USER || !config.EMAIL_PASSWORD) {
    console.error(
      "❌ Lokální (stdio) režim vyžaduje EMAIL_USER a EMAIL_PASSWORD v .env.local (viz .env.example).",
    );
    process.exit(1);
  }
  return {
    imapHost: config.IMAP_HOST,
    imapPort: config.IMAP_PORT,
    imapSecure: config.IMAP_SECURE,
    smtpHost: config.SMTP_HOST,
    smtpPort: config.SMTP_PORT,
    smtpSecure: config.SMTP_SECURE,
    user: config.EMAIL_USER,
    password: config.EMAIL_PASSWORD,
    fromName: config.EMAIL_FROM_NAME,
    draftsFolder: config.DRAFTS_FOLDER,
    sentFolder: config.SENT_FOLDER,
    tlsRejectUnauthorized: config.TLS_REJECT_UNAUTHORIZED,
  };
}

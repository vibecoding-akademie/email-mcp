import { randomUUID } from "node:crypto";
import pg from "pg";
import type { MailboxCreds } from "./email-service.js";

/** Úložiště (šifrovaných) přihlašovacích údajů schránek. */
export interface CredentialStore {
  init(): Promise<void>;
  /** Uloží údaje, vrátí jejich id (jde do OAuth tokenu jako `sub`). */
  save(creds: MailboxCreds): Promise<string>;
  get(id: string): Promise<MailboxCreds | null>;
  kind: "postgres" | "memory";
}

interface CryptoPair {
  encrypt: (s: string) => string;
  decrypt: (s: string) => string;
}

/** Postgres úložiště — údaje uložené ŠIFROVANĚ (sloupec `data`). */
function createPostgresStore(databaseUrl: string, crypto: CryptoPair): CredentialStore {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Interní Railway spojení (…railway.internal) SSL nepotřebuje; veřejné ano.
    ssl: databaseUrl.includes(".railway.internal") ? false : { rejectUnauthorized: false },
    max: 4,
  });

  return {
    kind: "postgres",
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mailbox_credentials (
          id UUID PRIMARY KEY,
          label TEXT,
          data TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
    },
    async save(creds) {
      const id = randomUUID();
      const data = crypto.encrypt(JSON.stringify(creds));
      await pool.query("INSERT INTO mailbox_credentials (id, label, data) VALUES ($1, $2, $3)", [
        id,
        creds.user,
        data,
      ]);
      return id;
    },
    async get(id) {
      const res = await pool.query<{ data: string }>(
        "SELECT data FROM mailbox_credentials WHERE id = $1",
        [id],
      );
      if (res.rows.length === 0) return null;
      return JSON.parse(crypto.decrypt(res.rows[0].data)) as MailboxCreds;
    },
  };
}

/** Záložní úložiště v paměti — pro lokální vývoj/test bez Postgresu (po restartu zmizí). */
function createMemoryStore(crypto: CryptoPair): CredentialStore {
  const map = new Map<string, string>();
  return {
    kind: "memory",
    async init() {},
    async save(creds) {
      const id = randomUUID();
      map.set(id, crypto.encrypt(JSON.stringify(creds)));
      return id;
    },
    async get(id) {
      const data = map.get(id);
      return data ? (JSON.parse(crypto.decrypt(data)) as MailboxCreds) : null;
    },
  };
}

export function createStore(opts: { databaseUrl?: string; crypto: CryptoPair }): CredentialStore {
  return opts.databaseUrl
    ? createPostgresStore(opts.databaseUrl, opts.crypto)
    : createMemoryStore(opts.crypto);
}

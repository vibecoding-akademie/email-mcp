import { ImapFlow, type ListResponse } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import {
  formatAddresses,
  parseDateInput,
  quoteOriginal,
  replySubject,
  structureHasAttachment,
  type EnvelopeAddress,
} from "./util.js";

/** Přihlašovací údaje k jedné schránce (z env pro stdio, nebo z DB pro online). */
export interface MailboxCreds {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
  fromName?: string;
  draftsFolder?: string;
  sentFolder?: string;
  tlsRejectUnauthorized?: boolean;
}

// ── Typy výsledků ────────────────────────────────────────────────────────────

export interface FolderInfo {
  path: string;
  name: string;
  specialUse?: string;
  subscribed?: boolean;
}

export interface ListEmailsFilter {
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  search?: string;
  since?: string;
  before?: string;
  unreadOnly?: boolean;
  limit?: number;
  page?: number;
}

export interface EmailSummary {
  uid: number;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string | null;
  unread: boolean;
  hasAttachment: boolean;
  flags: string[];
  sizeBytes: number | null;
}

export interface ListEmailsResult {
  folder: string;
  total: number;
  page: number;
  pageSize: number;
  returned: number;
  items: EmailSummary[];
}

export interface EmailDetail {
  uid: number;
  folder: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string | null;
  messageId?: string;
  inReplyTo?: string;
  text?: string;
  html?: string;
  attachments: { filename?: string; contentType?: string; sizeBytes?: number }[];
}

export interface DraftInput {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text?: string;
  html?: string;
}

export interface DraftResult {
  saved: boolean;
  folder: string;
  uid?: number;
}

export interface DraftReplyInput {
  folder: string;
  uid: number;
  text?: string;
  html?: string;
  replyAll?: boolean;
  quoteOriginal?: boolean;
}

export interface SendInput {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  saveToSent?: boolean;
}

export interface SendResult {
  messageId?: string;
  accepted: string[];
  rejected: string[];
  savedToSent: boolean;
}

export interface EmailService {
  listFolders(): Promise<FolderInfo[]>;
  listEmails(filter: ListEmailsFilter): Promise<ListEmailsResult>;
  getEmail(
    folder: string,
    uid: number,
    opts?: { format?: "text" | "html" | "both"; markSeen?: boolean },
  ): Promise<EmailDetail>;
  createDraft(input: DraftInput): Promise<DraftResult>;
  draftReply(input: DraftReplyInput): Promise<DraftResult>;
  sendEmail(input: SendInput): Promise<SendResult>;
}

// ── Sdílené (na údajích nezávislé) ───────────────────────────────────────────

/** Přenos, který zprávu jen sestaví do RFC822 bufferu (pro APPEND do složek). */
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "crlf" });

/** Bezpečně převede datum (Date i string) na ISO řetězec. */
function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
}

/**
 * Najde cestu ke speciální složce (Drafts/Sent) — nejdřív IMAP SPECIAL-USE,
 * pak env/uživatelský override, nakonec běžné názvy.
 */
async function resolveSpecialFolder(
  client: ImapFlow,
  specialUse: "\\Drafts" | "\\Sent",
  override: string | undefined,
  candidates: string[],
): Promise<string> {
  const list = await client.list();
  const bySpecial = list.find((f) => f.specialUse === specialUse);
  if (bySpecial) return bySpecial.path;
  if (override) return override;
  const byName = list.find((f) => candidates.some((c) => f.path.toLowerCase() === c.toLowerCase()));
  if (byName) return byName.path;
  return candidates[0];
}

// ── Továrna na službu pro konkrétní schránku ─────────────────────────────────

/** Vytvoří e-mailovou službu vázanou na konkrétní přihlašovací údaje. */
export function createEmailService(creds: MailboxCreds): EmailService {
  const tlsReject = creds.tlsRejectUnauthorized ?? true;

  const smtp = nodemailer.createTransport({
    host: creds.smtpHost,
    port: creds.smtpPort,
    secure: creds.smtpSecure,
    auth: { user: creds.user, pass: creds.password },
    tls: { rejectUnauthorized: tlsReject },
  });

  const fromAddress = () =>
    creds.fromName ? { name: creds.fromName, address: creds.user } : creds.user;

  async function buildRawMessage(input: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string | string[];
  }): Promise<Buffer> {
    const info = await composer.sendMail({ from: fromAddress(), ...input });
    return info.message as Buffer;
  }

  function imapErrorMessage(err: unknown): string {
    const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
    const where = `${creds.imapHost}:${creds.imapPort}, uživatel ${creds.user}`;
    if (e?.authenticationFailed || /auth/i.test(e?.responseText || "")) {
      return `Přihlášení k IMAP selhalo — špatné jméno/heslo, nebo má účet zakázaný IMAP přístup (${where}).`;
    }
    if (e?.code === "ETIMEOUT" || /timeout/i.test(e?.message || "")) {
      return `IMAP spojení vypršelo (timeout). Zkontroluj IMAP server/port (${creds.imapHost}:${creds.imapPort}).`;
    }
    if (e?.code === "ENOTFOUND" || e?.code === "EAI_AGAIN") {
      return `IMAP server nenalezen: "${creds.imapHost}".`;
    }
    if (e?.code === "ECONNREFUSED") {
      return `IMAP odmítl spojení na ${creds.imapHost}:${creds.imapPort}.`;
    }
    return `Chyba IMAP: ${e?.responseText || e?.message || String(err)}`;
  }

  async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: creds.imapHost,
      port: creds.imapPort,
      secure: creds.imapSecure,
      auth: { user: creds.user, pass: creds.password },
      logger: false,
      tls: { rejectUnauthorized: tlsReject },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    // KRITICKÉ: neodchycený 'error' event (např. socket timeout) by shodil celý server.
    client.on("error", (err) => console.error("[imap] error event:", (err as Error)?.message || err));
    try {
      await client.connect();
    } catch (err) {
      throw new Error(imapErrorMessage(err));
    }
    try {
      return await fn(client);
    } catch (err) {
      throw new Error(imapErrorMessage(err));
    } finally {
      await client.logout().catch(() => {});
    }
  }

  const draftsCandidates = ["Drafts", "INBOX.Drafts", "Koncepty"];
  const sentCandidates = ["Sent", "INBOX.Sent", "Odeslaná pošta", "Odeslané"];

  return {
    async listFolders() {
      return withClient(async (client) => {
        const list: ListResponse[] = await client.list();
        return list.map((f) => ({
          path: f.path,
          name: f.name,
          specialUse: f.specialUse,
          subscribed: f.subscribed,
        }));
      });
    },

    async listEmails(filter) {
      const folder = filter.folder || "INBOX";
      const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
      const page = Math.max(filter.page ?? 1, 1);

      return withClient(async (client) => {
        await client.mailboxOpen(folder, { readOnly: true });

        const query: Record<string, unknown> = {};
        if (filter.from) query.from = filter.from;
        if (filter.to) query.to = filter.to;
        if (filter.subject) query.subject = filter.subject;
        if (filter.search) query.body = filter.search;
        if (filter.unreadOnly) query.seen = false;
        if (filter.since) query.since = parseDateInput(filter.since);
        if (filter.before) query.before = parseDateInput(filter.before);

        const uids = (await client.search(query, { uid: true })) || [];
        const total = uids.length;
        if (total === 0) return { folder, total, page, pageSize: limit, returned: 0, items: [] };

        uids.sort((a, b) => b - a);
        const pageUids = uids.slice((page - 1) * limit, (page - 1) * limit + limit);

        const byUid = new Map<number, EmailSummary>();
        if (pageUids.length > 0) {
          for await (const msg of client.fetch(
            pageUids.join(","),
            { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true, size: true },
            { uid: true },
          )) {
            const flags = msg.flags ? [...msg.flags] : [];
            const env = msg.envelope;
            byUid.set(msg.uid, {
              uid: msg.uid,
              folder,
              from: formatAddresses(env?.from as EnvelopeAddress[] | undefined),
              to: formatAddresses(env?.to as EnvelopeAddress[] | undefined),
              subject: env?.subject || "(bez předmětu)",
              date: toIso(env?.date ?? msg.internalDate),
              unread: !flags.includes("\\Seen"),
              hasAttachment: structureHasAttachment(msg.bodyStructure),
              flags,
              sizeBytes: msg.size ?? null,
            });
          }
        }

        const items = pageUids.map((u) => byUid.get(u)).filter((x): x is EmailSummary => Boolean(x));
        return { folder, total, page, pageSize: limit, returned: items.length, items };
      });
    },

    async getEmail(folder, uid, opts = {}) {
      const format = opts.format ?? "text";
      return withClient(async (client) => {
        await client.mailboxOpen(folder, { readOnly: !opts.markSeen });
        const msg = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) throw new Error(`E-mail s UID ${uid} ve složce "${folder}" nenalezen.`);
        if (opts.markSeen) {
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
        }

        const parsed = await simpleParser(msg.source);
        const html = format === "text" ? undefined : typeof parsed.html === "string" ? parsed.html : undefined;
        const text = format === "html" ? undefined : parsed.text;

        return {
          uid,
          folder,
          from: parsed.from?.text ?? "",
          to: Array.isArray(parsed.to) ? parsed.to.map((a) => a.text).join(", ") : parsed.to?.text ?? "",
          cc: Array.isArray(parsed.cc) ? parsed.cc.map((a) => a.text).join(", ") : parsed.cc?.text ?? "",
          subject: parsed.subject ?? "",
          date: toIso(parsed.date),
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          text,
          html,
          attachments: (parsed.attachments ?? []).map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            sizeBytes: a.size,
          })),
        };
      });
    },

    async createDraft(input) {
      return withClient(async (client) => {
        const draftsPath = await resolveSpecialFolder(client, "\\Drafts", creds.draftsFolder, draftsCandidates);
        const raw = await buildRawMessage(input);
        const res = await client.append(draftsPath, raw, ["\\Draft"], new Date());
        return { saved: true, folder: draftsPath, uid: res ? res.uid : undefined };
      });
    },

    async draftReply(input) {
      return withClient(async (client) => {
        await client.mailboxOpen(input.folder, { readOnly: true });
        const orig = await client.fetchOne(String(input.uid), { uid: true, source: true, envelope: true }, { uid: true });
        if (!orig || !orig.source) {
          throw new Error(`Původní e-mail s UID ${input.uid} ve složce "${input.folder}" nenalezen.`);
        }
        const parsed = await simpleParser(orig.source);

        const fromText = parsed.from?.text ?? "";
        const fromAddr = parsed.from?.value?.[0]?.address;
        const me = creds.user.toLowerCase();

        const toList = fromAddr ? [fromAddr] : [];
        let ccList: string[] = [];
        if (input.replyAll) {
          const origTo = Array.isArray(parsed.to) ? parsed.to.flatMap((x) => x.value) : parsed.to?.value ?? [];
          const origCc = Array.isArray(parsed.cc) ? parsed.cc.flatMap((x) => x.value) : parsed.cc?.value ?? [];
          ccList = [...new Set(
            [...origTo, ...origCc]
              .map((a) => a.address)
              .filter(
                (a): a is string =>
                  typeof a === "string" && a.toLowerCase() !== me && a.toLowerCase() !== fromAddr?.toLowerCase(),
              ),
          )];
        }

        const messageId = parsed.messageId;
        const refs = (() => {
          const prev = Array.isArray(parsed.references) ? parsed.references.join(" ") : parsed.references ?? "";
          return [prev, messageId].filter(Boolean).join(" ").trim() || undefined;
        })();

        const quote =
          input.quoteOriginal === false ? "" : quoteOriginal({ fromText, date: parsed.date, body: parsed.text });

        const draftsPath = await resolveSpecialFolder(client, "\\Drafts", creds.draftsFolder, draftsCandidates);
        const raw = await buildRawMessage({
          to: toList.join(", "),
          cc: ccList.join(", ") || undefined,
          subject: replySubject(parsed.subject),
          text: `${input.text ?? ""}${quote}`,
          html: input.html,
          inReplyTo: messageId,
          references: refs,
        });
        const res = await client.append(draftsPath, raw, ["\\Draft"], new Date());
        return { saved: true, folder: draftsPath, uid: res ? res.uid : undefined };
      });
    },

    async sendEmail(input) {
      const info = await smtp.sendMail({
        from: fromAddress(),
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      let savedToSent = false;
      if (input.saveToSent !== false) {
        try {
          await withClient(async (client) => {
            const sentPath = await resolveSpecialFolder(client, "\\Sent", creds.sentFolder, sentCandidates);
            const raw = await buildRawMessage({
              to: input.to,
              cc: input.cc,
              bcc: input.bcc,
              subject: input.subject,
              text: input.text,
              html: input.html,
            });
            await client.append(sentPath, raw, ["\\Seen"], new Date());
          });
          savedToSent = true;
        } catch {
          savedToSent = false;
        }
      }

      return {
        messageId: info.messageId,
        accepted: (info.accepted ?? []).map(String),
        rejected: (info.rejected ?? []).map(String),
        savedToSent,
      };
    },
  };
}

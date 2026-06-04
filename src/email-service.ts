import { ImapFlow, type ListResponse } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import {
  formatAddresses,
  parseDateInput,
  quoteOriginal,
  replySubject,
  structureHasAttachment,
  type EnvelopeAddress,
} from "./util.js";

// ── Sdílené odesílací nástroje ───────────────────────────────────────────────

/** Reálný SMTP přenos (odesílání pošty ven). */
const smtp = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: { user: config.EMAIL_USER, pass: config.EMAIL_PASSWORD },
  tls: { rejectUnauthorized: config.TLS_REJECT_UNAUTHORIZED },
});

/** Přenos, který zprávu jen sestaví do RFC822 bufferu (pro APPEND do složek). */
const composer = nodemailer.createTransport({
  streamTransport: true,
  buffer: true,
  newline: "crlf",
});

/** Bezpečně převede datum (Date i string) na ISO řetězec. */
function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d.toISOString();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
}

/** Odesílatel ve tvaru, který Nodemailer očekává. */
function fromAddress() {
  return config.EMAIL_FROM_NAME
    ? { name: config.EMAIL_FROM_NAME, address: config.EMAIL_USER }
    : config.EMAIL_USER;
}

interface ComposeInput {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string | string[];
}

/** Sestaví surovou MIME zprávu (Buffer) z parametrů. */
async function buildRawMessage(input: ComposeInput): Promise<Buffer> {
  const info = await composer.sendMail({
    from: fromAddress(),
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo,
    references: input.references,
  });
  // streamTransport + buffer:true => info.message je Buffer
  return info.message as Buffer;
}

// ── IMAP připojení (na operaci) ──────────────────────────────────────────────

/** Otevře IMAP spojení, spustí callback a spolehlivě se odhlásí. */
async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    secure: config.IMAP_SECURE,
    auth: { user: config.EMAIL_USER, pass: config.EMAIL_PASSWORD },
    logger: false,
    tls: { rejectUnauthorized: config.TLS_REJECT_UNAUTHORIZED },
    // Rychlé selhání při špatném serveru/heslu (jinak by spojení viselo a klient by to utnul).
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {
      /* spojení nemusí jít korektně zavřít — to nevadí */
    });
  }
}

/**
 * Najde cestu ke speciální složce (Drafts/Sent) — nejdřív podle IMAP příznaku
 * SPECIAL-USE, pak podle env override, nakonec podle běžných názvů.
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
  const byName = list.find((f) =>
    candidates.some((c) => f.path.toLowerCase() === c.toLowerCase()),
  );
  if (byName) return byName.path;
  // Poslední záchrana — vrátíme první kandidát; APPEND ho případně vytvoří.
  return candidates[0];
}

// ── Veřejné operace ──────────────────────────────────────────────────────────

export interface FolderInfo {
  path: string;
  name: string;
  specialUse?: string;
  subscribed?: boolean;
}

/** Vypíše složky (mailboxy) na účtu. */
export async function listFolders(): Promise<FolderInfo[]> {
  return withClient(async (client) => {
    const list: ListResponse[] = await client.list();
    return list.map((f) => ({
      path: f.path,
      name: f.name,
      specialUse: f.specialUse,
      subscribed: f.subscribed,
    }));
  });
}

export interface ListEmailsFilter {
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  search?: string; // fulltext v těle
  since?: string; // ISO nebo relativní (7d, 2h)
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

/** Vypíše e-maily ze složky podle filtrů (řazeno od nejnovějších). */
export async function listEmails(filter: ListEmailsFilter): Promise<ListEmailsResult> {
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
    if (total === 0) {
      return { folder, total, page, pageSize: limit, returned: 0, items: [] };
    }

    uids.sort((a, b) => b - a); // nejnovější první (UID roste s časem)
    const start = (page - 1) * limit;
    const pageUids = uids.slice(start, start + limit);

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

/** Načte celý e-mail (tělo + přílohy) podle UID. Ve výchozím stavu složku NEoznačí jako přečtenou. */
export async function getEmail(
  folder: string,
  uid: number,
  opts: { format?: "text" | "html" | "both"; markSeen?: boolean } = {},
): Promise<EmailDetail> {
  const format = opts.format ?? "text";
  return withClient(async (client) => {
    await client.mailboxOpen(folder, { readOnly: !opts.markSeen });
    const msg = await client.fetchOne(
      String(uid),
      { uid: true, source: true, envelope: true },
      { uid: true },
    );
    if (!msg || !msg.source) {
      throw new Error(`E-mail s UID ${uid} ve složce "${folder}" nenalezen.`);
    }
    if (opts.markSeen) {
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
    }

    const parsed = await simpleParser(msg.source);
    const html =
      format === "text" ? undefined : typeof parsed.html === "string" ? parsed.html : undefined;
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

/** Vytvoří nový draft a uloží ho do složky Koncepty (Drafts) na serveru. */
export async function createDraft(input: DraftInput): Promise<DraftResult> {
  return withClient(async (client) => {
    const draftsPath = await resolveSpecialFolder(client, "\\Drafts", config.DRAFTS_FOLDER, [
      "Drafts",
      "INBOX.Drafts",
      "Koncepty",
    ]);
    const raw = await buildRawMessage(input);
    const res = await client.append(draftsPath, raw, ["\\Draft"], new Date());
    return { saved: true, folder: draftsPath, uid: res ? res.uid : undefined };
  });
}

export interface DraftReplyInput {
  folder: string;
  uid: number;
  text?: string;
  html?: string;
  replyAll?: boolean;
  quoteOriginal?: boolean;
}

/** Připraví draft ODPOVĚDI na existující e-mail (správné vlákno + citace) a uloží do Konceptů. */
export async function draftReply(input: DraftReplyInput): Promise<DraftResult> {
  return withClient(async (client) => {
    await client.mailboxOpen(input.folder, { readOnly: true });
    const orig = await client.fetchOne(
      String(input.uid),
      { uid: true, source: true, envelope: true },
      { uid: true },
    );
    if (!orig || !orig.source) {
      throw new Error(`Původní e-mail s UID ${input.uid} ve složce "${input.folder}" nenalezen.`);
    }
    const parsed = await simpleParser(orig.source);

    const fromText = parsed.from?.text ?? "";
    const fromAddr = parsed.from?.value?.[0]?.address;
    const me = config.EMAIL_USER.toLowerCase();

    // Příjemci
    const toList = fromAddr ? [fromAddr] : [];
    let ccList: string[] = [];
    if (input.replyAll) {
      const origTo = Array.isArray(parsed.to) ? parsed.to.flatMap((x) => x.value) : parsed.to?.value ?? [];
      const origCc = Array.isArray(parsed.cc) ? parsed.cc.flatMap((x) => x.value) : parsed.cc?.value ?? [];
      ccList = [...origTo, ...origCc]
        .map((a) => a.address)
        .filter(
          (a): a is string =>
            typeof a === "string" &&
            a.toLowerCase() !== me &&
            a.toLowerCase() !== fromAddr?.toLowerCase(),
        );
      ccList = [...new Set(ccList)];
    }

    // Vlákno
    const messageId = parsed.messageId;
    const refs = (() => {
      const prev = Array.isArray(parsed.references)
        ? parsed.references.join(" ")
        : parsed.references ?? "";
      return [prev, messageId].filter(Boolean).join(" ").trim() || undefined;
    })();

    // Tělo + citace
    const quote =
      input.quoteOriginal === false
        ? ""
        : quoteOriginal({ fromText, date: parsed.date, body: parsed.text });
    const text = `${input.text ?? ""}${quote}`;

    const draftsPath = await resolveSpecialFolder(client, "\\Drafts", config.DRAFTS_FOLDER, [
      "Drafts",
      "INBOX.Drafts",
      "Koncepty",
    ]);
    const raw = await buildRawMessage({
      to: toList.join(", "),
      cc: ccList.join(", ") || undefined,
      subject: replySubject(parsed.subject),
      text,
      html: input.html,
      inReplyTo: messageId,
      references: refs,
    });
    const res = await client.append(draftsPath, raw, ["\\Draft"], new Date());
    return { saved: true, folder: draftsPath, uid: res ? res.uid : undefined };
  });
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

/** Odešle e-mail přes SMTP. Volitelně uloží kopii do složky Odeslané. */
export async function sendEmail(input: SendInput): Promise<SendResult> {
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
        const sentPath = await resolveSpecialFolder(client, "\\Sent", config.SENT_FOLDER, [
          "Sent",
          "INBOX.Sent",
          "Odeslaná pošta",
          "Odeslané",
        ]);
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
      // Uložení do Odeslané je „nice to have" — když selže, e-mail je i tak odeslán.
      savedToSent = false;
    }
  }

  return {
    messageId: info.messageId,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
    savedToSent,
  };
}

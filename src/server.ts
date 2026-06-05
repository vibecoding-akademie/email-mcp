import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { EmailService } from "./email-service.js";

/** Zabalí výsledek do MCP textové odpovědi jako čitelný JSON. */
function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Spustí handler a chyby vrátí jako MCP isError (server nikdy nespadne kvůli toolu). */
async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tool error]", message); // do Railway logů (stderr)
    return { content: [{ type: "text", text: `Chyba: ${message}` }], isError: true };
  }
}

/**
 * Vytvoří MCP server se všemi e-mailovými nástroji nad konkrétní schránkou.
 * Službu (a tím i přihlašovací údaje) dostane zvenčí: stdio (index.ts) z env,
 * online (http.ts) z údajů konkrétního uživatele uložených v DB.
 */
export function createMcpServer(email: EmailService): McpServer {
  const server = new McpServer({ name: "email-mcp", version: "0.1.0" });

  // ── list_folders ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_folders",
    {
      title: "Vypsat složky",
      description:
        "Vypíše složky (mailboxy) na e-mailovém účtu — INBOX, Odeslané, Koncepty, Koš apod. " +
        "Užitečné pro zjištění, z jaké složky číst nebo kam se ukládají drafty.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(async () => json(await email.listFolders())),
  );

  // ── list_emails ────────────────────────────────────────────────────────────
  server.registerTool(
    "list_emails",
    {
      title: "Vypsat e-maily",
      description:
        "Vypíše e-maily ze složky podle filtrů (řazeno od nejnovějších). Vrací souhrny " +
        "(odesílatel, předmět, datum, zda je nepřečtený, zda má přílohu, UID). " +
        "Pro celé tělo konkrétního e-mailu použij get_email s jeho UID.",
      inputSchema: {
        folder: z.string().optional().describe("Složka, výchozí 'INBOX'."),
        from: z.string().optional().describe("Filtr odesílatele (část adresy/jména)."),
        to: z.string().optional().describe("Filtr příjemce."),
        subject: z.string().optional().describe("Filtr předmětu (část textu)."),
        search: z.string().optional().describe("Fulltext hledaný v těle zprávy."),
        since: z.string().optional().describe("Od data — ISO (2026-06-01) nebo relativně (7d, 2h, 30m)."),
        before: z.string().optional().describe("Do data — ISO nebo relativně."),
        unreadOnly: z.boolean().optional().describe("Jen nepřečtené."),
        limit: z.number().int().min(1).max(100).optional().describe("Počet na stránku (1–100, výchozí 25)."),
        page: z.number().int().min(1).optional().describe("Číslo stránky (výchozí 1)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => run(async () => json(await email.listEmails(args))),
  );

  // ── get_email ──────────────────────────────────────────────────────────────
  server.registerTool(
    "get_email",
    {
      title: "Načíst e-mail",
      description:
        "Načte celý e-mail podle UID a složky — tělo (text/HTML), hlavičky a seznam příloh. " +
        "Ve výchozím stavu e-mail NEoznačí jako přečtený.",
      inputSchema: {
        uid: z.number().int().describe("UID e-mailu (z list_emails)."),
        folder: z.string().optional().describe("Složka, výchozí 'INBOX'."),
        format: z.enum(["text", "html", "both"]).optional().describe("Které tělo vrátit (výchozí 'text')."),
        markSeen: z.boolean().optional().describe("Označit jako přečtený (výchozí false)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      run(async () =>
        json(
          await email.getEmail(args.folder || "INBOX", args.uid, {
            format: args.format,
            markSeen: args.markSeen,
          }),
        ),
      ),
  );

  // ── create_draft ─────────────────────────────────────────────────────────────
  server.registerTool(
    "create_draft",
    {
      title: "Vytvořit draft",
      description:
        "Vytvoří nový koncept (draft) a uloží ho do složky Koncepty na serveru — uvidíš ho " +
        "ve webmailu i v e-mailovém klientovi. NEodesílá ho.",
      inputSchema: {
        to: z.string().optional().describe("Příjemci, oddělené čárkou."),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string().optional().describe("Předmět."),
        text: z.string().optional().describe("Tělo jako prostý text."),
        html: z.string().optional().describe("Tělo jako HTML (volitelně místo/navíc k text)."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) => run(async () => json(await email.createDraft(args))),
  );

  // ── draft_reply ──────────────────────────────────────────────────────────────
  server.registerTool(
    "draft_reply",
    {
      title: "Připravit odpověď (draft)",
      description:
        "Připraví koncept ODPOVĚDI na existující e-mail (UID + složka). Správně nastaví " +
        "příjemce, předmět (Re:), zařazení do vlákna a přidá citaci původní zprávy. " +
        "Uloží do Konceptů — NEodesílá.",
      inputSchema: {
        uid: z.number().int().describe("UID e-mailu, na který se odpovídá."),
        folder: z.string().optional().describe("Složka původního e-mailu, výchozí 'INBOX'."),
        text: z.string().optional().describe("Tvoje odpověď (prostý text). Citace se přidá automaticky."),
        html: z.string().optional().describe("Odpověď jako HTML (volitelně)."),
        replyAll: z.boolean().optional().describe("Odpovědět všem (přidat ostatní příjemce do kopie)."),
        quoteOriginal: z.boolean().optional().describe("Přidat citaci původní zprávy (výchozí true)."),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    (args) =>
      run(async () =>
        json(
          await email.draftReply({
            folder: args.folder || "INBOX",
            uid: args.uid,
            text: args.text,
            html: args.html,
            replyAll: args.replyAll,
            quoteOriginal: args.quoteOriginal,
          }),
        ),
      ),
  );

  // ── send_email (bonus) ───────────────────────────────────────────────────────
  server.registerTool(
    "send_email",
    {
      title: "Odeslat e-mail",
      description:
        "Odešle e-mail přes SMTP. POZOR: akce je nevratná — e-mail rovnou odejde příjemci. " +
        "Pokud chceš jen připravit text ke kontrole, použij raději create_draft nebo draft_reply. " +
        "Po odeslání se kopie uloží do složky Odeslané.",
      inputSchema: {
        to: z.string().describe("Příjemci, oddělené čárkou."),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string().describe("Předmět."),
        text: z.string().optional().describe("Tělo jako prostý text."),
        html: z.string().optional().describe("Tělo jako HTML."),
        saveToSent: z.boolean().optional().describe("Uložit kopii do Odeslané (výchozí true)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => run(async () => json(await email.sendEmail(args))),
  );

  return server;
}

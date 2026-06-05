# CLAUDE.md

Živý dokument. Průběžně aktualizuj, udržuj krátký a přehledný.

## Projekt
- Název: email-mcp
- Popis: Lokální MCP server pro práci s e-mailem přes IMAP + SMTP (přednastaveno pro Webglobe). Dává Claudovi nástroje pro čtení/filtrování schránky a přípravu draftů.
- Cíl / Vize: Uživatel si píše s Claudem o tom, co má v mailu, a nechá si připravit drafty (hlavně odpovědi) — bez chození do webmailu.
- Cílová skupina: Jednotlivec napojující server na Claude Desktop / Claude Code. Záměr „komunitní" MCP (každý si spustí lokálně se svým přihlášením).
- Jazyky: Komunikace v chatu česky, kód (proměnné, komentáře, commity) anglicky. UI texty nástrojů (popisy pro Clauda) česky.

## Uživatel
- Skill level: produktově zdatný, ne hluboce technický → rozhoduj sám o technických detailech, vysvětluj jednoduše, upozorni na nástrahy. Časté zaměňování SMTP (jen odesílání) vs IMAP (čtení) — hlídej.

## Stack
- Jazyk: TypeScript (ESM, NodeNext), Node.js ≥ 20 (vyvíjeno na 22).
- MCP: `@modelcontextprotocol/sdk` — dvě varianty transportu: **stdio** (lokálně) a **Streamable HTTP** (online).
- IMAP: `imapflow` · SMTP/MIME: `nodemailer` · parsování: `mailparser` · validace vstupů: `zod` v4.
- Online vrstva: `express` + `cors` (HTTP) · `jose` (JWT pro OAuth) · `pg` (Postgres). Hosting Railway.
- Online je MULTI-TENANT: údaje schránek per-uživatel, šifrované (AES-256-GCM) v Postgresu.

## Spouštění
- Dev (stdio): `npm run dev` (tsx watch ze `src/`)
- Dev (online/HTTP): `npm run dev:http`
- Typecheck: `npm run typecheck`
- Build: `npm run build` → `dist/`
- Běh stdio (lokální MCP klient): `npm start` (= `node dist/index.js`)
- Běh online (Railway): `npm run start:http` (= `node dist/http.js`)
- Bundle pro Claude Desktop: `npm run bundle` → `email-mcp.mcpb`

## Pravidla

### Prostředí
- NIKDY needituj `.env` — používej pouze `.env.local` (je v `.gitignore`).
- Přihlašovací údaje (EMAIL_USER, EMAIL_PASSWORD) nikdy do kódu ani do gitu. Buď v `.env.local`, nebo v `env` bloku konfigurace MCP klienta.
- **stdout je vyhrazen pro MCP protokol** — veškeré logy a chyby VŽDY na `stderr` (`console.error`). `console.log` v běžícím serveru je zakázán.

### Git a commity
- Repozitář zatím není inicializovaný. Před `git init`/commitem/pushem se zeptej uživatele.
- Commit zprávy anglicky, stručné (např. `feat: add draft_reply tool`).

### Knihovny a verze
- Vždy nejnovější stabilní verze; před instalací ověř na npm. Pozor na kompatibilitu MCP SDK ↔ zod (SDK 1.29 podporuje zod `^3.25 || ^4.0`).

### Bezpečnost
- `send_email` je nevratné (rovnou odešle). Pro běžnou práci preferuj `create_draft` / `draft_reply`.
- U nových funkcí hlídej validaci vstupů (zod) a zacházení s přihlášením.

### Vyhledávání
- Když si nejsi jistý verzí/syntaxí/best practice, ověř na internetu. Nespoléhej na zastaralé znalosti.

## Struktura projektu
```
/
├── package.json          # ESM, bin: email-mcp -> dist/index.js, script: bundle
├── tsconfig.json         # NodeNext, strict
├── manifest.json         # MCPB manifest (user_config formulář: e-mail/heslo/servery)
├── .mcpbignore           # co nebalit do .mcpb (src, mapy, .env*)
├── email-mcp.mcpb        # zabalený bundle pro jednoklikovou instalaci (generovaný)
├── railway.json          # Railway: NIXPACKS build + startCommand node dist/http.js
├── .env.example          # šablona přihlášení + Webglobe servery + online proměnné
├── README.md             # instalace + napojení (lokálně i online) do Clauda
└── src/
    ├── server.ts         # createMcpServer(service) — registrace nástrojů nad konkrétní schránkou
    ├── index.ts          # vstup STDIO (creds z env přes credsFromEnv)
    ├── http.ts           # vstup ONLINE: Express + Streamable HTTP; per-session creds z DB
    ├── auth.ts           # OAuth 2.1 (PKCE, DCR); /authorize = formulář na údaje schránky
    ├── store.ts          # úložiště údajů: Postgres (prod) / in-memory (dev), šifrované
    ├── crypto.ts         # AES-256-GCM šifrování údajů schránek (klíč ENCRYPTION_KEY)
    ├── email-service.ts  # createEmailService(creds): IMAP (ImapFlow) + SMTP (Nodemailer)
    ├── config.ts         # env (EMAIL_* jen pro stdio; online: JWT/ENCRYPTION/DATABASE)
    └── util.ts           # datum, adresy, detekce příloh, citace odpovědi
```

## Nástroje (MCP tools)
`list_folders`, `list_emails` (filtry: folder/from/to/subject/search/since/before/unreadOnly + stránkování),
`get_email` (UID → tělo + přílohy), `create_draft`, `draft_reply` (vlákno + citace), `send_email` (bonus, nevratné).

## Nuance projektu
- Webglobe (ověřeno z oficiální poradny): IMAP `mail.webglobe.cz:993` (SSL), SMTP `mail.webglobe.cz:465` (SSL) / 587 (STARTTLS). Login = celá e-mailová adresa. Alternativa Office Mail/IceWarp: `webglobe1.onice.io`.
- IMAP spojení se otevírá per-operace (`withClient`) a po dokončení se odhlásí — pro lokální MCP s nízkým provozem jednoduché a robustní.
- Drafty/Odeslané: speciální složka se hledá přes IMAP SPECIAL-USE (`\Drafts`/`\Sent`), pak env override, pak běžné názvy (Drafts/Koncepty…).
- `list_emails` filtruje server-side přes IMAP SEARCH (správné stránkování). Pole `hasAttachment` je informativní; filtrování podle přílohy přijde ve Fázi 2.
- Datum: `parseDateInput` umí ISO i relativní (`30m`, `2h`, `7d`, `2w`).

## Rozhodnutí
- 2026-06-04: TypeScript + MCP SDK + ImapFlow/Nodemailer/mailparser — nejstabilnější kombinace pro e-mailové MCP (ověřeno proti komunitním projektům florianbuetow/imap-mini-mcp, codefuturist/email-mcp).
- 2026-06-04: Fáze 1 = lokální stdio server bez DB (rychle k cíli get+drafty, nula infry, data jen u uživatele). PostgreSQL/Railway odloženo do Fáze 2 (až bude potřeba silnější fulltext/analýzy).
- 2026-06-04: zod v4 (SDK 1.29 ho podporuje) místo zod v3 — držíme nejnovější verze.
- 2026-06-04: Distribuce přes MCPB bundle (.mcpb, manifest_version 0.3) pro jednoklikovou instalaci v Claude Desktopu (Node je v Desktopu zabudovaný; přihlášení přes user_config formulář, heslo do OS trezoru). Naplňuje záměr „komunitní" sdílení bez terminálu. Balí se přes `npm run bundle` nebo `mcpb pack`. Webová Claude.ai local stdio nepodporuje — jen Desktop/Claude Code. Pozn.: název `email-mcp` je na npm obsazený → pro případnou npm publikaci zvolit scoped/jiný název.
- 2026-06-04: ONLINE varianta pro claude.ai web+mobil = vzdálený MCP (custom connector) přes Streamable HTTP, hostovaný na Railway. Vyžaduje Claude Pro/Max. Model: single-tenant — každý si nasadí vlastní server se svým přihlášením (env). E-mailové heslo tím pádem žije na serveru (vědomá daň za přístup odkudkoli).
- 2026-06-04: Autorizace = vlastní minimální OAuth 2.1 server (auth.ts), STATELESS — tokeny podepsané JWT (jose, HS256), žádná DB → přežije restart. Přihlášení jediným OWNER_PASSWORD, PKCE S256, Dynamic Client Registration (client_id = podepsaný JWT s redirect_uris). `/mcp` chráněno Bearer tokenem; 401 vrací WWW-Authenticate s odkazem na PRM. Ověřeno lokálním e2e testem (13/13: discovery→register→authorize→token→session→tools/list→refresh). Reálný handshake s claude.ai + reálný IMAP zatím netestováno (nutný deploy + heslo).
- 2026-06-04: `/mcp` je session-based Streamable HTTP (Mcp-Session-Id, in-memory mapa transportů), ne stateless-per-request — kvůli kompatibilitě návaznosti initialize→tools/list u claude.ai.
- 2026-06-04: dotenv volán s `quiet:true` — jinak v17 píše „tipy" na stdout a rozbil by stdio MCP protokol.
- 2026-06-05: Diagnostika online provozu (claude.ai): (a) neznámá session musí vracet 404 (ne 400), jinak se claude.ai nereinicializuje; (b) ImapFlow vyvolává async `error` event → BEZ `client.on('error')` neodchycený event shodí celý server; (c) IMAP chyby překládáme do čitelných hlášek + timeouty (15s connect), ať „nevisí". Ověřeno reálným provozem na Railway.
- 2026-06-05: PŘECHOD na MULTI-TENANT online. Místo jedné schránky v env zadá uživatel údaje při přidání connectoru (formulář na `/authorize`); uloží se šifrovaně (AES-256-GCM, `ENCRYPTION_KEY`) v Postgresu (`store.ts`), token nese jen `credentialId` (claim `sub`). `email-service.ts` přestavěno na `createEmailService(creds)` — per-uživatel údaje napříč nástroji. Pozn.: e-mailové heslo NELZE hashovat (server ho potřebuje k IMAP loginu) → jen šifrovat; doporučeno app-specific heslo. OWNER_PASSWORD zrušeno (autentizace = vlastnictví funkčních údajů schránky). stdio varianta beze změny (creds z env).

## Údržba tohoto souboru
- Aktualizuj po strukturální změně, novém pravidlu nebo rozhodnutí. Maximální stručnost. Smaž zastaralé info.

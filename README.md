# email-mcp

**MCP server** pro práci s e-mailem přes **IMAP + SMTP** (přednastaveno pro
**Webglobe**). Umožní Claudovi číst tvou schránku, filtrovat e-maily a připravovat
**drafty** — bez chození do webmailu.

Dvě varianty nasazení:

| | Lokální (stdio / `.mcpb`) | Online (Railway) |
|---|---|---|
| **Kde běží** | u tebe na počítači | hostovaně na serveru |
| **Funguje v** | Claude Desktop / Claude Code | **claude.ai web + mobil** (odkudkoli) |
| **Přihlášení** | jen u tebe | OAuth (heslo k serveru), e-mail. heslo v env serveru |
| **Potřebuje** | nic navíc | hosting + Claude **Pro/Max** |

Vyber podle toho, jestli chceš jednoduchost a soukromí (lokální), nebo přístup
odkudkoli z mobilu (online).

---

## 🚀 Pro kamaráda — instalace jedním souborem (.mcpb)

Nejjednodušší cesta. Kamarád **nemusí instalovat Node ani nic buildovat** — Node.js
je součástí Claude Desktopu.

1. Mít **Claude Desktop** (appka pro Windows/macOS; ve webovém prohlížeči to nefunguje).
2. Pošli mu soubor **`email-mcp.mcpb`**.
3. Otevře `Settings → Extensions` a přetáhne/otevře `email-mcp.mcpb` (nebo na soubor jen dvojklikne).
4. Claude ukáže **formulář** — vyplní svou **e-mailovou adresu** a **heslo**
   (heslo se uloží do systémového trezoru — Keychain / Správce přihlašovacích údajů).
   Pole pro servery jsou předvyplněná na Webglobe; pro jiného poskytovatele je přepíše.
5. Hotovo — Claude umí pracovat s jeho schránkou.

> **Jiný poskytovatel než Webglobe?** Stačí ve formuláři změnit servery:
> Seznam → `imap.seznam.cz` / `smtp.seznam.cz`; Gmail → `imap.gmail.com` / `smtp.gmail.com`
> (Gmail vyžaduje „App Password", ne běžné heslo). Port 587 (STARTTLS) místo 465 ještě
> vyžaduje doplnit proměnnou `SMTP_SECURE=false`.

### Jak `email-mcp.mcpb` vyrobit / aktualizovat
```powershell
npm run bundle    # build + zabalí do email-mcp.mcpb
```
Pro co nejmenší balíček napřed vyřaď vývojové závislosti:
```powershell
npm run build
npm prune --omit=dev
npx -y @anthropic-ai/mcpb pack . email-mcp.mcpb
npm install       # vrátí dev závislosti pro další vývoj
```

---

## 🌍 Online (claude.ai web + mobil) — nasazení na Railway

Tahle varianta běží na serveru, takže s e-mailem pracuješ i **z mobilu nebo ze
zahraničí** — stačí být přihlášený do svého Claude účtu. Každý si nasadí **vlastní**
server se svým přihlášením.

> **Prerekvizita:** vlastní connectory na claude.ai jsou jen na **Claude Pro nebo Max**.

### 1) Nasaď na Railway
1. Nahraj tenhle projekt na GitHub (`git init`, commit, push).
2. Na [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → vyber repo.
   Railway sám zbuilduje (přes `railway.json`) a spustí `node dist/http.js`.
3. V projektu **Settings → Networking → Generate Domain** (vznikne `https://…up.railway.app`).

### 2) Nastav proměnné prostředí (Variables)
| Proměnná | Hodnota |
|---|---|
| `EMAIL_USER` | tvoje e-mailová adresa |
| `EMAIL_PASSWORD` | heslo k e-mailu |
| `OWNER_PASSWORD` | **silné** heslo, kterým se přihlásíš do connectoru |
| `JWT_SECRET` | náhodný klíč — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

`PUBLIC_URL` obvykle nemusíš nastavovat — odvodí se z Railway domény automaticky.
Pro jiného poskytovatele než Webglobe přidej `IMAP_HOST` / `SMTP_HOST` / `SMTP_PORT`
(viz `.env.example`).

### 3) Přidej connector do claude.ai
1. claude.ai → **Settings → Connectors → Add custom connector**.
2. URL = **`https://<tvoje-railway-doména>/mcp`** → **Add**.
3. Claude tě přesměruje na **přihlašovací stránku** → zadej `OWNER_PASSWORD` → povolíš přístup.
4. Hotovo — funguje i v mobilní appce Claude pod stejným účtem.

### Bezpečnost (důležité)
- E-mailové heslo je uložené v proměnných na Railway (šifrované at-rest). Hosting = nutná daň za „funguje odkudkoli".
- Přístup k serveru chrání `OWNER_PASSWORD` + OAuth. **Zvol silné heslo** a `JWT_SECRET` nikdy nesdílej.
- Server je single-tenant: obsluhuje jen tvou jednu schránku. Kamarád si nasadí vlastní instanci.

### Lokální test online verze
```powershell
# do .env.local doplň OWNER_PASSWORD, JWT_SECRET a PUBLIC_URL=http://localhost:3000
npm run dev:http
# server poběží na http://localhost:3000 (connector URL: http://localhost:3000/mcp)
```

---

## Nástroje

| Nástroj | Co dělá |
|---|---|
| `list_folders` | Vypíše složky (INBOX, Odeslané, Koncepty, Koš…). |
| `list_emails` | Vypíše e-maily ze složky s filtry: odesílatel, předmět, datum (i relativně `7d`/`2h`), jen nepřečtené, fulltext, stránkování. |
| `get_email` | Načte celý e-mail podle UID (tělo text/HTML + přílohy). Ve výchozím stavu neoznačí jako přečtený. |
| `create_draft` | Vytvoří nový koncept a uloží do složky Koncepty. |
| `draft_reply` | Připraví **draft odpovědi** na e-mail (správné vlákno, `Re:`, citace originálu). |
| `send_email` | Odešle e-mail přes SMTP (nevratné) + uloží kopii do Odeslané. |

## Instalace

```powershell
npm install
npm run build
```

## Konfigurace

Zkopíruj `.env.example` na `.env.local` a vyplň heslo:

```powershell
Copy-Item .env.example .env.local
```

```ini
EMAIL_USER=liska@prospoluzaky.cz
EMAIL_PASSWORD=tvé-heslo-k-emailu
# Webglobe servery jsou předvyplněné (mail.webglobe.cz). Měnit obvykle netřeba.
```

> `.env.local` se necommituje (je v `.gitignore`). **Heslo nikdy nedávej do kódu.**

## Připojení do Clauda

### Claude Desktop
Otevři soubor s konfigurací (`Settings → Developer → Edit Config`) a přidej server.
Doporučený způsob — přihlášení předat přímo v `env`, nemusíš pak řešit `.env.local`:

```json
{
  "mcpServers": {
    "email": {
      "command": "node",
      "args": ["c:\\Users\\Royal Fox\\Documents\\Devs\\email-mcp\\dist\\index.js"],
      "env": {
        "EMAIL_USER": "liska@prospoluzaky.cz",
        "EMAIL_PASSWORD": "tvé-heslo-k-emailu"
      }
    }
  }
}
```

Po uložení Claude Desktop restartuj.

### Claude Code
```powershell
claude mcp add email -- node "c:\Users\Royal Fox\Documents\Devs\email-mcp\dist\index.js"
```
(přihlášení vezme z `.env.local`, nebo ho přidej přes `--env EMAIL_USER=… --env EMAIL_PASSWORD=…`)

## Vývoj

```powershell
npm run dev        # tsx watch (běží ze src/)
npm run typecheck  # kontrola typů bez buildu
npm run build      # kompilace do dist/
```

## Příklady, co můžeš Claudovi říct

- „Ukaž mi nepřečtené e-maily z posledních 3 dnů."
- „Najdi e-maily od faktury@… za poslední měsíc."
- „Přečti mi e-mail s UID 1234 a připrav zdvořilou odpověď do draftů."

## Bezpečnostní poznámky

- `send_email` je **nevratné** — odešle rovnou. Pro kontrolu před odesláním používej `create_draft` / `draft_reply`.
- Server běží lokálně; přihlášení drž jen v `.env.local` nebo v `env` bloku konfigurace Clauda.

## Roadmapa (Fáze 2)

- Stahování e-mailů do **PostgreSQL** (Railway) pro rychlý český fulltext a analýzy.
- Správa: označení přečtené/nepřečtené, přesun, koš, práce s přílohami.
- Volitelně více účtů.

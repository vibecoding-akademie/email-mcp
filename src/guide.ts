/**
 * Návod (HTML) servírovaný na /navod. Token __PUBLIC_URL__ se nahradí adresou serveru.
 */
export const guideHtml = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Návod — E-mail MCP pro Claude</title>
<style>
  :root{--bg:#0f172a;--card:#1e293b;--line:#334155;--muted:#94a3b8;--text:#e2e8f0;--accent:#6366f1;--ok:#22c55e}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);margin:0;line-height:1.55}
  .wrap{max-width:760px;margin:0 auto;padding:2.5rem 1.25rem 4rem}
  h1{font-size:1.7rem;margin:0 0 .3rem}
  .lead{color:var(--muted);margin:0 0 1.5rem}
  .badge{display:inline-block;background:#3730a3;color:#e0e7ff;font-size:.72rem;padding:.2rem .55rem;border-radius:999px;margin-bottom:1rem}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.25rem 1.4rem;margin:1rem 0}
  h2{font-size:1.2rem;margin:.2rem 0 .2rem;display:flex;align-items:center;gap:.5rem}
  h2 .n{display:inline-grid;place-items:center;width:1.7rem;height:1.7rem;border-radius:8px;background:var(--accent);color:#fff;font-size:.95rem;flex:none}
  .sub{color:var(--muted);font-size:.9rem;margin:.1rem 0 1rem}
  ol{margin:0;padding-left:1.2rem}ol li{margin:.45rem 0}
  code{background:#0b1220;border:1px solid var(--line);border-radius:6px;padding:.1rem .4rem;font-size:.86em;word-break:break-all}
  .copy{display:block;background:#0b1220;border:1px solid var(--line);border-radius:8px;padding:.7rem .8rem;margin:.5rem 0;font-family:ui-monospace,monospace;font-size:.85rem;word-break:break-all}
  table{width:100%;border-collapse:collapse;margin:.6rem 0;font-size:.9rem}
  th,td{text-align:left;padding:.45rem .5rem;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600}
  .note{border-left:3px solid var(--accent);background:#1b2440;padding:.7rem .9rem;border-radius:0 8px 8px 0;font-size:.88rem;margin:.8rem 0}
  .warn{border-left-color:#f59e0b;background:#2a2310}
  .ok{border-left-color:var(--ok);background:#10261a}
  a{color:#a5b4fc}
  footer{color:var(--muted);font-size:.82rem;margin-top:2rem;text-align:center}
  .pill{display:inline-block;background:#0b1220;border:1px solid var(--line);border-radius:999px;padding:.15rem .6rem;font-size:.78rem;margin:.15rem .2rem 0 0}
</style></head>
<body><div class="wrap">
  <span class="badge">Návod k nastavení</span>
  <h1>📧 E-mail v Claude (přes IMAP/SMTP)</h1>
  <p class="lead">Čti svou poštu a připravuj odpovědi přímo v Claude — na webu i v mobilu, odkudkoli. Tvoje přihlášení ani e-maily neprochází přes nikoho třetího; server se připojuje rovnou na tvůj poštovní server a údaje ukládá <b>šifrovaně</b>.</p>

  <div class="note warn"><b>Co budeš potřebovat:</b> účet <b>Claude Pro nebo Max</b> (vlastní konektory jsou jen na placených tarifech) a přihlašovací údaje ke své e-mailové schránce.</div>

  <h2><span class="n">🔌</span> Připojit svou schránku</h2>
  <p class="sub">Zabere to minutku.</p>
  <div class="card">
    <ol>
      <li>V <b>claude.ai</b> otevři <b>Settings → Connectors → Add custom connector</b>.</li>
      <li>Název: cokoli (např. <i>Můj e-mail</i>). <b>URL</b> zadej:
        <span class="copy">__PUBLIC_URL__/mcp</span>
        a klikni <b>Add</b>.</li>
      <li>Vyskočí <b>formulář</b> — vyplň údaje své schránky a dej <b>Připojit schránku</b>.</li>
      <li>Hotovo. V chatu klikni na <b>＋ → Connectors</b>, zapni svůj konektor a napiš třeba: <i>„Mám nějaké nepřečtené e-maily?"</i></li>
    </ol>
    <div class="note">Funguje pak i v <b>mobilní appce</b> Claude pod stejným účtem — nic dalšího nenastavuješ.</div>
  </div>

  <h2><span class="n">⚙︎</span> Údaje pro známé poskytovatele</h2>
  <div class="card">
    <table>
      <tr><th>Poskytovatel</th><th>IMAP server</th><th>SMTP server</th></tr>
      <tr><td>Seznam.cz</td><td>imap.seznam.cz</td><td>smtp.seznam.cz</td></tr>
      <tr><td>Webglobe</td><td>mail.webglobe.cz</td><td>mail.webglobe.cz</td></tr>
      <tr><td>Gmail</td><td>imap.gmail.com</td><td>smtp.gmail.com</td></tr>
    </table>
    <p class="sub">Port IMAP <b>993</b>, SMTP <b>465</b> (SSL). Přihlašovací jméno = celá e-mailová adresa.</p>
    <div class="note warn"><b>Heslo „pro aplikace":</b> Seznam i Gmail nepustí dovnitř hlavní heslo, když máš zapnuté dvoufázové ověření — vygeneruj si <b>app-specific heslo</b> a zadej to.
      <br><span class="pill">Seznam: ucet.seznam.cz → Zabezpečení → Heslo pro aplikace</span>
      <span class="pill">Gmail: myaccount.google.com/apppasswords</span></div>
  </div>

  <h2><span class="n">🔒</span> Bezpečnost</h2>
  <div class="card">
    <ol>
      <li>Údaje schránek jsou v databázi <b>šifrované</b> (AES-256-GCM). Heslo nelze „hashovat" (server ho musí použít k přihlášení do pošty), proto <b>používej app-specific heslo</b> — kdykoli ho odvoláš.</li>
      <li>Každý uživatel vidí jen <b>svou</b> schránku. Klíče <code>JWT_SECRET</code> a <code>ENCRYPTION_KEY</code> nikdy nesdílej.</li>
      <li>Server je open-source — můžeš si přečíst, co dělá: <a href="https://github.com/Royal-Fox/email-mcp">github.com/Royal-Fox/email-mcp</a>.</li>
    </ol>
  </div>

  <footer>email-mcp · IMAP/SMTP konektor pro Claude</footer>
</div></body></html>`;

/**
 * Interaktivní klikací návod (HTML) servírovaný na /navod.
 * Token __PUBLIC_URL__ se nahradí adresou serveru (viz http.ts).
 */
export const guideHtml = `<!doctype html>
<html lang="cs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Návod — připojení e-mailu do Claude</title>
<style>
  :root{--bg:#0f172a;--card:#1e293b;--line:#334155;--muted:#94a3b8;--text:#e2e8f0;--accent:#6366f1;--ok:#22c55e}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);margin:0;line-height:1.55}
  .wrap{max-width:560px;margin:0 auto;padding:2.5rem 1.25rem 4rem}
  .badge{display:inline-block;background:#3730a3;color:#e0e7ff;font-size:.72rem;padding:.2rem .55rem;border-radius:999px}
  h1{font-size:1.5rem;margin:.6rem 0 1rem}
  .dots{display:flex;gap:.45rem;margin:0 0 1rem}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--line);transition:background .2s}
  .dot.on{background:var(--accent)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1.4rem 1.5rem;min-height:230px;display:flex;flex-direction:column}
  #counter{color:var(--muted);font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;margin-bottom:.5rem}
  .step{display:none}
  .step.active{display:block;animation:fade .22s ease}
  #done{display:none;text-align:center;padding:1rem 0;animation:fade .3s ease}
  #done h2{font-size:1.7rem}#done p{color:var(--muted)}
  @keyframes fade{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  h2{font-size:1.18rem;margin:.1rem 0 .8rem}
  ol{margin:.2rem 0;padding-left:1.2rem}ol li{margin:.5rem 0}
  p{margin:.5rem 0}
  code{background:#0b1220;border:1px solid var(--line);border-radius:6px;padding:.12rem .42rem;font-size:.86em;word-break:break-all}
  .urlbox{display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;background:#0b1220;border:1px solid var(--line);border-radius:8px;padding:.55rem .7rem;margin:.6rem 0;font-family:ui-monospace,monospace;font-size:.84rem}
  .urlbox span{word-break:break-all;flex:1;min-width:200px}
  .copy-btn{padding:.3rem .7rem;border-radius:6px;border:1px solid var(--accent);background:transparent;color:#a5b4fc;cursor:pointer;font-size:.78rem}
  table{width:100%;border-collapse:collapse;margin:.5rem 0;font-size:.88rem}
  th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--line)}
  th{color:var(--muted);font-weight:600}
  .note{border-left:3px solid var(--accent);background:#1b2440;padding:.6rem .85rem;border-radius:0 8px 8px 0;font-size:.85rem;margin:.7rem 0}
  .warn{border-left-color:#f59e0b;background:#2a2310}
  .pill{display:inline-block;background:#0b1220;border:1px solid var(--line);border-radius:999px;padding:.12rem .55rem;font-size:.74rem;margin:.2rem .2rem 0 0}
  .nav{display:flex;justify-content:space-between;gap:1rem;margin-top:auto;padding-top:1.3rem}
  .nav button{padding:.6rem 1.2rem;border-radius:9px;border:1px solid var(--line);background:#0b1220;color:var(--text);font-weight:600;cursor:pointer;font-size:.92rem}
  .nav button#next{background:var(--accent);border-color:var(--accent);color:#fff}
  .nav button:disabled{opacity:.35;cursor:default}
  a{color:#a5b4fc}
</style></head>
<body><div class="wrap">
  <span class="badge">Návod</span>
  <h1>📧 E-mail do Claude</h1>
  <div class="dots" id="dots"></div>

  <div class="card">
    <div id="counter"></div>

    <section class="step">
      <h2>1 · Otevři konektory v Claude</h2>
      <ol>
        <li>Otevři <a href="https://claude.ai/customize/connectors" target="_blank"><b>claude.ai/customize/connectors</b></a> (přihlaš se do svého účtu).</li>
      </ol>
      <div class="note warn">Vyžaduje <b>Claude Pro nebo Max</b>.</div>
    </section>

    <section class="step">
      <h2>2 · Přidej tento konektor</h2>
      <ol>
        <li>Klikni <b>Add custom connector</b>.</li>
        <li>Název: cokoli (např. <i>Můj e-mail</i>).</li>
        <li>Do pole <b>URL</b> vlož:</li>
      </ol>
      <div class="urlbox"><span>__PUBLIC_URL__/mcp</span>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('__PUBLIC_URL__/mcp');this.textContent='Zkopírováno ✓'">Kopírovat</button>
      </div>
      <p>Klikni <b>Add</b>.</p>
    </section>

    <section class="step">
      <h2>3 · Vyplň svou schránku</h2>
      <p>Vyskočí <b>formulář</b> — vyplň údaje a klikni <b>Připojit schránku</b>.</p>
      <table>
        <tr><th>Poskytovatel</th><th>IMAP server</th><th>SMTP server</th></tr>
        <tr><td>Seznam.cz</td><td>imap.seznam.cz</td><td>smtp.seznam.cz</td></tr>
        <tr><td>Webglobe</td><td>mail.webglobe.cz</td><td>mail.webglobe.cz</td></tr>
        <tr><td>Gmail</td><td>imap.gmail.com</td><td>smtp.gmail.com</td></tr>
      </table>
      <p style="color:var(--muted);font-size:.85rem">Port IMAP <b>993</b>, SMTP <b>465</b>. Jméno = celá e-mailová adresa.</p>
      <div class="note warn"><b>Heslo pro aplikace:</b> Seznam i Gmail nepustí dovnitř hlavní heslo, když máš dvoufázové ověření — vygeneruj <b>app-specific heslo</b> a zadej to.
        <br><span class="pill">Seznam: ucet.seznam.cz → Zabezpečení</span><span class="pill">Gmail: myaccount.google.com/apppasswords</span></div>
    </section>

    <section class="step">
      <h2>4 · Hotovo 🎉</h2>
      <ol>
        <li>V chatu klikni na <b>＋ → Connectors</b> a <b>zapni</b> konektor.</li>
        <li>Napiš třeba: <i>„Mám nějaké nepřečtené e-maily?"</i></li>
      </ol>
    </section>

    <section id="done">
      <h2>🎉 Paráda!</h2>
      <p>Schránka je připojená. Zkus se Clauda zeptat na poštu.</p>
    </section>

    <div class="nav">
      <button id="back">← Zpět</button>
      <button id="next">Další →</button>
    </div>
  </div>
</div>
<script>
(function(){
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  var i = 0;
  var back = document.getElementById('back'), next = document.getElementById('next');
  var counter = document.getElementById('counter'), dots = document.getElementById('dots');
  for (var d = 0; d < steps.length; d++){ var s = document.createElement('span'); s.className = 'dot'; dots.appendChild(s); }
  function render(){
    for (var k = 0; k < steps.length; k++){ steps[k].classList.toggle('active', k === i); }
    var de = dots.children;
    for (var k = 0; k < de.length; k++){ de[k].classList.toggle('on', k <= i); }
    counter.textContent = 'Krok ' + (i + 1) + ' / ' + steps.length;
    back.style.visibility = (i === 0) ? 'hidden' : 'visible';
    next.textContent = (i === steps.length - 1) ? 'Hotovo ✓' : 'Další →';
  }
  function confetti(){
    var cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    function size(){ cv.width = window.innerWidth; cv.height = window.innerHeight; }
    size(); window.addEventListener('resize', size);
    var colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#e0e7ff'];
    var P = [];
    for (var n = 0; n < 150; n++){
      P.push({ x: Math.random()*cv.width, y: -20 - Math.random()*cv.height*0.4, r: 5 + Math.random()*7,
        c: colors[(Math.random()*colors.length)|0], vy: 2 + Math.random()*4, vx: -2.5 + Math.random()*5,
        a: Math.random()*6.28, va: -0.2 + Math.random()*0.4 });
    }
    var start = Date.now();
    function frame(){
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (var k = 0; k < P.length; k++){
        var p = P[k]; p.x += p.vx; p.y += p.vy; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r*0.6); ctx.restore();
      }
      if (Date.now() - start < 4500){ requestAnimationFrame(frame); } else { cv.remove(); }
    }
    frame();
  }
  function celebrate(){
    for (var k = 0; k < steps.length; k++){ steps[k].classList.remove('active'); }
    for (var k = 0; k < dots.children.length; k++){ dots.children[k].classList.add('on'); }
    document.getElementById('done').style.display = 'block';
    document.querySelector('.nav').style.display = 'none';
    counter.style.display = 'none';
    confetti();
  }
  back.onclick = function(){ if (i > 0){ i--; render(); } };
  next.onclick = function(){ if (i < steps.length - 1){ i++; render(); } else { celebrate(); } };
  render();
})();
</script>
</body></html>`;

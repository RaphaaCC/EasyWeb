export function diagnosticsDashboardHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>EasyWeb API | Operação</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; background: #edf3f1; color: #17322d; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: flex; justify-content: space-between; gap: 20px; align-items: end; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 26px; } p { margin: 5px 0 0; color: #5d716c; }
    .auth { display: flex; gap: 8px; align-items: center; } input, button { min-height: 36px; border-radius: 6px; font: inherit; }
    input { width: 245px; border: 1px solid #b7cec7; padding: 0 10px; background: #fff; }
    button { border: 1px solid #087d70; padding: 0 12px; background: #087d70; color: #fff; font-weight: 700; cursor: pointer; }
    button:hover, button:focus-visible { background: #06665c; outline: 2px solid #8bd9ce; outline-offset: 2px; }
    .status { min-height: 20px; margin: 0 0 16px; color: #5d716c; font-size: 14px; } .status.error { color: #a14133; }
    .metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric, section { border: 1px solid #cedfd9; border-radius: 8px; background: #fff; }
    .metric { padding: 16px; } .metric span { display:block; color:#5d716c; font-size:12px; font-weight:700; text-transform:uppercase; }
    .metric strong { display:block; margin-top:8px; font-size:25px; }
    .layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    section { padding: 16px; min-width: 0; } h2 { margin:0 0 12px; font-size:16px; }
    table { width:100%; border-collapse:collapse; font-size:12px; } th,td { padding:9px 6px; border-top:1px solid #e5efeb; text-align:left; overflow-wrap:anywhere; vertical-align:top; } th { color:#5d716c; font-size:11px; text-transform:uppercase; }
    .empty { color:#5d716c; font-size:13px; } @media (max-width: 760px) { header,.auth { align-items:stretch; flex-direction:column; } input{ width:100%; } .metrics,.layout{ grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>EasyWeb API</h1><p>Monitoramento operacional de snapshots, planos e fila de adaptação.</p></div>
      <form class="auth" id="auth"><input id="token" type="password" autocomplete="current-password" placeholder="Token administrativo" aria-label="Token administrativo"><button type="submit">Atualizar</button></form>
    </header>
    <div class="status" id="status" role="status">Informe o token administrativo para consultar os dados.</div>
    <div class="metrics" id="metrics"></div>
    <div class="layout">
      <section><h2>Últimos snapshots</h2><div id="snapshots"></div></section>
      <section><h2>Fila de adaptação</h2><div id="jobs"></div></section>
    </div>
  </main>
  <script src="/api/v1/internal/dashboard.js" defer></script>
</body>
</html>`;
}

export function diagnosticsDashboardScript() {
  return `(() => {
  const form = document.querySelector('#auth');
  const token = document.querySelector('#token');
  const status = document.querySelector('#status');
  const metrics = document.querySelector('#metrics');
  const snapshots = document.querySelector('#snapshots');
  const jobs = document.querySelector('#jobs');
  const formatBytes = (value) => value >= 1048576 ? (value / 1048576).toFixed(1) + ' MB' : value >= 1024 ? (value / 1024).toFixed(1) + ' KB' : value + ' B';
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '-';
  const clear = (node) => node.replaceChildren();
  const cell = (row, value) => { const item = document.createElement('td'); item.textContent = value; row.append(item); };
  function table(node, columns, rows) {
    clear(node);
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Nenhum registro disponível.'; node.append(empty); return; }
    const element = document.createElement('table'); const head = element.createTHead().insertRow(); columns.forEach((column) => { const item = document.createElement('th'); item.textContent = column.label; head.append(item); });
    const body = element.createTBody(); rows.forEach((row) => { const line = body.insertRow(); columns.forEach((column) => cell(line, column.value(row))); }); node.append(element);
  }
  function render(data) {
    clear(metrics);
    const cards = [ ['Snapshots', data.snapshots.total], ['Sites', data.snapshots.sites], ['Familias em observacao', data.families.observing], ['Confianca media', Math.round(data.families.averageConfidence * 100) + '%'], ['Planos ativos', data.plans.active + ' / ' + data.plans.total], ['Fila pendente', (data.jobs.totals.queued || 0) + (data.jobs.totals.retry || 0)] ];
    cards.forEach(([label, value]) => { const card = document.createElement('div'); card.className = 'metric'; const caption = document.createElement('span'); caption.textContent = label; const result = document.createElement('strong'); result.textContent = String(value); card.append(caption, result); metrics.append(card); });
    table(snapshots, [ { label:'Site', value: row => row.origin + row.path }, { label:'Capturas', value: row => row.captures }, { label:'Tamanho', value: row => formatBytes(row.bytes) }, { label:'Último', value: row => date(row.lastSeenAt) } ], data.snapshots.latest);
    table(jobs, [ { label:'Site', value: row => row.origin }, { label:'Estado', value: row => row.state }, { label:'Tentativas', value: row => row.attempts }, { label:'Atualizado', value: row => date(row.updatedAt) }, { label:'Erro', value: row => row.lastError || '-' } ], data.jobs.latest);
    status.className = 'status'; status.textContent = 'Atualizado em ' + date(data.generatedAt) + '. Banco: ' + data.database.status + '. Gemini: ' + (data.gemini.configured ? data.gemini.model : 'não configurado') + '.';
  }
  async function load() { status.className = 'status'; status.textContent = 'Consultando dados operacionais...'; try { const response = await fetch('/api/v1/internal/diagnostics', { headers: { 'X-EasyWeb-Admin-Token': token.value } }); if (!response.ok) throw new Error(response.status === 401 ? 'Token administrativo inválido.' : 'A consulta operacional não está disponível.'); render(await response.json()); } catch (error) { status.className = 'status error'; status.textContent = error.message; } }
  form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
})();`;
}

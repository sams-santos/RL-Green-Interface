// Builds a self-contained HTML report of the selected run (episodes 1..current) with the
// sections the user ticked. Charts are re-rendered off-screen in the light theme so the
// report prints well whatever theme the page is in.
window.GreenRLReport = (() => {
  const { formatValue } = GreenRLCharts;
  const fmtInt = d3.format(',');
  const MAX_IMPROVEMENT_ROWS = 200;

  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function withLightTheme(fn) {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    try {
      return fn();
    } finally {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    }
  }

  function renderSvg(draw, opts, width, height) {
    const holder = document.createElement('div');
    holder.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:${height}px;`;
    document.body.appendChild(holder);
    try {
      draw(holder, { ...opts, height });
      const svg = holder.querySelector('svg');
      if (!svg) return '';
      svg.querySelectorAll('.hover-layer, .hit-area').forEach(node => node.remove());
      return svg.outerHTML;
    } finally {
      holder.remove();
    }
  }

  function legendHtml(items) {
    const css = getComputedStyle(document.documentElement);
    return `<div class="legend">${items.map(item =>
      `<span><i class="key ${item.shape || 'line'}" style="background:${css.getPropertyValue(item.color).trim()}"></i>${esc(item.label)}</span>`
    ).join('')}</div>`;
  }

  function figure(title, caption, legend, svg) {
    return `<figure><figcaption><strong>${esc(title)}</strong>${caption ? `<span>${esc(caption)}</span>` : ''}</figcaption>${legend || ''}${svg}</figure>`;
  }

  function table(head, rows, className = '') {
    return `<table class="${className}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` +
      `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function kv(rows) {
    return `<table class="kv"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
  }

  function columnStats(values, end) {
    let sum = 0, n = 0, min = -1, max = -1;
    for (let i = 0; i < end; i++) {
      const v = values[i];
      if (Number.isNaN(v)) continue;
      sum += v; n++;
      if (min < 0 || v < values[min]) min = i;
      if (max < 0 || v > values[max]) max = i;
    }
    return { sum, mean: n ? sum / n : NaN, min, max };
  }

  function build(ctx) {
    const { run, episode, sections, instance, specs, params, displayValue, units, durationText, gapText } = ctx;
    const i = episode - 1;
    const config = run.config;
    const algorithm = displayValue(params[0], config.algorithm);
    const energy = v => `${formatValue(v * units.energyFactor)} ${units.energy}`;
    const emissions = v => `${formatValue(v * units.emissionsFactor)} ${units.emissions} CO₂eq`;
    const seconds = v => `${formatValue(v)} s`;
    const at = idx => (idx >= 0 ? `ep ${fmtInt(idx + 1)}` : '—');
    const bestIdx = run.minIdx.distance[i];
    const parts = [];

    // Configuration (always included)
    parts.push(`<section><h2>Configuration</h2>${kv([
      ...params.map(p => [p.label, displayValue(p, config[p.key])]),
      ['Instance type', instance ? `${instance.type}, ${fmtInt(instance.dimension)} nodes` : '—'],
      ['Episodes covered', `1 – ${fmtInt(episode)} of ${fmtInt(run.n)}`],
      ['Run id', run.id]
    ])}</section>`);

    if (sections.has('energySummary')) {
      const rows = [
        ['Duration', run.cols.duration, durationText, seconds],
        ['CPU energy', run.cols.cpu_energy, energy, energy],
        ['RAM energy', run.cols.ram_energy, energy, energy],
        ['Total energy', run.cols.energy_consumed, energy, energy],
        ['Emissions', run.cols.emissions, emissions, emissions]
      ].map(([label, values, totalFmt, epFmt]) => {
        const s = columnStats(values, episode);
        const all = columnStats(values, run.n);
        return [label, totalFmt(s.sum), epFmt(s.mean),
          s.min >= 0 ? `${epFmt(values[s.min])} (${at(s.min)})` : '—',
          s.max >= 0 ? `${epFmt(values[s.max])} (${at(s.max)})` : '—',
          totalFmt(all.sum)];
      });
      parts.push(`<section><h2>Energy &amp; emissions</h2>${table(
        ['Metric', `Total, ep 1–${fmtInt(episode)}`, 'Mean per episode', 'Lowest episode', 'Highest episode', `Total, all ${fmtInt(run.n)}`],
        rows, 'numeric')}</section>`);
    }

    const svgs = withLightTheme(() => ({
      energy: sections.has('energyCharts') ? renderSvg(GreenRLCharts.timeSeries, specs.energy.opts, 860, 260) : '',
      emissions: sections.has('energyCharts') ? renderSvg(GreenRLCharts.timeSeries, specs.emissions.opts, 420, 220) : '',
      duration: sections.has('energyCharts') ? renderSvg(GreenRLCharts.timeSeries, specs.duration.opts, 420, 220) : '',
      distance: sections.has('distanceChart') ? renderSvg(GreenRLCharts.timeSeries, specs.distance.opts, 860, 320) : '',
      route: sections.has('bestPath') && bestIdx >= 0 ? renderSvg(GreenRLCharts.routeChart, {
        instance, current: run.path(bestIdx), currentColor: '--series-2', showBest: false
      }, 560, 400) : '',
      energyLegend: legendHtml(specs.energy.legend),
      distanceLegend: legendHtml(specs.distance.legend)
    }));

    if (sections.has('energyCharts')) {
      parts.push(`<section><h2>Energy charts</h2>
        ${figure(specs.energy.title, specs.energy.caption, svgs.energyLegend, svgs.energy)}
        <div class="two-up">${figure(specs.emissions.title, '', '', svgs.emissions)}${figure(specs.duration.title, '', '', svgs.duration)}</div>
      </section>`);
    }

    if (sections.has('performanceSummary')) {
      const c = run.cumulative;
      const dist = columnStats(run.cols.distance, episode);
      parts.push(`<section><h2>Performance</h2>${kv([
        ['Best distance', formatValue(run.bestSoFar[i])],
        ['Found at', at(bestIdx)],
        ['Gap to optimum', instance?.optimum ? `${gapText(run.bestSoFar[i])} (optimum ${fmtInt(instance.optimum)})` : '—'],
        [`Distance at episode ${fmtInt(episode)}`, formatValue(run.cols.distance[i])],
        ['Mean distance', formatValue(dist.mean)],
        ['Episodes that set a new best', fmtInt(d3.bisectRight(run.improvements, i))],
        ['Time until best was found', bestIdx >= 0 ? durationText(c.duration[bestIdx]) : '—'],
        ['Energy until best was found', bestIdx >= 0 ? energy(c.energy_consumed[bestIdx]) : '—'],
        ['Emissions until best was found', bestIdx >= 0 ? emissions(c.emissions[bestIdx]) : '—']
      ])}</section>`);
    }

    if (sections.has('distanceChart')) {
      parts.push(`<section><h2>Distance</h2>${figure('Distance per episode', specs.distance.caption, svgs.distanceLegend, svgs.distance)}</section>`);
    }

    if (sections.has('bestPath')) {
      const path = bestIdx >= 0 ? run.path(bestIdx) : null;
      parts.push(`<section><h2>Best path</h2>
        ${path ? `<p>Episode ${fmtInt(bestIdx + 1)} · distance ${esc(formatValue(run.bestSoFar[i]))} · ${esc(specs.routeCaption)}</p>
        <div class="route">${svgs.route}</div>
        <p class="path">${path.map(n => esc(n)).join(' → ')} → ${esc(path[0])}</p>` : '<p>No path recorded for this run.</p>'}
      </section>`);
    }

    if (sections.has('improvements')) {
      const list = run.improvements.slice(0, d3.bisectRight(run.improvements, i));
      const shown = list.slice(-MAX_IMPROVEMENT_ROWS);
      const rows = shown.map(k => [fmtInt(k + 1), formatValue(run.cols.distance[k]), gapText(run.cols.distance[k]),
        durationText(run.cumulative.duration[k]), energy(run.cumulative.energy_consumed[k])]);
      parts.push(`<section><h2>History of new best distances</h2>
        ${list.length > shown.length ? `<p>Showing the last ${fmtInt(shown.length)} of ${fmtInt(list.length)} improvements.</p>` : ''}
        ${table(['Episode', 'Distance', 'Gap to optimum', 'Elapsed time', 'Energy used so far'], rows, 'numeric')}
      </section>`);
    }

    const generated = new Date().toLocaleString();
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Green RL report · ${esc(run.id)}</title>
<style>${REPORT_CSS}</style></head>
<body><main>
<header>
  <div class="eyebrow">Green RL Playground · experiment report</div>
  <h1>${esc(algorithm)} on ${esc(config.instance)}</h1>
  <p>Episodes 1–${fmtInt(episode)} of ${fmtInt(run.n)} · ${ctx.mode === 'cumulative' ? 'cumulative' : 'per-episode'} charts · generated ${esc(generated)}</p>
</header>
${run.demo ? '<div class="warning"><strong>Synthetic demo data.</strong> These numbers illustrate the interface and are not experiment results.</div>' : ''}
${parts.join('\n')}
<footer>Generated by Green RL Playground from pre-computed results.</footer>
</main></body></html>`;
  }

  function download(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function print(html, name) {
    const win = window.open('', '_blank');
    if (!win) {
      download(html, `${name}.html`);
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  const REPORT_CSS = `
    :root { --text:#1d3a30; --muted:#5c7268; --line:#dcebe3; --grid:#edf3ef; --axis:#c9d8d0; --soft:#e6f6ee; --panel:#ffffff; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f9f6; color: var(--text); font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size: 13px; }
    main { max-width: 920px; margin: 0 auto; padding: 28px 30px 40px; background: var(--panel); }
    header { padding: 22px 24px; border-radius: 14px; background: linear-gradient(120deg, #cfeedd 0%, #d8ecfb 60%, #fde6d2 100%); margin-bottom: 18px; }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
    h1 { margin: 6px 0 4px; font-size: 24px; }
    header p { margin: 0; color: var(--muted); }
    h2 { font-size: 16px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--soft); }
    section { break-inside: avoid-page; }
    p { line-height: 1.5; color: var(--muted); }
    .warning { background: #fff6dc; border: 1px solid #f2dc9b; border-radius: 10px; padding: 10px 12px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 7px 8px; border-bottom: 1px solid var(--grid); text-align: left; vertical-align: top; }
    thead th { color: var(--muted); font-weight: 650; font-size: 11.5px; }
    table.numeric td:not(:first-child), table.numeric th:not(:first-child) { text-align: right; }
    table.kv th { width: 38%; color: var(--muted); font-weight: 500; }
    table.kv td { font-weight: 600; }
    figure { margin: 0 0 16px; break-inside: avoid; }
    figcaption strong { display: block; font-size: 13.5px; }
    figcaption span { display: block; color: var(--muted); font-size: 12px; margin: 2px 0 4px; }
    .two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    svg { max-width: 100%; height: auto; display: block; }
    .route { display: flex; justify-content: center; }
    .path { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--text); word-break: break-word; background: var(--soft); padding: 10px; border-radius: 8px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin: 2px 0 4px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .key { display: inline-block; width: 14px; height: 3px; border-radius: 2px; }
    .axis text { fill: var(--muted); font-size: 10.5px; }
    .axis path, .axis line { stroke: var(--axis); }
    .grid-line { stroke: var(--grid); }
    .ref-line { stroke: var(--muted); opacity: .7; }
    .ref-label, .end-label, .route-label, .best-marker text { fill: var(--text); font-size: 11px; font-weight: 600; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
    .ref-label { fill: var(--muted); font-weight: 500; }
    footer { margin-top: 30px; color: var(--muted); font-size: 11px; text-align: center; }
    @page { margin: 14mm; }
    @media print { body { background: #fff; } main { padding: 0; max-width: none; } header { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  return { build, download, print };
})();

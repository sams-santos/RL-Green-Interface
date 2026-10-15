// Builds a self-contained HTML report of the selected run (first episode up to the current
// one) with the sections the user ticked. Charts are re-rendered off-screen at print size.
window.GreenRLReport = (() => {
  const { formatValue } = GreenRLCharts;
  const fmtInt = d3.format(',');
  const MAX_IMPROVEMENT_ROWS = 200;

  const icon = name => GreenRLIcons.svg(name);
  const flagImg = code => `<img class="flag" alt="" src="${GreenRLCharts.flagUrl(code)}">`;
  const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    const { run, episode, sections, instance, specs, params, displayValue, units, durationText, gapText,
      basis, gridText, epLabel } = ctx;
    const i = episode - 1;
    const config = run.config;
    const algorithm = displayValue(params[0], config.algorithm);
    const energy = v => `${formatValue(v * units.energyFactor)} ${units.energy}`;
    const emissions = v => `${formatValue(v * units.emissionsFactor)} ${units.emissions} CO₂eq`;
    const seconds = v => `${formatValue(v)} s`;
    const at = idx => (idx >= 0 ? `ep ${epLabel(idx)}` : '—');
    const range = `${epLabel(0)}–${epLabel(i)}`;
    const bestIdx = run.bestIdx[i];
    const parts = [];

    // Configuration (always included)
    parts.push(`<section><h2>${icon('sliders-horizontal')}Configuration</h2>${kv([
      ...params.map(p => [p.label, displayValue(p, config[p.key])]),
      ['Instance type', instance ? `${instance.type}, ${fmtInt(instance.dimension)} nodes` : '—'],
      ['Episodes covered', `${range} (${fmtInt(episode)} of ${fmtInt(run.n)})`],
      ['Electricity grid', gridText],
      ['Energy measurement', [run.measurement.cpu_measurement && `CPU energy from ${run.measurement.cpu_measurement}`,
        run.measurement.tracking_mode && `tracking mode: ${run.measurement.tracking_mode}`].filter(Boolean).join(' · ') || '—'],
      ['Average power', `CPU ${formatValue(run.summary.cpuPower)} W · RAM ${formatValue(run.summary.ramPower)} W`],
      ['Run id', run.id]
    ])}</section>`);

    if (sections.has('energySummary')) {
      const rows = [
        ['Duration', run.cols.duration, 1, durationText, seconds],
        ['CPU energy', run.cols.cpu_energy, 1, energy, energy],
        ['RAM energy', run.cols.ram_energy, 1, energy, energy],
        ['Total energy', run.cols.energy_consumed, 1, energy, energy],
        [`Emissions (${basis.label})`, basis.perEpisode, basis.factor, emissions, emissions]
      ].map(([label, values, factor, totalFmt, epFmt]) => {
        const s = columnStats(values, episode);
        const all = columnStats(values, run.n);
        return [label, totalFmt(s.sum * factor), epFmt(s.mean * factor),
          s.min >= 0 ? `${epFmt(values[s.min] * factor)} (${at(s.min)})` : '—',
          s.max >= 0 ? `${epFmt(values[s.max] * factor)} (${at(s.max)})` : '—',
          totalFmt(all.sum * factor)];
      });
      const c = run.cumulative;
      const flow = `<p class="flow">${icon('cpu')}CPU ${esc(energy(c.cpu_energy[i]))} + ${icon('memory-stick')}RAM ${esc(energy(c.ram_energy[i]))}` +
        ` = ${icon('zap')}<strong>E ${esc(energy(c.energy_consumed[i]))}</strong> × ${icon('factory')}${esc(gridText)}` +
        ` = ${icon('cloud')}<strong>${esc(emissions(basis.cumulative[i] * basis.factor))}</strong></p>`;
      parts.push(`<section><h2>${icon('zap')}Energy &amp; emissions</h2>${flow}${table(
        ['Metric', `Total, ep ${range}`, 'Mean per episode', 'Lowest episode', 'Highest episode', `Total, all ${fmtInt(run.n)}`],
        rows, 'numeric')}</section>`);
    }

    const svgs = {
      energy: sections.has('energyCharts') ? renderSvg(GreenRLCharts.timeSeries, specs.energy.opts, 860, 260) : '',
      emissions: sections.has('energyCharts') ? renderSvg(GreenRLCharts.timeSeries, specs.emissions.opts, 420, 220) : '',
      duration: sections.has('energyCharts') ? renderSvg(GreenRLCharts.timeSeries, specs.duration.opts, 420, 220) : '',
      country: sections.has('countries') ? renderSvg(GreenRLCharts.countryMap, specs.country.opts, 860, 440) : '',
      distance: sections.has('distanceChart') ? renderSvg(GreenRLCharts.timeSeries, specs.distance.opts, 860, 320) : '',
      energyLegend: legendHtml(specs.energy.legend),
      distanceLegend: legendHtml(specs.distance.legend)
    };

    if (sections.has('energyCharts')) {
      parts.push(`<section><h2>${icon('chart-line')}Energy charts</h2>
        ${figure(specs.energy.title, specs.energy.caption, svgs.energyLegend, svgs.energy)}
        <div class="two-up">${figure(specs.emissions.title, specs.emissions.caption, '', svgs.emissions)}${figure(specs.duration.title, '', '', svgs.duration)}</div>
      </section>`);
    }

    if (sections.has('countries')) {
      const ranked = [...specs.country.opts.countries].sort((a, b) => a.value - b.value);
      const unit = specs.country.opts.unit;
      const row = (title, c) => [title, c ? c.name : '—', c ? formatValue(c.intensity) : '—', c ? `${formatValue(c.value)} ${unit}` : '—'];
      const selected = ranked.find(c => c.iso === specs.country.opts.selected);
      const rows = [
        ...(selected ? [row('Selected', selected)] : []),
        row('Lowest', ranked[0]),
        row('Median', ranked[Math.floor(ranked.length / 2)]),
        row('Highest', ranked[ranked.length - 1])
      ];
      const lo = ranked[0], hi = ranked[ranked.length - 1];
      parts.push(`<section><h2>${icon('globe')}Emissions by country</h2>
        ${figure('Emissions of this run in every country', specs.country.caption.replace(/ Click a country.*$/, ''), '', svgs.country)}
        ${table(['', 'Country', 'C (g CO₂eq/kWh)', `Emissions, ep ${range}`], rows, 'numeric')}
        <p>${esc(d3.format(',.0f')(hi.value / lo.value))}× more CO₂eq in ${esc(hi.name)} than in ${esc(lo.name)}, for the same run.</p>
      </section>`);
    }

    if (sections.has('everyday')) {
      const ev = specs.everyday;
      const Eq = GreenRLEquivalents;
      const cards = ev.groups.map(g => `<h3>${g.flag ? flagImg(g.flag) : ''}${esc(g.title)}</h3><div class="eq-grid">${g.items.map(it =>
        `<div class="eq-card ${g.basis}">${Eq.iconHtml(it.eq, g.basis)}<div><strong>${esc(it.value)}</strong>` +
        `<span>${esc(it.label)} [${it.source}]</span></div></div>`).join('')}</div>`).join('');
      const projection = `<table class="numeric eq-table"><thead><tr><th></th>${ev.columns.map(c =>
        `<th>${icon(c.icon)}${esc(c.label)} <span class="times">${esc(c.times)}</span></th>`).join('')}</tr></thead><tbody>` +
        ev.rows.map(r => `<tr><td>${Eq.iconHtml(r.eq)}${esc(r.label)}${r.source ? ` [${r.source}]` : ''}</td>` +
          r.cells.map(c => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      parts.push(`<section><h2>${icon('lightbulb')}In everyday terms</h2>
        <p>${esc(ev.scope)}</p>
        ${cards}
        <h3>${icon('calendar-range')}If you ran this every day</h3>
        ${projection}
        <ol class="sources">${ev.sources.map(s =>
          `<li value="${s.n}"><a href="${esc(s.url)}">${esc(s.name)}</a> (retrieved ${esc(ev.retrieved)})</li>`).join('')}</ol>
      </section>`);
    }

    if (sections.has('performanceSummary')) {
      const c = run.cumulative;
      const dist = columnStats(run.cols.distance, episode);
      parts.push(`<section><h2>${icon('trophy')}Performance</h2>${kv([
        ['Best distance', formatValue(run.bestSoFar[i])],
        ['Found at', at(bestIdx)],
        ['Gap to optimum', instance?.optimum ? `${gapText(run.bestSoFar[i])} (optimum ${fmtInt(instance.optimum)})` : '—'],
        [`Distance at episode ${epLabel(i)}`, formatValue(run.cols.distance[i])],
        ['Mean distance', formatValue(dist.mean)],
        ['Episodes that set a new best', fmtInt(d3.bisectRight(run.improvements, i))],
        ['Time until best was found', bestIdx >= 0 ? durationText(c.duration[bestIdx]) : '—'],
        ['Energy until best was found', bestIdx >= 0 ? energy(c.energy_consumed[bestIdx]) : '—'],
        [`Emissions until best was found (${basis.label})`, bestIdx >= 0 ? emissions(basis.cumulative[bestIdx] * basis.factor) : '—']
      ])}</section>`);
    }

    if (sections.has('distanceChart')) {
      parts.push(`<section><h2>${icon('route')}Distance</h2>${figure('Distance per episode', specs.distance.caption, svgs.distanceLegend, svgs.distance)}</section>`);
    }

    if (sections.has('improvements')) {
      const list = run.improvements.slice(0, d3.bisectRight(run.improvements, i));
      const shown = list.slice(-MAX_IMPROVEMENT_ROWS);
      const rows = shown.map(k => [epLabel(k), formatValue(run.cols.distance[k]), gapText(run.cols.distance[k]),
        durationText(run.cumulative.duration[k]), energy(run.cumulative.energy_consumed[k])]);
      parts.push(`<section><h2>${icon('trending-down')}History of new best distances</h2>
        ${list.length > shown.length ? `<p>Showing the last ${fmtInt(shown.length)} of ${fmtInt(list.length)} improvements.</p>` : ''}
        ${table(['Episode', 'Distance', 'Gap to optimum', 'Elapsed time', 'Energy used so far'], rows, 'numeric')}
      </section>`);
    }

    const generated = new Date().toLocaleString();
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ECOVIS report · ${esc(run.id)}</title>
<style>${REPORT_CSS}</style></head>
<body><main>
<header>
  <div class="eyebrow">ECOVIS · experiment report</div>
  <h1>${esc(algorithm)} on ${esc(config.instance)} · seed ${esc(config.seed)}</h1>
  <p>Episodes ${range} (${fmtInt(episode)} of ${fmtInt(run.n)}) · ${ctx.mode === 'cumulative' ? 'cumulative' : 'per-episode'} charts · emissions for ${basis.flag ? flagImg(basis.flag) : ''}${esc(basis.label)} · generated ${esc(generated)}</p>
</header>
${parts.join('\n')}
<footer>Generated by ECOVIS from pre-computed results · ECOVIS by Samara Santos, based on the first version by Laís C. Medeiros and Samara Santos.</footer>
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
    :root { --text:#2f3a26; --muted:#676b5c; --line:#e6dec6; --grid:#efe8d5; --axis:#cdc5ab; --soft:#e5efd2; --panel:#fffaee; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #d2dfb6; color: var(--text); font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; font-size: 14.5px; }
    main { max-width: 920px; margin: 0 auto; padding: 28px 30px 40px; background: var(--panel); }
    header { padding: 22px 24px; border-radius: 14px; background: #d2dfb6; margin-bottom: 18px; }
    .flag { width: 18px; height: 13.5px; vertical-align: -2px; margin-right: 5px; border-radius: 2px; }
    .eyebrow { font-size: 12.5px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
    h1 { margin: 6px 0 4px; font-size: 26px; }
    header p { margin: 0; color: var(--muted); }
    h2 { font-size: 18px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--soft); }
    section { break-inside: avoid-page; }
    p { line-height: 1.5; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 7px 8px; border-bottom: 1px solid var(--grid); text-align: left; vertical-align: top; }
    thead th { color: var(--muted); font-weight: 650; font-size: 13px; }
    table.numeric td:not(:first-child), table.numeric th:not(:first-child) { text-align: right; }
    table.kv th { width: 38%; color: var(--muted); font-weight: 500; }
    table.kv td { font-weight: 600; }
    figure { margin: 0 0 16px; break-inside: avoid; }
    figcaption strong { display: block; font-size: 15px; }
    figcaption span { display: block; color: var(--muted); font-size: 13.5px; margin: 2px 0 4px; }
    .two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    svg { max-width: 100%; height: auto; display: block; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 13.5px; margin: 2px 0 4px; }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .key { display: inline-block; width: 14px; height: 3px; border-radius: 2px; }
    .axis text { fill: var(--muted); font-size: 12px; }
    .axis path, .axis line { stroke: var(--axis); }
    .grid-line { stroke: var(--grid); }
    .ref-line { stroke: var(--muted); opacity: .7; }
    .ref-label, .end-label, .best-marker text { fill: var(--text); font-size: 12.5px; font-weight: 600; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
    .ref-label { fill: var(--muted); font-weight: 500; }
    .axis-line { stroke: var(--axis); }
    .axis-note { fill: var(--muted); font-size: 12px; }
    .crosshair { stroke: var(--muted); }
    h3 { font-size: 15.5px; margin: 18px 0 8px; }
    .sources { font-size: 13px; color: var(--muted); padding-left: 20px; line-height: 1.6; }
    .sources a { color: var(--text); }
    svg.icon { display: inline-block; width: 1.25em; height: 1.25em; max-width: none; vertical-align: -0.17em; margin-right: 6px; color: #4f8a34; flex: none; }
    .flow { color: var(--text); background: var(--soft); padding: 10px 12px; border-radius: 10px; line-height: 1.9; }
    .flow svg.icon { margin: 0 3px 0 0; }
    .legend-title { fill: var(--text); font-size: 13px; font-weight: 600; }
    .faint { opacity: .75; }
    .eq-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
    .eq-card { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; break-inside: avoid; }
    .eq-card strong { display: block; font-size: 15.5px; }
    .eq-card span { color: var(--muted); font-size: 13px; }
    .eq-icon { position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 50%; background: #e5efd2; color: #355f22; margin-right: 8px; vertical-align: middle; }
    .eq-card .eq-icon { margin-right: 0; }
    .eq-icon.emissions { background: #e4ecef; color: #34586b; }
    .eq-icon svg.icon { margin: 0; width: 20px; height: 20px; color: inherit; }
    .eq-badge { position: absolute; right: -4px; bottom: -4px; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 1px solid var(--line); display: inline-flex; align-items: center; justify-content: center; }
    .eq-badge svg.icon { width: 10px; height: 10px; }
    .times { color: var(--muted); font-weight: 500; }
    .eq-table td:first-child { white-space: nowrap; }
    footer { margin-top: 30px; color: var(--muted); font-size: 12.5px; text-align: center; }
    @page { margin: 14mm; }
    @media print { body { background: #fff; } main { padding: 0; max-width: none; } header, .eq-icon, .flow, .eq-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  return { build, download, print };
})();

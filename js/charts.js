// D3 charts, all flat 2D: time series over episodes and the world emissions map.
// Colours come from the CSS custom properties in css/style.css.
window.GreenRLCharts = (() => {
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Flag image (flag-icons, MIT) for an ISO 3166-1 alpha-2 code.
  const flagUrl = code => (code ? `https://cdn.jsdelivr.net/npm/flag-icons@7.2.3/flags/4x3/${code}.svg` : null);

  function formatValue(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (Number.isInteger(v) && a < 1e9) return d3.format(',')(v);  // distances: exact
    if (a >= 1e6 || a < 1e-2) return d3.format('.3~e')(v);
    return d3.format(',.4~r')(v);
  }

  // SI prefixes, so small amounts read as 20.2 J or 1.63 mg instead of 5.6e-6 kWh.
  const PREFIXES = [[1e-9, 'n'], [1e-6, 'µ'], [1e-3, 'm'], [1, ''], [1e3, 'k'], [1e6, 'M'], [1e9, 'G']];

  // The prefix that puts |v| between 1 and 1000: { factor, symbol }.
  function siPrefix(v) {
    const a = Math.abs(v);
    if (!Number.isFinite(a) || a === 0) return { factor: 1, symbol: '' };
    let pick = PREFIXES[0];
    PREFIXES.forEach(p => { if (a >= p[0]) pick = p; });
    return { factor: pick[0], symbol: pick[1] };
  }

  // A value in a base unit (J, Wh, g, s) with the prefix that suits it: formatSI(0.0203, 'J') = '20.3 mJ'.
  function formatSI(v, unit) {
    if (v == null || !Number.isFinite(v)) return '—';
    const { factor, symbol } = siPrefix(v);
    return `${formatValue(v / factor)} ${symbol}${unit}`;
  }

  function tickFormat(max) {
    const f = Math.abs(max) >= 1e6 || Math.abs(max) < 1e-2 ? d3.format('.1~e') : d3.format(',~g');
    return v => (v === 0 ? '0' : f(v));
  }

  // Reduce values[0..end) to `count` buckets: mean/min/max for noisy series, last value for
  // cumulative or monotonic ones. Keeps long runs drawable at ~1 point per 2px.
  function bucketize(values, end, count, scale) {
    const size = end / count;
    const out = [];
    for (let b = 0; b < count; b++) {
      const start = Math.floor(b * size);
      const stop = Math.max(start + 1, Math.floor((b + 1) * size));
      let sum = 0, n = 0, min = Infinity, max = -Infinity, last = NaN;
      for (let i = start; i < stop; i++) {
        const v = values[i] * scale;
        if (Number.isNaN(v)) continue;
        sum += v; n++; last = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (n) out.push({ x: (start + stop - 1) / 2 + 1, xEnd: stop, mean: sum / n, min, max, last });
    }
    return out;
  }

  function legend(el, items) {
    const root = typeof el === 'string' ? document.querySelector(el) : el;
    root.replaceChildren();
    items.forEach(item => {
      const span = document.createElement('span');
      const key = document.createElement('i');
      key.className = `key ${item.shape || 'line'}`;
      key.style.setProperty('--key-color', token(item.color));
      span.append(key, document.createTextNode(item.label));
      root.appendChild(span);
    });
  }

  function makeTooltip(el) {
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.hidden = true;
    el.appendChild(tip);
    return tip;
  }

  function fillTooltip(tip, title, rows, flag) {
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-title';
    if (flag) {
      const img = document.createElement('img');
      img.className = 'flag';
      img.alt = '';
      img.src = flagUrl(flag);
      head.appendChild(img);
    }
    head.append(title);
    tip.appendChild(head);
    rows.forEach(row => {
      const line = document.createElement('div');
      line.className = 'tip-row';
      const key = document.createElement('i');
      key.className = 'key line';
      key.style.setProperty('--key-color', row.color);
      const value = document.createElement('strong');
      value.textContent = row.value;
      const label = document.createElement('span');
      label.textContent = row.label;
      line.append(key, value, label);
      tip.appendChild(line);
    });
  }

  /**
   * Line chart over episodes 1..end.
   * opts.series: [{ label, color (CSS var), values (Float64Array, 0-based by episode),
   *                 kind: 'band' (mean line + min/max wash) | 'last' (value at bucket end),
   *                 curve: 'step' | 'linear', unit, endLabel (print the last value next to its dot),
   *                 scale (extra factor for this series only) }]
   * opts.scale, opts.zeroBased, opts.refLine {value,label}, opts.marker {episode,value,label}
   * opts.yLabel: y-axis title (the x axis is always "Episode"); opts.interactive: false draws a
   * still chart without the hover layer (the small charts that are buttons).
   * The chart fills its container (its CSS height), or opts.height when the container has none.
   * Episodes are passed as positions 1..end; opts.base is the number displayed for position 1
   * (0 when the source data counts episodes from 0).
   */
  function timeSeries(el, opts) {
    el.querySelectorAll('svg, .chart-tooltip').forEach(node => node.remove());
    const width = Math.max(el.clientWidth || 600, 260);
    const height = el.clientHeight || opts.height || 240;
    const m = { top: 16, right: 20, bottom: 46, left: opts.yLabel ? 80 : 64 };
    const end = Math.max(1, opts.end);
    const shift = (opts.base ?? 1) - 1;  // position -> displayed episode number
    const scale = opts.scale || 1;
    const count = Math.min(end, Math.max(20, Math.floor((width - m.left - m.right) / 2)));
    const surface = token('--panel');

    const sets = opts.series.map(s => {
      const sc = scale * (s.scale ?? 1);
      return { ...s, sc, colorValue: token(s.color), pts: bucketize(s.values, end, count, sc) };
    });

    let lo = Infinity, hi = -Infinity;
    sets.forEach(s => s.pts.forEach(p => {
      const a = s.kind === 'band' ? p.min : p.last;
      const b = s.kind === 'band' ? p.max : p.last;
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }));
    if (opts.refLine && Number.isFinite(opts.refLine.value)) {
      lo = Math.min(lo, opts.refLine.value);
      hi = Math.max(hi, opts.refLine.value);
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (opts.zeroBased) lo = Math.min(0, lo);
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;

    const x = d3.scaleLinear().domain([1 + shift, Math.max(end, 10) + shift]).range([m.left, width - m.right]);
    const y = d3.scaleLinear()
      .domain([opts.zeroBased ? lo : lo - pad, hi + pad]).nice()
      .range([height - m.bottom, m.top]);

    const svg = d3.select(el).append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', width).attr('height', height)
      .attr('role', 'img')
      .attr('aria-label', opts.ariaLabel || '');

    svg.append('g').selectAll('line').data(y.ticks(5)).join('line')
      .attr('class', 'grid-line')
      .attr('x1', m.left).attr('x2', width - m.right)
      .attr('y1', d => y(d)).attr('y2', d => y(d));

    svg.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${height - m.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.min(6, Math.floor(width / 90))).tickFormat(d3.format(',d')).tickSizeOuter(0));
    svg.append('g').attr('class', 'axis axis-y')
      .attr('transform', `translate(${m.left},0)`)
      .call(d3.axisLeft(y).ticks(height < 200 ? 3 : 5).tickFormat(tickFormat(y.domain()[1])).tickSize(0).tickPadding(8))
      .call(g => g.select('.domain').remove());

    // Axis titles: episodes along x, the measured quantity (with its unit) up the y axis.
    svg.append('text').attr('class', 'axis-title')
      .attr('x', m.left + (width - m.left - m.right) / 2).attr('y', height - 6).attr('text-anchor', 'middle')
      .text('Episode');
    if (opts.yLabel) {
      svg.append('text').attr('class', 'axis-title')
        .attr('transform', `translate(14,${m.top + (height - m.top - m.bottom) / 2}) rotate(-90)`)
        .attr('text-anchor', 'middle').text(opts.yLabel);
    }

    if (opts.refLine && Number.isFinite(opts.refLine.value)) {
      const ry = y(opts.refLine.value);
      svg.append('line').attr('class', 'ref-line')
        .attr('x1', m.left).attr('x2', width - m.right).attr('y1', ry).attr('y2', ry);
      // Below the line, right-aligned: distances never go under the optimum, so that space is free.
      const below = ry + 14 <= height - m.bottom - 2;
      svg.append('text').attr('class', 'ref-label')
        .attr('x', width - m.right).attr('y', below ? ry + 14 : ry - 5).attr('text-anchor', 'end')
        .text(opts.refLine.label);
    }

    const bucketed = end / count > 1;
    sets.forEach(s => {
      if (s.kind === 'band' && bucketed) {
        svg.append('path').datum(s.pts)
          .attr('fill', s.colorValue).attr('opacity', 0.2)
          .attr('d', d3.area().x(p => x(p.x + shift)).y0(p => y(p.min)).y1(p => y(p.max)));
      }
      const key = s.kind === 'band' ? 'mean' : 'last';
      const px = s.kind === 'band' ? (p => x(p.x + shift)) : (p => x(p.xEnd + shift));
      svg.append('path').datum(s.pts)
        .attr('fill', 'none').attr('stroke', s.colorValue)
        .attr('stroke-width', s.width || 2.25).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
        .attr('d', d3.line().x(px).y(p => y(p[key]))
          .curve(s.curve === 'step' ? d3.curveStepAfter : d3.curveLinear));
    });

    // Current-episode end dots (pastel marks sit below 3:1 contrast, so single series also
    // print their value as text).
    sets.forEach(s => {
      const v = s.values[end - 1] * s.sc;
      if (!Number.isFinite(v)) return;
      svg.append('circle').attr('cx', x(end + shift)).attr('cy', y(v)).attr('r', 4)
        .attr('fill', s.colorValue).attr('stroke', surface).attr('stroke-width', 2);
      if (s.endLabel) {
        svg.append('text').attr('class', 'end-label')
          .attr('x', x(end + shift) - 8).attr('y', Math.max(m.top + 10, y(v) - 10)).attr('text-anchor', 'end')
          .text(formatValue(v) + (s.unit ? ` ${s.unit}` : ''));
      }
    });

    if (opts.marker && Number.isFinite(opts.marker.value)) {
      const mx = x(opts.marker.episode + shift), my = y(opts.marker.value);
      const g = svg.append('g').attr('class', 'best-marker');
      g.append('circle').attr('cx', mx).attr('cy', my).attr('r', 6)
        .attr('fill', token(opts.marker.color)).attr('stroke', surface).attr('stroke-width', 2);
      const right = mx > width - 190;
      g.append('text').attr('x', right ? mx - 10 : mx + 10).attr('y', my + 18)
        .attr('text-anchor', right ? 'end' : 'start').text(opts.marker.label);
    }

    if (opts.interactive === false) return;

    // Hover layer: crosshair snaps to the nearest episode and the tooltip lists every series.
    const tip = makeTooltip(el);
    const hover = svg.append('g').attr('class', 'hover-layer').style('display', 'none');
    hover.append('line').attr('class', 'crosshair').attr('y1', m.top).attr('y2', height - m.bottom);
    const dots = sets.map(s => hover.append('circle').attr('r', 4)
      .attr('fill', s.colorValue).attr('stroke', surface).attr('stroke-width', 2));

    function show(episode) {
      episode = Math.max(1, Math.min(end, Math.round(episode)));
      el.__hoverEpisode = episode;
      const cx = x(episode + shift);
      hover.style('display', null);
      hover.select('.crosshair').attr('x1', cx).attr('x2', cx);
      const rows = [];
      sets.forEach((s, k) => {
        const v = s.values[episode - 1] * s.sc;
        dots[k].attr('cx', cx).attr('cy', Number.isFinite(v) ? y(v) : -99);
        rows.push({ label: s.label, color: s.colorValue, value: formatValue(v) + (s.unit ? ` ${s.unit}` : '') });
      });
      fillTooltip(tip, `Episode ${d3.format(',')(episode + shift)}`, rows);
      tip.hidden = false;
      const tipWidth = tip.offsetWidth;
      tip.style.left = `${cx + 14 + tipWidth > width ? cx - tipWidth - 14 : cx + 14}px`;
      tip.style.top = `${m.top}px`;
    }
    function hide() {
      el.__hoverEpisode = null;
      hover.style('display', 'none');
      tip.hidden = true;
    }

    svg.append('rect').attr('class', 'hit-area')
      .attr('x', m.left).attr('y', m.top)
      .attr('width', width - m.left - m.right).attr('height', height - m.top - m.bottom)
      .attr('tabindex', 0)
      .on('pointermove', event => show(x.invert(d3.pointer(event)[0]) - shift))
      .on('pointerleave', hide)
      .on('blur', hide)
      .on('focus', () => show(el.__hoverEpisode || end))
      .on('keydown', event => {
        const step = event.shiftKey ? 100 : 1;
        if (event.key === 'ArrowLeft') { show((el.__hoverEpisode || end) - step); event.preventDefault(); }
        if (event.key === 'ArrowRight') { show((el.__hoverEpisode || end) + step); event.preventDefault(); }
      });

    if (el.__hoverEpisode) show(el.__hoverEpisode);
  }

  // Map colours: one step per 100 g CO2eq/kWh of grid carbon intensity. Lightness falls evenly
  // from mint (clean grid) to plum (carbon-intensive), so the order also reads without colour vision.
  const MAP_BINS = [100, 200, 300, 400, 500, 600, 700];
  const MAP_COLORS = ['#e8f7ec', '#f1f0c0', '#f7dc9c', '#f4c086', '#ee9f84', '#e08392', '#c56c97', '#985a8c'];
  // Colour-blind palette: yellow to bluish green to blue (Okabe–Ito hues), lightness still falling evenly.
  const MAP_COLORS_CVD = d3.quantize(d3.piecewise(d3.interpolateLab, ['#F0E442', '#009E73', '#0072B2']), 8);
  const mapColors = () => (document.documentElement.dataset.palette === 'cvd' ? MAP_COLORS_CVD : MAP_COLORS);
  const NO_DATA = '#d3dbd7';
  let worldCache = null;
  let mapCount = 0;

  // Country shapes from data/world.js (Natural Earth), built once.
  function world() {
    if (!worldCache) {
      const src = window.GREEN_RL_WORLD || { shapes: [], points: [] };
      worldCache = {
        shapes: src.shapes.map(s => ({ type: 'Feature', id: s.iso, properties: { name: s.name },
          geometry: { type: 'MultiPolygon', coordinates: s.polygons } })),
        points: src.points
      };
    }
    return worldCache;
  }

  /**
   * World map of the emissions this run would have produced on each country's grid
   * (value = energy × carbon intensity). Countries too small for the map are drawn as dots.
   * opts.countries: [{ iso, flag, name, intensity (g/kWh), value }], opts.selected: iso | null,
   * opts.perIntensity: value per g/kWh (labels the legend in emissions), opts.unit,
   * opts.onSelect(iso): optional, makes countries clickable.
   */
  function countryMap(el, opts) {
    el.querySelectorAll('svg, .chart-tooltip').forEach(node => node.remove());
    const width = Math.max(el.clientWidth || 600, 260);
    const height = opts.height || el.clientHeight || 440;
    const legendHeight = 64;
    const { shapes, points } = world();
    const byIso = new Map(opts.countries.map(c => [c.iso, c]));
    const colors = mapColors();
    const color = d3.scaleThreshold().domain(MAP_BINS).range(colors);
    const unit = opts.unit ? ` ${opts.unit}` : '';
    const ink = token('--text');
    const surface = token('--panel');
    const hatchId = `map-nodata-${++mapCount}`;

    const projection = d3.geoEqualEarth()
      .fitExtent([[4, 4], [width - 4, height - legendHeight - 6]], { type: 'FeatureCollection', features: shapes });
    const path = d3.geoPath(projection);

    const svg = d3.select(el).append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
      .attr('role', 'img').attr('aria-label', opts.ariaLabel || 'Emissions by country');
    const hatch = svg.append('defs').append('pattern').attr('id', hatchId)
      .attr('width', 5).attr('height', 5).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(45)');
    hatch.append('rect').attr('width', 5).attr('height', 5).attr('fill', '#f4f6f5');
    hatch.append('line').attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 5).attr('stroke', NO_DATA).attr('stroke-width', 1.5);
    const fill = iso => (byIso.has(iso) ? color(byIso.get(iso).intensity) : `url(#${hatchId})`);

    const tip = makeTooltip(el);
    const clickable = typeof opts.onSelect === 'function';
    function hover(event, iso, name) {
      const c = byIso.get(iso);
      fillTooltip(tip, c ? c.name : name, c ? [
        { label: 'emissions of this run', color: color(c.intensity), value: `${formatValue(c.value)}${unit}` },
        { label: 'g CO₂eq/kWh (grid)', color: color(c.intensity), value: formatValue(c.intensity) }
      ] : [{ label: 'no carbon intensity data', color: NO_DATA, value: '—' }], c?.flag);
      if (c && clickable && iso !== opts.selected) {
        const hint = document.createElement('div');
        hint.className = 'tip-hint';
        hint.textContent = 'Click to use this grid';
        tip.appendChild(hint);
      }
      tip.hidden = false;
      const [px, py] = d3.pointer(event, el);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = `${px + 16 + tw > width ? px - tw - 16 : px + 16}px`;
      tip.style.top = `${Math.max(0, Math.min(height - legendHeight - th, py - th / 2))}px`;
    }
    const leave = () => { tip.hidden = true; };
    const pick = iso => { if (clickable && byIso.has(iso) && iso !== opts.selected) opts.onSelect(iso); };

    svg.append('g').selectAll('path').data(shapes).join('path')
      .attr('class', d => `map-shape${clickable && byIso.has(d.id) ? ' clickable' : ''}`)
      .attr('d', path).attr('fill', d => fill(d.id))
      .attr('stroke', surface).attr('stroke-width', 0.6)
      .on('pointermove', (event, d) => hover(event, d.id, d.properties.name))
      .on('pointerleave', leave)
      .on('click', (event, d) => pick(d.id));

    const dots = points.map(p => ({ ...p, xy: projection([p.lon, p.lat]) })).filter(p => p.xy);
    svg.append('g').selectAll('circle').data(dots).join('circle')
      .attr('class', d => `map-dot${clickable && byIso.has(d.iso) ? ' clickable' : ''}`)
      .attr('cx', d => d.xy[0]).attr('cy', d => d.xy[1]).attr('r', 3.2)
      .attr('fill', d => fill(d.iso)).attr('stroke', token('--muted')).attr('stroke-width', 0.7)
      .on('pointermove', (event, d) => hover(event, d.iso, d.iso))
      .on('pointerleave', leave)
      .on('click', (event, d) => pick(d.iso));

    // Selected country: thick outline (or a ring for a dot) and a label with its value.
    const selected = byIso.get(opts.selected);
    if (selected) {
      const shape = shapes.find(s => s.id === selected.iso);
      const dot = dots.find(d => d.iso === selected.iso);
      let anchor = null;
      if (shape) {
        svg.append('path').attr('d', path(shape)).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 2)
          .attr('pointer-events', 'none');
        anchor = path.centroid(shape);
      } else if (dot) {
        svg.append('circle').attr('cx', dot.xy[0]).attr('cy', dot.xy[1]).attr('r', 7).attr('fill', 'none')
          .attr('stroke', ink).attr('stroke-width', 2).attr('pointer-events', 'none');
        anchor = dot.xy;
      }
      if (anchor && Number.isFinite(anchor[0])) {
        const right = anchor[0] > width - 220;
        svg.append('text').attr('class', 'end-label')
          .attr('x', anchor[0] + (right ? -12 : 12)).attr('y', anchor[1] - 10)
          .attr('text-anchor', right ? 'end' : 'start').attr('pointer-events', 'none')
          .text(`${selected.name}: ${formatValue(selected.value)}${unit}`);
      }
    }

    // Legend: one swatch per step, labelled in emissions (top) and grid carbon intensity (bottom).
    const lg = svg.append('g').attr('class', 'map-legend').attr('transform', `translate(8,${height - legendHeight + 10})`);
    const sw = Math.max(30, Math.min(70, (width - 170) / colors.length));
    lg.append('text').attr('class', 'legend-title').attr('x', 0).attr('y', 0)
      .text(`Emissions of this run${opts.unit ? ` (${opts.unit})` : ''} · darker = more CO₂ for the same energy`);
    colors.forEach((c, k) => {
      lg.append('rect').attr('x', k * sw).attr('y', 7).attr('width', sw - 2).attr('height', 12).attr('rx', 2)
        .attr('fill', c).attr('stroke', NO_DATA).attr('stroke-width', 0.5);
    });
    MAP_BINS.forEach((b, k) => {
      const x = (k + 1) * sw - 1;
      if (opts.perIntensity) {
        lg.append('text').attr('class', 'axis-note').attr('x', x).attr('y', 34).attr('text-anchor', 'middle')
          .text(formatValue(b * opts.perIntensity));
      }
      lg.append('text').attr('class', 'axis-note faint').attr('x', x).attr('y', 50).attr('text-anchor', 'middle').text(b);
    });
    lg.append('text').attr('class', 'axis-note faint').attr('x', colors.length * sw + 4).attr('y', 50).text('g CO₂eq/kWh');
    const nd = lg.append('g').attr('transform', `translate(${colors.length * sw + 10},7)`);
    nd.append('rect').attr('width', 18).attr('height', 12).attr('rx', 2).attr('fill', `url(#${hatchId})`)
      .attr('stroke', NO_DATA).attr('stroke-width', 0.5);
    nd.append('text').attr('class', 'axis-note').attr('x', 24).attr('y', 10).text('no data');
  }

  return { timeSeries, countryMap, legend, formatValue, formatSI, siPrefix, flagUrl };
})();

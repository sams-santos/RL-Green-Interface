window.GreenRLCharts = (() => {
  const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function formatValue(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1e6 || a < 1e-2) return d3.format('.3~e')(v);
    return d3.format(',.4~r')(v);
  }

  function tickFormat(max) {
    const f = Math.abs(max) >= 1e6 || Math.abs(max) < 1e-2 ? d3.format('.1~e') : d3.format(',~g');
    return v => (v === 0 ? '0' : f(v));
  }

  // Reduce values[0..end) to `count` buckets: mean/min/max for noisy series, last value for
  // cumulative or monotonic ones. Keeps 10,000 episodes drawable at ~1 point per 2px.
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

  function fillTooltip(tip, title, rows) {
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-title';
    head.textContent = title;
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
   *                 curve: 'step' | 'linear', unit, endLabel (print the last value next to its dot) }]
   * opts.scale, opts.zeroBased, opts.refLine {value,label}, opts.marker {episode,value,label}
   */
  function timeSeries(el, opts) {
    el.querySelectorAll('svg, .chart-tooltip').forEach(node => node.remove());
    const width = Math.max(el.clientWidth || 600, 260);
    const height = opts.height || 240;
    const m = { top: 16, right: 20, bottom: 28, left: 64 };
    const end = Math.max(1, opts.end);
    const scale = opts.scale || 1;
    const count = Math.min(end, Math.max(20, Math.floor((width - m.left - m.right) / 2)));
    const surface = token('--panel');

    const sets = opts.series.map(s => ({
      ...s, colorValue: token(s.color), pts: bucketize(s.values, end, count, scale)
    }));

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

    const x = d3.scaleLinear().domain([1, Math.max(end, 10)]).range([m.left, width - m.right]);
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
      .call(d3.axisLeft(y).ticks(5).tickFormat(tickFormat(y.domain()[1])).tickSize(0).tickPadding(8))
      .call(g => g.select('.domain').remove());

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
          .attr('d', d3.area().x(p => x(p.x)).y0(p => y(p.min)).y1(p => y(p.max)));
      }
      const key = s.kind === 'band' ? 'mean' : 'last';
      const px = s.kind === 'band' ? (p => x(p.x)) : (p => x(p.xEnd));
      svg.append('path').datum(s.pts)
        .attr('fill', 'none').attr('stroke', s.colorValue)
        .attr('stroke-width', s.width || 2.25).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round')
        .attr('d', d3.line().x(px).y(p => y(p[key]))
          .curve(s.curve === 'step' ? d3.curveStepAfter : d3.curveLinear));
    });

    // Current-episode end dots (pastel marks sit below 3:1 contrast, so single series also
    // print their value as text).
    sets.forEach(s => {
      const v = s.values[end - 1] * scale;
      if (!Number.isFinite(v)) return;
      svg.append('circle').attr('cx', x(end)).attr('cy', y(v)).attr('r', 4)
        .attr('fill', s.colorValue).attr('stroke', surface).attr('stroke-width', 2);
      if (s.endLabel) {
        svg.append('text').attr('class', 'end-label')
          .attr('x', x(end) - 8).attr('y', Math.max(m.top + 10, y(v) - 10)).attr('text-anchor', 'end')
          .text(formatValue(v) + (s.unit ? ` ${s.unit}` : ''));
      }
    });

    if (opts.marker && Number.isFinite(opts.marker.value)) {
      const mx = x(opts.marker.episode), my = y(opts.marker.value);
      const g = svg.append('g').attr('class', 'best-marker');
      g.append('circle').attr('cx', mx).attr('cy', my).attr('r', 6)
        .attr('fill', token(opts.marker.color)).attr('stroke', surface).attr('stroke-width', 2);
      const right = mx > width - 190;
      g.append('text').attr('x', right ? mx - 10 : mx + 10).attr('y', my + 18)
        .attr('text-anchor', right ? 'end' : 'start').text(opts.marker.label);
    }

    // Hover layer: crosshair snaps to the nearest episode and the tooltip lists every series.
    const tip = makeTooltip(el);
    const hover = svg.append('g').attr('class', 'hover-layer').style('display', 'none');
    hover.append('line').attr('class', 'crosshair').attr('y1', m.top).attr('y2', height - m.bottom);
    const dots = sets.map(s => hover.append('circle').attr('r', 4)
      .attr('fill', s.colorValue).attr('stroke', surface).attr('stroke-width', 2));

    function show(episode) {
      episode = Math.max(1, Math.min(end, Math.round(episode)));
      el.__hoverEpisode = episode;
      const cx = x(episode);
      hover.style('display', null);
      hover.select('.crosshair').attr('x1', cx).attr('x2', cx);
      const rows = [];
      sets.forEach((s, k) => {
        const v = s.values[episode - 1] * scale;
        dots[k].attr('cx', cx).attr('cy', Number.isFinite(v) ? y(v) : -99);
        rows.push({ label: s.label, color: s.colorValue, value: formatValue(v) + (s.unit ? ` ${s.unit}` : '') });
      });
      fillTooltip(tip, `Episode ${d3.format(',')(episode)}`, rows);
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
      .on('pointermove', event => show(x.invert(d3.pointer(event)[0])))
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

  /**
   * Tour map. TSP instances use their TSPLIB coordinates; ATSP instances have none, so their
   * nodes are placed on a circle in index order.
   */
  function routeChart(el, opts) {
    el.replaceChildren();
    const width = Math.max(el.clientWidth || 600, 260);
    const height = opts.height || 380;
    const pad = 22;
    const inst = opts.instance;
    if (!inst) return;
    const n = inst.dimension;

    let points;
    if (inst.coords) {
      const xs = inst.coords.map(c => c[0]), ys = inst.coords.map(c => c[1]);
      const [x0, x1] = d3.extent(xs), [y0, y1] = d3.extent(ys);
      const k = Math.min((width - 2 * pad) / (x1 - x0 || 1), (height - 2 * pad) / (y1 - y0 || 1));
      const ox = (width - (x1 - x0) * k) / 2, oy = (height - (y1 - y0) * k) / 2;
      points = inst.coords.map(([cx, cy]) => [ox + (cx - x0) * k, height - (oy + (cy - y0) * k)]);
    } else {
      const r = Math.min(width, height) / 2 - pad;
      points = d3.range(n).map(i => {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        return [width / 2 + r * Math.cos(a), height / 2 + r * Math.sin(a)];
      });
    }

    const svg = d3.select(el).append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height)
      .attr('role', 'img').attr('aria-label', opts.ariaLabel || 'Tour map');
    const surface = token('--panel');
    const closed = path => {
      const valid = (path || []).filter(i => i >= 0 && i < n);
      if (!valid.length) return null;
      return valid[0] === valid[valid.length - 1] ? valid : valid.concat(valid[0]);
    };
    const line = d3.line().x(i => points[i][0]).y(i => points[i][1]);

    const best = opts.showBest ? closed(opts.best) : null;
    if (best) {
      svg.append('path').attr('d', line(best)).attr('fill', 'none')
        .attr('stroke', token('--series-2')).attr('stroke-width', 6).attr('opacity', 0.45)
        .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    }
    const current = closed(opts.current);
    if (current) {
      svg.append('path').attr('d', line(current)).attr('fill', 'none')
        .attr('stroke', token(opts.currentColor || '--series-1')).attr('stroke-width', inst.coords ? 2 : 1.25)
        .attr('opacity', inst.coords ? 1 : 0.8)
        .attr('stroke-linejoin', 'round');
    }

    const radius = n > 100 ? 2.5 : 3.5;
    svg.append('g').selectAll('circle').data(points).join('circle')
      .attr('cx', p => p[0]).attr('cy', p => p[1]).attr('r', radius)
      .attr('fill', surface).attr('stroke', token('--muted')).attr('stroke-width', 1.25)
      .append('title').text((p, i) => `Node ${i}`);

    if (current) {
      const s = points[current[0]];
      svg.append('circle').attr('cx', s[0]).attr('cy', s[1]).attr('r', 6)
        .attr('fill', token('--text')).attr('stroke', surface).attr('stroke-width', 2);
      svg.append('text').attr('class', 'route-label').attr('x', s[0] + 9).attr('y', s[1] - 8)
        .text(`start (${current[0]})`);
    }
  }

  return { timeSeries, routeChart, legend, formatValue };
})();

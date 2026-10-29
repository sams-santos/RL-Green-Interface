// ECOVIS score, following the index scaling, compound scoring and rating of Fischer et al.
// (ECML PKDD 2022 workshops, doi:10.1007/978-3-031-23618-1_3) as refined in STREP
// (Fischer, Liebig & Morik, Data Min Knowl Disc 2024, doi:10.1007/s10618-024-01020-3).
// The comparison set is every run on the same instance (same task, data and environment).
//  * Index of each property (both are minimised): p = best value on the instance / value, in (0, 1]
//    (STREP Eq. 1); 1 = the best result observed. Properties: tour length and total energy.
//  * Compound score P = (1 - w) * p_tour + w * p_energy (STREP Eq. 2); by default w = 0.5, so the
//    quality and resource groups count the same, as in STREP.
//  * Ratings A-E: five bins with boundaries at the 20/40/60/80 % quantiles of all values of that
//    index (or of P) on the instance (Fischer et al. 2022, Sect. 2.3; STREP Sect. 4).
// The letter is always printed, so the colour is never needed alone.
window.GreenRLScores = (() => {
  const { PARAMS, valueKey } = GreenRLConfig;
  const GRADES = [
    { letter: 'A', color: 'var(--grade-a)', ink: 'var(--grade-a-ink)' },
    { letter: 'B', color: 'var(--grade-b)', ink: 'var(--grade-b-ink)' },
    { letter: 'C', color: 'var(--grade-c)', ink: 'var(--grade-c-ink)' },
    { letter: 'D', color: 'var(--grade-d)', ink: 'var(--grade-d-ink)' },
    { letter: 'E', color: 'var(--grade-e)', ink: 'var(--grade-e-ink)' }
  ];
  const QUANTILES = [0.2, 0.4, 0.6, 0.8];
  const tables = new Map();   // instance -> Promise<table>
  const pending = new Map();  // instance -> resolve
  let weight = 0.5;           // weight of energy in P (0 = tour only, 1 = energy only)

  // Quantile with linear interpolation between order statistics (sorted ascending input).
  function quantile(sorted, q) {
    const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.min(lo + 1, sorted.length - 1);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  const boundariesOf = values => {
    const sorted = Float64Array.from(values).sort();
    return QUANTILES.map(q => quantile(sorted, q));
  };
  // Higher index = better: at or above the 80 % boundary is A, below the 20 % boundary is E.
  const rate = (value, bounds) => GRADES[4 - bounds.filter(b => value >= b).length];

  function prepare(raw) {
    const order = raw.order.map(key => PARAMS.find(p => p.key === key));
    const sizes = order.map(p => p.values.length);
    const present = raw.best.map((b, k) => (b != null && raw.energy[k] != null ? k : -1)).filter(k => k >= 0);
    const refBest = Math.min(...present.map(k => raw.best[k]));
    const refEnergy = Math.min(...present.map(k => raw.energy[k]));
    const tourIndex = new Float64Array(raw.best.length).fill(NaN);
    const energyIndex = new Float64Array(raw.best.length).fill(NaN);
    present.forEach(k => {
      tourIndex[k] = refBest / raw.best[k];
      energyIndex[k] = refEnergy / raw.energy[k];
    });
    const indexOf = config => {
      let k = 0;
      for (let d = 0; d < order.length; d++) {
        const p = order[d];
        const i = p.values.findIndex(v => valueKey(p, v) === valueKey(p, config[p.key]));
        if (i < 0) return -1;
        k = k * sizes[d] + i;
      }
      return k;
    };
    const configAt = k => {
      const c = { instance: raw.instance };
      for (let d = order.length - 1; d >= 0; d--) {
        c[order[d].key] = order[d].values[k % sizes[d]];
        k = Math.floor(k / sizes[d]);
      }
      return c;
    };
    const compound = k => (1 - weight) * tourIndex[k] + weight * energyIndex[k];
    const cache = { weight: null, bounds: null };
    return {
      raw, indexOf, configAt, present, refBest, refEnergy, tourIndex, energyIndex, compound, n: present.length,
      tourBounds: boundariesOf(present.map(k => tourIndex[k])),
      energyBounds: boundariesOf(present.map(k => energyIndex[k])),
      // Boundaries of P depend on the weight, so they are recomputed when it changes.
      scoreBounds() {
        if (cache.weight !== weight) {
          cache.weight = weight;
          cache.bounds = boundariesOf(present.map(compound));
        }
        return cache.bounds;
      }
    };
  }

  function registerSummaries(raw) {
    const resolve = pending.get(raw.instance);
    if (!resolve) return;
    pending.delete(raw.instance);
    resolve(prepare(raw));
  }

  function load(instance) {
    if (!tables.has(instance)) {
      tables.set(instance, new Promise((resolve, reject) => {
        pending.set(instance, resolve);
        const script = document.createElement('script');
        script.src = `data/summaries/${instance}.js`;
        script.onload = () => script.remove();
        script.onerror = () => { script.remove(); tables.delete(instance); reject(new Error(`Could not load data/summaries/${instance}.js.`)); };
        document.head.appendChild(script);
      }));
    }
    return tables.get(instance);
  }

  // Indices, compound score and ratings of one run (null when the run is not in the table).
  function scoreOf(table, config) {
    const k = table.indexOf(config);
    if (k < 0 || Number.isNaN(table.tourIndex[k])) return null;
    const tour = table.tourIndex[k], energyIdx = table.energyIndex[k], score = table.compound(k);
    return {
      best: table.raw.best[k], energy: table.raw.energy[k], refBest: table.refBest, refEnergy: table.refEnergy,
      tour, energyIdx, score,
      grade: rate(score, table.scoreBounds()),
      tourGrade: rate(tour, table.tourBounds),
      energyGrade: rate(energyIdx, table.energyBounds),
      n: table.n
    };
  }

  // The run with the highest compound score among those matching `filter(config)`.
  function top(table, filter = () => true) {
    let bestK = -1, bestScore = -1;
    table.present.forEach(k => {
      const s = table.compound(k);
      if (s > bestScore && filter(table.configAt(k))) { bestScore = s; bestK = k; }
    });
    return bestK < 0 ? null : { config: table.configAt(bestK), ...scoreOf(table, table.configAt(bestK)) };
  }

  // ---------- Views shared by the Explore and Compare tabs ----------

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const fmt = v => (v >= 100 ? d3.format(',')(v) : d3.format('.3~r')(v));
  // The compound score P in (0, 1] is shown as 100 × P.
  const points = s => Math.round(s * 100);

  // A-E ladder, bars widening towards E, with an arrow on the run's grade.
  function ladder(current, caption) {
    const box = el('div', 'grade-ladder');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${caption}: grade ${current.letter}`);
    GRADES.forEach((g, i) => {
      const row = el('div', `grade-row${g === current ? ' current' : ''}`);
      const bar = el('span', 'grade-bar', g.letter);
      bar.style.background = g.color;
      bar.style.color = g.ink;
      bar.style.width = `${40 + i * 13}%`;
      row.appendChild(bar);
      if (g === current) row.appendChild(el('span', 'grade-arrow', g.letter));
      box.appendChild(row);
    });
    return box;
  }

  // An index in (0, 1] as a bar, with its rating letter and a sentence.
  function meter(iconName, label, index, rating, sentence) {
    const row = el('div', 'meter');
    const head = el('div', 'meter-head');
    const letter = el('span', 'score-letter small', rating.letter);
    letter.style.background = rating.color;
    letter.style.color = rating.ink;
    head.append(GreenRLIcons.el(iconName), el('span', null, label), el('strong', null, index.toFixed(2)), letter);
    const track = el('div', 'meter-track');
    const fill = el('span');
    fill.style.width = `${index * 100}%`;
    fill.style.background = rating.color;
    track.appendChild(fill);
    row.append(head, track, el('small', null, sentence));
    return row;
  }

  // Score card: big score, its rating on the A-E ladder, and the two indices behind it.
  function card(s, { title, keyColor, instance, compact }) {
    const box = el('div', `score-card${compact ? ' compact' : ''}`);
    const head = el('div', 'score-head');
    if (title) {
      const h = el('h4');
      if (keyColor) { const key = el('i', 'key line'); key.style.setProperty('--key-color', keyColor); h.appendChild(key); }
      h.append(title);
      head.appendChild(h);
    }
    const big = el('div', 'score-big');
    const badge = el('span', 'score-letter', s.grade.letter);
    badge.style.background = s.grade.color;
    badge.style.color = s.grade.ink;
    big.append(el('strong', null, points(s.score)), el('span', null, '/100'), badge);
    head.appendChild(big);
    head.appendChild(el('small', 'score-sub', `ECOVIS score · rated against ${s.n.toLocaleString('en')} runs on ${instance}`));
    const body = el('div', 'score-body');
    body.append(
      ladder(s.grade, 'ECOVIS score'),
      el('div', 'meters')
    );
    body.lastChild.append(
      meter('route', 'Tour index', s.tour, s.tourGrade,
        s.tour >= 1 ? `the shortest tour on ${instance}` : `tour ${fmt(1 / s.tour)}× the shortest on ${instance} (${fmt(s.refBest)})`),
      meter('zap', 'Energy index', s.energyIdx, s.energyGrade,
        s.energyIdx >= 1 ? `the lowest energy on ${instance}` : `${fmt(1 / s.energyIdx)}× the lowest energy on ${instance}`)
    );
    box.append(head, body);
    return box;
  }

  // Slider for the energy share of the score; onChange re-renders the views.
  function weightControl(onChange) {
    const box = el('div', 'weight-control');
    const id = `weight-${Math.random().toString(36).slice(2, 8)}`;
    const label = el('label', null, 'What matters more?');
    label.htmlFor = id;
    const input = el('input');
    input.type = 'range'; input.min = 0; input.max = 100; input.step = 10; input.id = id;
    input.value = Math.round(weight * 100);
    const text = el('span', 'weight-text');
    const describe = v => `${100 - v}% tour · ${v}% energy`;
    text.textContent = describe(input.value);
    // Both tabs have a control; moving one moves the other.
    input.addEventListener('input', () => {
      weight = input.value / 100;
      document.querySelectorAll('.weight-control').forEach(c => {
        c.querySelector('input').value = input.value;
        c.querySelector('.weight-text').textContent = describe(input.value);
      });
      onChange();
    });
    const row = el('div', 'weight-row');
    row.append(el('span', null, 'Tour'), input, el('span', null, 'Energy'));
    box.append(label, row, text);
    return box;
  }

  return {
    GRADES, registerSummaries, load, scoreOf, top, points,
    view: { card, ladder, weightControl },
    get weight() { return weight; },
    set weight(w) { weight = Math.min(1, Math.max(0, w)); }
  };
})();

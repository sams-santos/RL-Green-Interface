// Loads pre-computed runs (data/runs/<id>.js) on demand and derives the series the views need.
// Run files call GreenRL.registerRun({...}); loading them with <script> keeps the page working
// when index.html is opened straight from disk (no web server, no fetch/CORS).
window.GreenRL = (() => {
  const METRICS = ['duration', 'emissions', 'cpu_energy', 'ram_energy', 'energy_consumed', 'distance'];
  const CUMULATIVE = ['duration', 'emissions', 'cpu_energy', 'ram_energy', 'energy_consumed'];
  const cache = new Map();
  const pending = new Map();

  function decode(column, n) {
    const out = new Float64Array(n).fill(NaN);
    if (!column) return out;
    const scale = column.scale || 1;
    if (column.rle) {
      let i = 0;
      for (let k = 0; k < column.rle.length && i < n; k += 2) {
        const value = column.rle[k] == null ? NaN : column.rle[k] * scale;
        for (let c = 0; c < column.rle[k + 1] && i < n; c++) out[i++] = value;
      }
    } else {
      const data = column.data || [];
      for (let i = 0; i < Math.min(n, data.length); i++) out[i] = data[i] == null ? NaN : data[i] * scale;
    }
    return out;
  }

  function prepare(raw) {
    const n = raw.episodes;
    const cols = {};
    METRICS.forEach(key => { cols[key] = decode(raw.columns[key], n); });

    const cumulative = {};
    CUMULATIVE.forEach(key => {
      const out = new Float64Array(n);
      let total = 0;
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(cols[key][i])) total += cols[key][i];
        out[i] = total;
      }
      cumulative[key] = out;
    });

    // minIdx[key][i] = index of the lowest value among episodes 0..i (first occurrence).
    const minIdx = {};
    METRICS.forEach(key => {
      const values = cols[key];
      const out = new Int32Array(n);
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (!Number.isNaN(values[i]) && (best < 0 || values[i] < values[best])) best = i;
        out[i] = best;
      }
      minIdx[key] = out;
    });

    const bestSoFar = new Float64Array(n);
    const improvements = [];
    for (let i = 0; i < n; i++) {
      const b = minIdx.distance[i];
      bestSoFar[i] = b < 0 ? NaN : cols.distance[b];
      if (b === i) improvements.push(i);
    }

    const pathIndex = decode(raw.pathIndex, n);
    const parsed = new Map();
    function path(i) {
      const p = pathIndex[i];
      if (Number.isNaN(p) || raw.paths[p] == null) return null;
      if (!parsed.has(p)) parsed.set(p, raw.paths[p].split(' ').map(Number));
      return parsed.get(p);
    }

    return {
      id: raw.id, config: raw.config, demo: !!raw.demo, units: raw.units, n,
      cols, cumulative, minIdx, bestSoFar, improvements, path
    };
  }

  function registerRun(raw) {
    const run = prepare(raw);
    cache.set(raw.id, run);
    const waiting = pending.get(raw.id);
    if (waiting) {
      pending.delete(raw.id);
      waiting.resolve(run);
    }
  }

  function loadRun(id) {
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    if (pending.has(id)) return pending.get(id).promise;
    const entry = {};
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    pending.set(id, entry);

    const script = document.createElement('script');
    script.src = `data/runs/${encodeURIComponent(id)}.js`;
    script.onload = () => {
      script.remove();
      if (pending.get(id) === entry) {
        pending.delete(id);
        entry.reject(new Error(`data/runs/${id}.js did not register a run with that id.`));
      }
    };
    script.onerror = () => {
      script.remove();
      pending.delete(id);
      entry.reject(new Error(`Could not load data/runs/${id}.js.`));
    };
    document.head.appendChild(script);
    return entry.promise;
  }

  return { registerRun, loadRun, METRICS };
})();

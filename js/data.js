// Loads the dataset on demand and derives the series the views need.
// Runs come in shards (data/runs/<algorithm>/<instance>/<reward>_<decay>_e<eps0>_s<seed>.js), each
// with the 64 alpha x gamma runs of one setting. Shard files call GreenRL.registerShard({...});
// loading them with <script> keeps the page working when index.html is opened from disk.
// Their per-episode columns are zlib-compressed; DecompressionStream unpacks them.
window.GreenRL = (() => {
  const manifest = window.GREEN_RL_MANIFEST || { grid: {}, shards: [], epsilon: {} };
  const CUMULATIVE = ['duration', 'emissions', 'cpu_energy', 'ram_energy', 'energy_consumed'];
  const MAX_SHARDS = 12;          // decoded shards kept in memory
  const shards = new Map();       // id -> Promise<shard>
  const pending = new Map();      // id -> { resolve, reject } while its script loads
  const shardSet = new Set(manifest.shards);
  const has = (key, value) => (manifest.grid[key] || []).some(v => Math.abs(v - value) < 1e-6);

  // Must match shard_id() in tools/build_dataset.py.
  const shardId = c => `${c.algorithm}/${c.instance}/${c.reward}_${c.epsilon_decay}_e${c.epsilon_init.toFixed(2)}_s${c.seed}`;
  const available = c => !!c && shardSet.has(shardId(c)) && has('gamma', c.gamma) && has('alpha', c.alpha);

  // The epsilon of every episode: the same for all runs with this decay and initial epsilon.
  const epsilonCurve = c => manifest.epsilon[`${c.epsilon_decay}_${c.epsilon_init.toFixed(2)}`] || null;

  async function unpack(base64) {
    const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the data (no DecompressionStream). Use a current Chrome, Edge, Firefox or Safari.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new DataView(await new Response(stream).arrayBuffer());
  }

  // Columns are stored one after the other (distance, duration, CPU, RAM), each with every run.
  function decodeColumns(raw, view) {
    const n = raw.episodes;
    const steps = raw.levels - 1;
    let offset = 0;
    const cols = raw.runs.map(() => ({}));
    raw.runs.forEach((r, k) => {
      const [lo, wide] = r.distance;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = lo + (wide ? view.getUint32(offset, true) : view.getUint16(offset, true));
        offset += wide ? 4 : 2;
      }
      cols[k].distance = out;
    });
    [['duration', 'duration'], ['cpu', 'cpu_energy'], ['ram', 'ram_energy']].forEach(([field, key]) => {
      raw.runs.forEach((r, k) => {
        const [lo, hi] = r[field];
        const span = lo > 0 && hi > lo ? Math.log(hi / lo) : 0;
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++, offset += 2) {
          const q = view.getUint16(offset, true);
          out[i] = q === 0 ? 0 : lo * Math.exp(((q - 1) / steps) * span);
        }
        cols[k][key] = out;
      });
    });
    return cols;
  }

  function prepare(raw, r, cols) {
    const n = raw.episodes;
    const config = {
      algorithm: raw.algorithm, instance: raw.instance, epsilon_decay: raw.epsilon_decay, reward: raw.reward,
      gamma: r.gamma, alpha: r.alpha, epsilon_init: raw.epsilon_init, seed: raw.seed
    };
    const intensity = r.summary.intensity;  // g CO2eq/kWh used when measuring
    cols.energy_consumed = cols.cpu_energy.map((v, i) => v + cols.ram_energy[i]);
    cols.emissions = cols.energy_consumed.map(v => v * intensity / 1000);
    cols.epsilon = Float64Array.from(epsilonCurve(config) || [], Number);

    const cumulative = {};
    CUMULATIVE.forEach(key => {
      const out = new Float64Array(n);
      let total = 0;
      for (let i = 0; i < n; i++) out[i] = (total += cols[key][i]);
      cumulative[key] = out;
    });

    // bestIdx[i] = index of the shortest tour among episodes 0..i (first occurrence).
    const bestIdx = new Int32Array(n);
    const bestSoFar = new Float64Array(n);
    const improvements = [];
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (best < 0 || cols.distance[i] < cols.distance[best]) {
        best = i;
        improvements.push(i);
      }
      bestIdx[i] = best;
      bestSoFar[i] = cols.distance[best];
    }

    return {
      id: GreenRLConfig.runId(config), config, n,
      firstEpisode: raw.firstEpisode,
      carbonIntensity: intensity,
      measurement: r.summary.measurement || {},
      summary: r.summary,      // exact totals from the summary file
      cols, cumulative, bestIdx, bestSoFar, improvements
    };
  }

  async function decodeShard(raw) {
    const cols = decodeColumns(raw, await unpack(raw.data));
    const runs = new Map();
    return {
      id: raw.id,
      // Summaries of the 64 runs, for the alpha x gamma grid.
      cells: raw.runs.map(r => ({ gamma: r.gamma, alpha: r.alpha, summary: r.summary })),
      run(gamma, alpha) {
        const k = raw.runs.findIndex(r => Math.abs(r.gamma - gamma) < 1e-6 && Math.abs(r.alpha - alpha) < 1e-6);
        if (k < 0) return null;
        if (!runs.has(k)) runs.set(k, prepare(raw, raw.runs[k], cols[k]));
        return runs.get(k);
      }
    };
  }

  function registerShard(raw) {
    const waiting = pending.get(raw.id);
    if (!waiting) return;
    pending.delete(raw.id);
    decodeShard(raw).then(waiting.resolve, waiting.reject);
  }

  function loadShard(config) {
    const id = shardId(config);
    if (shards.has(id)) {
      const promise = shards.get(id);
      shards.delete(id);
      shards.set(id, promise);  // most recently used last
      return promise;
    }
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const script = document.createElement('script');
      script.src = `data/runs/${id}.js`;
      script.onload = () => {
        script.remove();
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`data/runs/${id}.js did not register that shard.`));
        }
      };
      script.onerror = () => {
        script.remove();
        pending.delete(id);
        reject(new Error(`Could not load data/runs/${id}.js.`));
      };
      document.head.appendChild(script);
    });
    promise.catch(() => shards.delete(id));
    shards.set(id, promise);
    while (shards.size > MAX_SHARDS) shards.delete(shards.keys().next().value);
    return promise;
  }

  async function loadRun(id) {
    const config = GreenRLConfig.parseRunId(id);
    if (!available(config)) throw new Error(`No run ${id} in the dataset.`);
    const run = (await loadShard(config)).run(config.gamma, config.alpha);
    if (!run) throw new Error(`data/runs/${shardId(config)}.js has no run with γ = ${config.gamma}, α = ${config.alpha}.`);
    return run;
  }

  return { manifest, registerShard, loadShard, loadRun, available, epsilonCurve };
})();

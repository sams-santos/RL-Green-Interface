// Experiment grid offered by the playground. Must match tools/build_dataset.py.
window.GreenRLConfig = (() => {
  const grid = [0.01, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.99];

  const PARAMS = [
    {
      key: 'algorithm', label: 'Algorithm',
      values: ['sarsa', 'q-learning', 'double-qlearning'],
      names: { 'sarsa': 'SARSA', 'q-learning': 'Q-learning', 'double-qlearning': 'Double Q-learning' }
    },
    // Instances = the TSPLIB files in data/instances (see tools/build_reference.py).
    { key: 'instance', label: 'Instance', values: Object.keys((window.GREEN_RL_REFERENCE || {}).instances || {}) },
    // Runs that do not record their decay schedule are stored as "unknown".
    { key: 'epsilon_decay', label: 'Epsilon decay', values: ['linear', 'convex', 'concave', 'step', 'fixed'] },
    { key: 'reward', label: 'Reward', values: ['R1', 'R2', 'R3'] },
    { key: 'gamma', label: 'Gamma (γ)', values: grid, numeric: true },
    { key: 'alpha', label: 'Alpha (α)', values: grid, numeric: true },
    { key: 'epsilon_init', label: 'Initial epsilon (ε₀)', values: [0.01, 0.05, 0.10], numeric: true },
    // Seeds (repetitions) come only from the data.
    { key: 'seed', label: 'Seed (repetition)', values: [], integer: true }
  ];

  const valueKey = (param, value) =>
    (param.integer ? String(Math.round(value)) : param.numeric ? Number(value).toFixed(2) : String(value));
  const displayValue = (param, value) => (param.names && param.names[value]) || valueKey(param, value);

  function runId(c) {
    return `${c.algorithm}_${c.instance}_${c.epsilon_decay}_${c.reward}` +
      `_g${c.gamma.toFixed(2)}_a${c.alpha.toFixed(2)}_e${c.epsilon_init.toFixed(2)}_s${c.seed}`;
  }

  function parseRunId(id) {
    const m = /^([a-z-]+)_([A-Za-z0-9]+)_([a-z]+)_(R\d)_g([\d.]+)_a([\d.]+)_e([\d.]+)_s(\d+)$/.exec(id || '');
    if (!m) return null;
    return {
      algorithm: m[1], instance: m[2], epsilon_decay: m[3], reward: m[4],
      gamma: Number(m[5]), alpha: Number(m[6]), epsilon_init: Number(m[7]), seed: Number(m[8])
    };
  }

  // Add any value present in the dataset but missing from the grid (e.g. seeds, or an
  // epsilon decay recorded as "unknown"), so every run can be selected.
  function extendWithDataset(runIds) {
    const configs = runIds.map(parseRunId).filter(Boolean);
    PARAMS.forEach(param => {
      const known = new Set(param.values.map(v => valueKey(param, v)));
      const extra = [];
      configs.forEach(c => {
        const key = valueKey(param, c[param.key]);
        if (!known.has(key)) { known.add(key); extra.push(c[param.key]); }
      });
      extra.sort((a, b) => (param.numeric || param.integer ? a - b : String(a).localeCompare(String(b))));
      param.values = param.values.concat(extra);
    });
  }

  return { PARAMS, valueKey, displayValue, runId, parseRunId, extendWithDataset };
})();

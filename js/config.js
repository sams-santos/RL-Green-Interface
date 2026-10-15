// Experiment parameters offered by the playground. The values come from the dataset
// (data/manifest.js, written by tools/build_dataset.py).
window.GreenRLConfig = (() => {
  const grid = (window.GREEN_RL_MANIFEST || {}).grid || {};

  const PARAMS = [
    {
      key: 'algorithm', label: 'Algorithm',
      names: { 'sarsa': 'SARSA', 'q-learning': 'Q-learning', 'double-qlearning': 'Double Q-learning' }
    },
    { key: 'instance', label: 'Instance' },
    { key: 'epsilon_decay', label: 'Epsilon decay' },
    { key: 'reward', label: 'Reward' },
    { key: 'gamma', label: 'Gamma (γ)', numeric: true },
    { key: 'alpha', label: 'Alpha (α)', numeric: true },
    { key: 'epsilon_init', label: 'Initial epsilon (ε₀)', numeric: true },
    { key: 'seed', label: 'Seed', integer: true }
  ].map(p => ({ ...p, values: grid[p.key] || [] }));

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

  return { PARAMS, valueKey, displayValue, runId, parseRunId };
})();

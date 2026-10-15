// Everyday equivalents for an amount of energy (kWh) or emissions (kg CO2eq).
// Factors and their sources come from data/equivalents.json (via data/reference.js).
window.GreenRLEquivalents = (() => {
  const data = (window.GREEN_RL_REFERENCE || {}).equivalents || { sources: {}, equivalents: [] };
  const sourceIds = Object.keys(data.sources);

  // Readable numbers without scientific notation: 1,234 · 12.3 · 0.38
  function num(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 100) return d3.format(',.0f')(v);
    if (a >= 1) return d3.format(',.3~r')(v);
    return d3.format('.2~r')(v);
  }

  function distance(km) {
    const m = km * 1000;
    if (m < 0.01) return `${num(m * 1000)} mm`;
    if (m < 1) return `${num(m * 100)} cm`;
    if (m < 1000) return `${num(m)} m`;
    return `${num(km)} km`;
  }

  function duration(hours) {
    const s = hours * 3600;
    if (s < 1) return `${num(s * 1000)} ms`;
    if (s < 60) return `${num(s)} s`;
    if (s < 3600) return `${num(s / 60)} min`;
    if (hours < 48) return `${num(hours)} h`;
    return `${num(hours / 24)} days`;
  }

  // amount is in kWh (energy) or kg CO2eq (emissions), matching eq.basis.
  // Returns { value, label }: e.g. { value: '43 cm', label: 'driven by an electric car' }.
  function describe(eq, amount) {
    const n = amount / eq.amount;
    if (eq.per === 'km') return { value: distance(n), label: eq.label };
    if (eq.per === 'hour') return { value: duration(n), label: eq.label };
    if (n >= 1) return { value: num(n), label: eq.plural };
    const pct = n * 100;
    return { value: pct < 0.01 ? '< 0.01%' : `${num(pct)}%`, label: `of one ${eq.singular}` };
  }

  // Pictogram for a comparison: its icon in a round tile, plus a small badge (e.g. electric vs petrol car).
  function iconHtml(eq, basis = eq.basis) {
    const badge = eq.badge ? `<span class="eq-badge">${GreenRLIcons.svg(eq.badge)}</span>` : '';
    return `<span class="eq-icon ${basis}">${GreenRLIcons.svg(eq.icon)}${badge}</span>`;
  }

  return {
    list: data.equivalents,
    iconHtml,
    retrieved: data.retrieved,
    byId: id => data.equivalents.find(e => e.id === id),
    sourceNumber: id => sourceIds.indexOf(id) + 1,
    sourceList: () => sourceIds.map((id, k) => ({ n: k + 1, ...data.sources[id] })),
    describe
  };
})();

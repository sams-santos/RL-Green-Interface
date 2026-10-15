// "Compare two runs" tab: two configurations side by side, a summary table and overlaid
// 2D line charts. Shared helpers and settings come from main.js through init().
window.GreenRLCompare = (() => {
  const $ = id => document.getElementById(id);
  const cmp = { a: null, b: null, runA: null, runB: null, upTo: null, token: 0 };
  let app = null;
  let syncA, syncB;

  function init(context, hashA, hashB) {
    app = context;
    cmp.a = hashA;
    cmp.b = hashB;
    syncA = app.configForm($('cmp-a-form'), 'cmp-a', () => cmp.a, onConfigChange);
    syncB = app.configForm($('cmp-b-form'), 'cmp-b', () => cmp.b, onConfigChange);
    $('cmp-range').addEventListener('input', e => { cmp.upTo = Number(e.target.value); render(); });
    $('cmp-all').addEventListener('click', () => { cmp.upTo = null; render(); });
  }

  // First visit: A = the run open in the Explore tab, B = the closest other run.
  function show(exploreConfig) {
    if (!cmp.a) cmp.a = { ...exploreConfig };
    if (!cmp.b) {
      const other = app.nearestRuns(cmp.a).find(r => r.diffs.length > 0);
      cmp.b = other ? other.config : { ...cmp.a };
    }
    onConfigChange();
  }

  function onConfigChange() {
    syncA();
    syncB();
    app.updateHash();
    load();
  }

  function load() {
    const ids = [app.runId(cmp.a), app.runId(cmp.b)];
    const missing = ids.map(id => !app.available.has(id));
    $('cmp-a-status').textContent = missing[0] ? '∅ No run with this combination.' : ids[0];
    $('cmp-b-status').textContent = missing[1] ? '∅ No run with this combination.' : ids[1];
    const token = ++cmp.token;
    if (missing[0] || missing[1]) {
      cmp.runA = cmp.runB = null;
      $('compare-body').hidden = true;
      $('compare-empty').hidden = false;
      $('compare-empty-text').textContent =
        `Run ${missing[0] && missing[1] ? 'A and run B are' : missing[0] ? 'A is' : 'B is'} not in the dataset. ` +
        'Options marked ∅ have no run for the other selected values.';
      return;
    }
    $('compare-body').classList.add('is-loading');
    Promise.all(ids.map(GreenRL.loadRun)).then(([a, b]) => {
      if (token !== cmp.token) return;
      cmp.runA = a;
      cmp.runB = b;
      $('compare-empty').hidden = true;
      $('compare-body').hidden = false;
      $('compare-body').classList.remove('is-loading');
      app.updateGridSettings();
      render();
    }).catch(err => {
      if (token !== cmp.token) return;
      $('compare-body').hidden = true;
      $('compare-empty').hidden = false;
      $('compare-empty-text').textContent = err.message;
    });
  }

  // "Reward: R1 · Seed: 42" - only the parameters where A and B differ.
  function differences(config, other) {
    const diffs = app.PARAMS.filter(p => app.valueKey(p, config[p.key]) !== app.valueKey(p, other[p.key]));
    return diffs.length ? diffs.map(p => `${p.label.replace(/ \(.*\)$/, '')} ${app.displayValue(p, config[p.key])}`).join(' · ')
      : 'same configuration';
  }

  function metrics(run, p) {
    const i = p - 1;
    const c = run.cumulative;
    const basis = app.emissionsBasis(run);
    const best = run.bestIdx[i];
    return {
      duration: c.duration[i],
      energy: c.energy_consumed[i],
      cpu: c.cpu_energy[i],
      ram: c.ram_energy[i],
      emissions: basis.cumulative[i] * basis.factor,
      bestDistance: run.bestSoFar[i],
      bestEpisode: best,
      timeToBest: c.duration[best],
      energyToBest: c.energy_consumed[best],
      emissionsToBest: basis.cumulative[best] * basis.factor,
      improvements: d3.bisectRight(run.improvements, i)
    };
  }

  function renderTable(p) {
    const { runA, runB } = cmp;
    const A = metrics(runA, p), B = metrics(runB, p);
    const country = app.emissionsBasis(runA).label;
    const rows = [
      ['Duration', 'duration', app.durationText, true, 'timer'],
      ['Total energy', 'energy', app.energyText, true, 'zap'],
      ['CPU energy', 'cpu', app.energyText, true, 'cpu'],
      ['RAM energy', 'ram', app.energyText, true, 'memory-stick'],
      [`Emissions (${app.settings.country === 'measured' ? 'as measured' : country})`, 'emissions', app.emissionsText, true, 'cloud'],
      ['Best distance', 'bestDistance', v => app.formatValue(v), true, 'trophy'],
      ['Gap to optimum', 'bestDistance', null, false, 'target'],
      ['Best found at episode', 'bestEpisode', null, false, 'map-pin'],
      ['Time until best', 'timeToBest', app.durationText, true, 'hourglass'],
      ['Energy until best', 'energyToBest', app.energyText, true, 'plug-zap'],
      ['Emissions until best', 'emissionsToBest', app.emissionsText, true, 'cloud'],
      ['Episodes that set a new best', 'improvements', v => app.fmtInt(v), false, 'trending-down']
    ];

    const head = document.createElement('tr');
    ['Metric', 'Run A', 'Run B', 'B vs A'].forEach(text => {
      const th = document.createElement('th');
      th.textContent = text;
      head.appendChild(th);
    });
    const body = rows.map(([label, key, fmt, comparable, icon]) => {
      const tr = document.createElement('tr');
      const cells = [label];
      if (label === 'Gap to optimum') {
        cells.push(app.gapText(runA, A[key]), app.gapText(runB, B[key]), '—');
      } else if (key === 'bestEpisode') {
        cells.push(app.epLabel(runA, A[key]), app.epLabel(runB, B[key]), '—');
      } else {
        const diff = A[key] ? `${d3.format('+.1f')(((B[key] - A[key]) / A[key]) * 100)}%` : '—';
        cells.push(fmt(A[key]), fmt(B[key]), comparable ? diff : d3.format('+,')(B[key] - A[key]));
      }
      cells.forEach((text, k) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (k === 0) td.prepend(GreenRLIcons.el(icon));
        const better = comparable && A[key] !== B[key] && ((k === 1 && A[key] < B[key]) || (k === 2 && B[key] < A[key]));
        if (better) {
          td.classList.add('better');
          td.textContent = `✓ ${text}`;
        }
        tr.appendChild(td);
      });
      return tr;
    });
    const thead = document.createElement('thead');
    thead.appendChild(head);
    const tbody = document.createElement('tbody');
    tbody.append(...body);
    $('compare-table').replaceChildren(thead, tbody);
  }

  function render() {
    if (!cmp.runA || !cmp.runB || $('tab-compare').hidden) return;
    const { runA, runB } = cmp;
    const max = Math.min(runA.n, runB.n);
    const p = Math.min(max, cmp.upTo ?? max);
    $('cmp-range').max = max;
    $('cmp-range').value = p;
    $('cmp-range-label').textContent = `${app.fmtInt(p)} / ${app.fmtInt(max)} episodes`;

    renderTable(p);

    const labelA = `A · ${differences(runA.config, runB.config)}`;
    const labelB = `B · ${differences(runB.config, runA.config)}`;
    const legend = [{ label: labelA, color: '--series-1' }, { label: labelB, color: '--series-2' }];
    document.querySelectorAll('.cmp-legend').forEach(el => GreenRLCharts.legend(el, legend));

    const base = runA.firstEpisode === runB.firstEpisode ? runA.firstEpisode : 1;
    const sameInstance = runA.config.instance === runB.config.instance;
    const optimum = sameInstance ? app.instances[runA.config.instance]?.optimum : null;
    const pair = (valuesA, valuesB, { a = {}, b = {}, ...common } = {}) => [
      { label: 'A', color: '--series-1', values: valuesA, ...common, ...a },
      { label: 'B', color: '--series-2', values: valuesB, ...common, ...b }
    ];

    GreenRLCharts.timeSeries($('cmp-best-chart'), {
      end: p, base, ariaLabel: 'Best distance so far, run A and run B',
      series: pair(runA.bestSoFar, runB.bestSoFar, { kind: 'last', curve: 'step' }),
      refLine: optimum ? { value: optimum, label: `optimum ${app.fmtInt(optimum)}` } : null
    });
    GreenRLCharts.timeSeries($('cmp-distance-chart'), {
      end: p, base, ariaLabel: 'Distance per episode, run A and run B',
      series: pair(runA.cols.distance, runB.cols.distance, { kind: 'band' })
    });

    const energyUnit = app.settings.energyUnit;
    $('cmp-energy-title').textContent = `Cumulative energy (${energyUnit})`;
    GreenRLCharts.timeSeries($('cmp-energy-chart'), {
      end: p, base, zeroBased: true, scale: app.ENERGY_UNITS[energyUnit], ariaLabel: 'Cumulative energy, run A and run B',
      series: pair(runA.cumulative.energy_consumed, runB.cumulative.energy_consumed, { kind: 'last', unit: energyUnit })
    });

    // Each run carries its own emissions basis (its measured C, or the selected country's).
    const basisA = app.emissionsBasis(runA), basisB = app.emissionsBasis(runB);
    const emissionsUnit = app.settings.emissionsUnit;
    $('cmp-emissions-title').textContent = `Cumulative emissions (${emissionsUnit} CO₂eq · ${basisA.label})`;
    GreenRLCharts.timeSeries($('cmp-emissions-chart'), {
      end: p, base, zeroBased: true, scale: app.EMISSION_UNITS[emissionsUnit], ariaLabel: 'Cumulative emissions, run A and run B',
      series: pair(basisA.cumulative, basisB.cumulative, {
        kind: 'last', unit: emissionsUnit, a: { scale: basisA.factor }, b: { scale: basisB.factor }
      })
    });
  }

  function hashParams() {
    return cmp.a && cmp.b ? { a: app.runId(cmp.a), b: app.runId(cmp.b) } : {};
  }

  function measuredCountry() {
    return app ? app.measuredCountry(cmp.runA) : null;
  }

  return { init, show, render, hashParams, measuredCountry };
})();

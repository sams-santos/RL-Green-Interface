// "Compare two runs" tab: two configurations side by side, a summary table and overlaid
// 2D line charts. Shared helpers and settings come from main.js through init().
window.GreenRLCompare = (() => {
  const $ = id => document.getElementById(id);
  const cmp = { a: null, b: null, runA: null, runB: null, upTo: null, token: 0, scoreToken: 0 };
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
    $('cmp-weight').appendChild(GreenRLScores.view.weightControl(renderScores));
    $('cmp-greenest').addEventListener('click', () => {
      if (!cmp.greenest) return;
      cmp.b = { ...cmp.greenest };
      onConfigChange();
    });
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
    $('cmp-a-status').textContent = missing[0] ? '∅ No run with this combination.' : '';
    $('cmp-b-status').textContent = missing[1] ? '∅ No run with this combination.' : '';
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
    renderScores();

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
      end: p, base, yLabel: 'Tour length', ariaLabel: 'Best distance so far, run A and run B',
      series: pair(runA.bestSoFar, runB.bestSoFar, { kind: 'last', curve: 'step' }),
      refLine: optimum ? { value: optimum, label: `optimum ${app.fmtInt(optimum)}` } : null
    });
    GreenRLCharts.timeSeries($('cmp-distance-chart'), {
      end: p, base, yLabel: 'Tour length', ariaLabel: 'Distance per episode, run A and run B',
      series: pair(runA.cols.distance, runB.cols.distance, { kind: 'band' })
    });

    // One unit per chart, chosen from the larger whole-run total so it stays put while the slider moves.
    const total = (run, values, factor = 1) => values[run.n - 1] * factor;
    const energy = app.energyAxis(Math.max(total(runA, runA.cumulative.energy_consumed), total(runB, runB.cumulative.energy_consumed)));
    $('cmp-energy-unit').textContent = energy.unit;
    GreenRLCharts.timeSeries($('cmp-energy-chart'), {
      end: p, base, zeroBased: true, scale: energy.scale, yLabel: `Energy (${energy.unit})`,
      ariaLabel: 'Cumulative energy, run A and run B',
      series: pair(runA.cumulative.energy_consumed, runB.cumulative.energy_consumed, { kind: 'last', unit: energy.unit })
    });

    // Each run carries its own emissions basis (its measured C, or the selected country's).
    const basisA = app.emissionsBasis(runA), basisB = app.emissionsBasis(runB);
    const emissions = app.emissionsAxis(Math.max(total(runA, basisA.cumulative, basisA.factor), total(runB, basisB.cumulative, basisB.factor)));
    $('cmp-emissions-title').textContent = `Cumulative emissions · ${basisA.label}`;
    $('cmp-emissions-unit').textContent = `${emissions.unit} CO₂eq`;
    GreenRLCharts.timeSeries($('cmp-emissions-chart'), {
      end: p, base, zeroBased: true, scale: emissions.scale, yLabel: `Emissions (${emissions.unit} CO₂eq)`,
      ariaLabel: 'Cumulative emissions, run A and run B',
      series: pair(basisA.cumulative, basisB.cumulative, {
        kind: 'last', unit: emissions.unit, a: { scale: basisA.factor }, b: { scale: basisB.factor }
      })
    });
  }

  // ECOVIS score of both runs, a verdict, and a shortcut to the greenest run.
  function renderScores() {
    const { runA, runB } = cmp;
    if (!runA || !runB) return;
    const S = GreenRLScores;
    const token = ++cmp.scoreToken;
    Promise.all([S.load(runA.config.instance), S.load(runB.config.instance)]).then(([tableA, tableB]) => {
      if (token !== cmp.scoreToken) return;
      const a = S.scoreOf(tableA, runA.config), b = S.scoreOf(tableB, runB.config);
      if (!a || !b) return;
      const algo = c => app.displayValue(app.PARAMS[0], c.algorithm);
      $('cmp-scores').replaceChildren(
        S.view.card(a, { title: `Run A · ${algo(runA.config)}`, keyColor: 'var(--series-1)', instance: runA.config.instance }),
        S.view.card(b, { title: `Run B · ${algo(runB.config)}`, keyColor: 'var(--series-2)', instance: runB.config.instance })
      );
      renderVerdict(a, b);

      // Greenest run on A's instance (with the current weighting), other than A itself.
      const idA = app.runId(runA.config);
      const greenest = S.top(tableA, c => app.runId(c) !== idA);
      cmp.greenest = greenest && greenest.config;
      $('cmp-greenest').hidden = !greenest || app.runId(greenest.config) === app.runId(runB.config);
      if (greenest) {
        $('cmp-greenest-label').textContent = `Compare A with the greenest run on ${runA.config.instance} ` +
          `(${algo(greenest.config)}, score ${S.points(greenest.score)})`;
      }

    }).catch(() => {});
  }

  function renderVerdict(a, b) {
    const { runA, runB } = cmp;
    const box = $('cmp-verdict');
    const same = runA.config.instance === runB.config.instance;
    const percent = v => `${Math.round(Math.abs(v) * 100)}%`;
    const strong = text => { const s = document.createElement('strong'); s.textContent = text; return s; };
    const parts = [];
    let tone = 'trade';
    if (!same) {
      parts.push('A and B are on different instances, so each score ranks its run on its own instance.');
    } else {
      const dE = (b.energy - a.energy) / a.energy, dT = (b.best - a.best) / a.best;
      const [win, lose, winE, winT] = b.score >= a.score ? ['B', 'A', -dE, -dT] : ['A', 'B', dE, dT];
      if (winE > 0 && winT > 0) {
        tone = 'win';
        parts.push(strong(`${win} is the greener choice`), `: it uses ${percent(winE)} less energy and finds a ${percent(winT)} shorter tour than ${lose}.`);
      } else if (Math.abs(a.score - b.score) < 0.005) {
        parts.push(strong('A tie'), ': both runs score the same with this weighting.');
      } else {
        parts.push(strong(`Trade-off, ${win} scores higher`), winE > 0
          ? `: it uses ${percent(winE)} less energy, but its tour is ${percent(winT)} longer.`
          : `: its tour is ${percent(winT)} shorter, but it uses ${percent(winE)} more energy.`);
      }
      // What the energy difference adds up to when the run is repeated every day for a year.
      const saving = Math.abs(a.energy - b.energy) * 365;
      const lower = a.energy < b.energy ? 'A' : 'B';
      const phone = GreenRLEquivalents.byId('smartphone');
      if (saving > 0 && phone) {
        const { value, label } = GreenRLEquivalents.describe(phone, saving);
        parts.push(` Run once a day for a year, choosing ${lower} saves ${app.energyText(saving)} (${value} ${label}).`);
      }
    }
    box.className = `verdict ${tone}`;
    box.replaceChildren(GreenRLIcons.el(tone === 'win' ? 'leaf' : 'scale'), Object.assign(document.createElement('p'), {}));
    box.lastChild.append(...parts);
  }

  function hashParams() {
    return cmp.a && cmp.b ? { a: app.runId(cmp.a), b: app.runId(cmp.b) } : {};
  }

  function measuredCountry() {
    return app ? app.measuredCountry(cmp.runA) : null;
  }

  return { init, show, render, hashParams, measuredCountry };
})();

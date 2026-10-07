(() => {
  const { PARAMS, valueKey, displayValue, runId, parseRunId } = GreenRLConfig;
  const { formatValue } = GreenRLCharts;
  const manifest = window.GREEN_RL_MANIFEST || { runs: [] };
  const instances = window.GREEN_RL_INSTANCES || {};
  const available = new Set(manifest.runs);

  const ENERGY_UNITS = { kWh: 1, Wh: 1e3, J: 3.6e6 };
  const EMISSION_UNITS = { kg: 1, g: 1e3, mg: 1e6 };
  const SPEEDS = [10, 50, 100, 250, 500, 1000, 2500];
  const TICK_MS = 100;

  const $ = id => document.getElementById(id);
  const fmtInt = d3.format(',');

  const state = {
    config: null,
    run: null,
    episode: 1,
    timer: null,
    carry: 0,
    speed: 250,
    mode: 'episode',
    energyUnit: 'kWh',
    emissionsUnit: 'kg',
    showBest: true,
    loadToken: 0
  };

  // ---------- Setup ----------

  function initialConfig() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const fromHash = parseRunId(hash.get('run'));
    if (fromHash) {
      const ep = Number(hash.get('ep'));
      if (ep > 0) state.episode = ep;
      return fromHash;
    }
    if (manifest.runs.length) return parseRunId(manifest.runs[0]);
    return Object.fromEntries(PARAMS.map(p => [p.key, p.values[0]]));
  }

  function buildConfigForm() {
    const form = $('config-form');
    PARAMS.forEach(param => {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.htmlFor = `param-${param.key}`;
      label.textContent = param.label;
      const select = document.createElement('select');
      select.id = `param-${param.key}`;
      param.values.forEach(value => {
        const option = document.createElement('option');
        option.value = valueKey(param, value);
        option.textContent = displayValue(param, value);
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        state.config[param.key] = param.numeric ? Number(select.value) : select.value;
        onConfigChange();
      });
      wrap.append(label, select);
      form.appendChild(wrap);
    });
  }

  function syncConfigForm() {
    PARAMS.forEach(param => {
      const select = $(`param-${param.key}`);
      select.value = valueKey(param, state.config[param.key]);
      [...select.options].forEach((option, i) => {
        const value = param.values[i];
        const has = available.has(runId({ ...state.config, [param.key]: value }));
        option.textContent = displayValue(param, value) + (has ? '' : ' ∅');
        option.classList.toggle('unavailable', !has);
      });
    });
    $('run-id').textContent = runId(state.config);
  }

  function buildControls() {
    SPEEDS.forEach(s => $('speed-select').add(new Option(`${fmtInt(s)} episodes / s`, s)));
    $('speed-select').value = state.speed;
    $('speed-select').addEventListener('change', e => { state.speed = Number(e.target.value); });

    Object.keys(ENERGY_UNITS).forEach(u => $('energy-unit').add(new Option(u, u)));
    Object.keys(EMISSION_UNITS).forEach(u => $('emissions-unit').add(new Option(`${u} CO₂eq`, u)));
    $('energy-unit').value = state.energyUnit;
    $('emissions-unit').value = state.emissionsUnit;
    $('energy-unit').addEventListener('change', e => { state.energyUnit = e.target.value; render(); });
    $('emissions-unit').addEventListener('change', e => { state.emissionsUnit = e.target.value; render(); });

    document.querySelectorAll('.segmented button').forEach(button => {
      button.addEventListener('click', () => {
        state.mode = button.dataset.mode;
        document.querySelectorAll('.segmented button').forEach(b => b.classList.toggle('active', b === button));
        render();
      });
    });

    $('play-btn').addEventListener('click', () => (state.timer ? pause() : play()));
    $('restart-btn').addEventListener('click', () => { seek(1); play(); });
    $('end-btn').addEventListener('click', () => { pause(); seek(state.run ? state.run.n : 1); });
    $('episode-range').addEventListener('input', e => { pause(); seek(Number(e.target.value)); });
    $('episode-input').addEventListener('change', e => { pause(); seek(Number(e.target.value)); });
    $('show-best').addEventListener('change', e => { state.showBest = e.target.checked; render(); });

    $('report-btn').addEventListener('click', openReportDialog);
    $('report-pdf').addEventListener('click', () => exportReport('pdf'));
    $('report-html').addEventListener('click', () => exportReport('html'));

    document.addEventListener('keydown', e => {
      if (!state.run || $('report-dialog').open || e.target.closest('input, select, textarea, button, [tabindex]')) return;
      if (e.key === ' ') { e.preventDefault(); state.timer ? pause() : play(); }
      if (e.key === 'ArrowRight') { pause(); seek(state.episode + (e.shiftKey ? 100 : 1)); }
      if (e.key === 'ArrowLeft') { pause(); seek(state.episode - (e.shiftKey ? 100 : 1)); }
    });

    let resizeTimer;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  }

  // ---------- Loading ----------

  function onConfigChange() {
    pause();
    syncConfigForm();
    updateHash();
    load();
  }

  function load() {
    const id = runId(state.config);
    const token = ++state.loadToken;
    if (!available.has(id)) {
      state.run = null;
      showEmpty();
      return;
    }
    $('status-pill').textContent = 'Loading…';
    $('dashboard').classList.add('is-loading');
    GreenRL.loadRun(id).then(run => {
      if (token !== state.loadToken) return;
      state.run = run;
      state.episode = Math.min(Math.max(1, state.episode), run.n);
      $('empty-state').hidden = true;
      $('dashboard').hidden = false;
      $('dashboard').classList.remove('is-loading');
      $('demo-banner').hidden = !run.demo;
      $('report-btn').disabled = false;
      $('episode-range').max = run.n;
      $('episode-input').max = run.n;
      $('episode-max').textContent = fmtInt(run.n);
      $('status-pill').textContent = 'Paused';
      render();
    }).catch(err => {
      if (token !== state.loadToken) return;
      state.run = null;
      showEmpty(err.message);
    });
  }

  function showEmpty(errorMessage) {
    $('dashboard').hidden = true;
    $('dashboard').classList.remove('is-loading');
    $('empty-state').hidden = false;
    $('report-btn').disabled = true;
    $('status-pill').textContent = 'No data';
    $('empty-title').textContent = errorMessage ? 'Could not load this run' : 'No results for this configuration';
    $('empty-text').textContent = errorMessage ||
      (manifest.runs.length
        ? 'The dataset does not contain this combination of parameters. Closest runs that do exist:'
        : 'The dataset is empty. Generate data/manifest.js and data/runs/ with tools/build_dataset.py.');

    const box = $('nearest-runs');
    box.replaceChildren();
    if (errorMessage) return;
    const scored = manifest.runs.map(id => {
      const config = parseRunId(id);
      const diffs = config ? PARAMS.filter(p => valueKey(p, config[p.key]) !== valueKey(p, state.config[p.key])) : PARAMS;
      return { config, diffs };
    }).filter(r => r.config).sort((a, b) => a.diffs.length - b.diffs.length).slice(0, 6);

    scored.forEach(({ config, diffs }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = diffs.map(p => `${p.label}: ${displayValue(p, config[p.key])}`).join(' · ');
      button.addEventListener('click', () => { state.config = config; onConfigChange(); });
      box.appendChild(button);
    });
  }

  function updateHash() {
    const params = new URLSearchParams({ run: runId(state.config), ep: state.episode });
    history.replaceState(null, '', `#${params}`);
  }

  // ---------- Playback ----------

  function play() {
    if (!state.run) return;
    if (state.episode >= state.run.n) state.episode = 1;
    clearInterval(state.timer);
    state.carry = 0;
    state.timer = setInterval(tick, TICK_MS);
    $('play-btn').textContent = 'Ⅱ Pause';
    $('status-pill').textContent = 'Playing';
  }

  function pause() {
    if (!state.timer) return;
    clearInterval(state.timer);
    state.timer = null;
    $('play-btn').textContent = '▶ Play';
    $('status-pill').textContent = 'Paused';
    updateHash();
  }

  function tick() {
    state.carry += state.speed * TICK_MS / 1000;
    const step = Math.floor(state.carry);
    if (!step) return;
    state.carry -= step;
    state.episode = Math.min(state.run.n, state.episode + step);
    render();
    if (state.episode >= state.run.n) pause();
  }

  function seek(episode) {
    if (!state.run) return;
    state.episode = Math.min(state.run.n, Math.max(1, Math.round(episode) || 1));
    if (!state.timer) updateHash();
    render();
  }

  // ---------- Formatting ----------

  const energy = v => v * ENERGY_UNITS[state.energyUnit];
  const emissions = v => v * EMISSION_UNITS[state.emissionsUnit];
  const energyText = v => `${formatValue(energy(v))} ${state.energyUnit}`;
  const emissionsText = v => `${formatValue(emissions(v))} ${state.emissionsUnit}`;

  function durationText(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    if (seconds < 60) return `${formatValue(seconds)} s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
  }

  function gapText(distance) {
    const opt = instances[state.run.config.instance]?.optimum;
    if (!opt || !Number.isFinite(distance)) return '—';
    return `${d3.format('+.1f')(((distance - opt) / opt) * 100)}%`;
  }

  // ---------- Rendering ----------

  function render() {
    if (!state.run) return;
    renderEpisodeState();
    renderKpis();
    renderCharts();
  }

  function renderEpisodeState() {
    const { run, episode } = state;
    const i = episode - 1;
    $('episode-range').value = episode;
    $('episode-input').value = episode;
    $('episode-number').textContent = `${fmtInt(episode)} / ${fmtInt(run.n)}`;
    $('progress-bar').style.width = `${(episode / run.n) * 100}%`;
    $('new-best-badge').hidden = run.minIdx.distance[i] !== i;

    const items = [
      ['Duration', durationText(run.cols.duration[i])],
      ['CPU energy', energyText(run.cols.cpu_energy[i])],
      ['RAM energy', energyText(run.cols.ram_energy[i])],
      ['Total energy', energyText(run.cols.energy_consumed[i])],
      ['Emissions', emissionsText(run.cols.emissions[i])],
      ['Distance', formatValue(run.cols.distance[i])],
      ['Best so far', `${formatValue(run.bestSoFar[i])} (ep ${fmtInt(run.minIdx.distance[i] + 1)})`]
    ];
    const dl = $('readout');
    dl.replaceChildren();
    items.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      dl.append(dt, dd);
    });
  }

  function kpi(label, value, sub, highlight) {
    const card = document.createElement('div');
    card.className = `metric-card${highlight ? ' highlight' : ''}`;
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('strong');
    v.textContent = value;
    const s = document.createElement('small');
    s.textContent = sub;
    card.append(l, v, s);
    return card;
  }

  function renderKpis() {
    const { run, episode } = state;
    const i = episode - 1, last = run.n - 1;
    const c = run.cumulative;
    const ofTotal = (total, fmt) => `of ${fmt(total)} for all ${fmtInt(run.n)} episodes`;
    $('energy-kpis').replaceChildren(
      kpi('Elapsed duration', durationText(c.duration[i]), ofTotal(c.duration[last], durationText)),
      kpi('Total energy', energyText(c.energy_consumed[i]), ofTotal(c.energy_consumed[last], energyText)),
      kpi('CPU energy', energyText(c.cpu_energy[i]), ofTotal(c.cpu_energy[last], energyText)),
      kpi('RAM energy', energyText(c.ram_energy[i]), ofTotal(c.ram_energy[last], energyText)),
      kpi('Emissions', emissionsText(c.emissions[i]), ofTotal(c.emissions[last], emissionsText))
    );

    const bestIdx = run.minIdx.distance[i];
    const inst = instances[run.config.instance];
    const improvements = d3.bisectRight(run.improvements, i);
    $('perf-kpis').replaceChildren(
      kpi('Best distance', formatValue(run.bestSoFar[i]), `found at episode ${fmtInt(bestIdx + 1)}`, true),
      kpi('Gap to optimum', gapText(run.bestSoFar[i]), inst?.optimum ? `known optimum ${fmtInt(inst.optimum)}` : 'optimum unknown'),
      kpi('Current distance', formatValue(run.cols.distance[i]), `episode ${fmtInt(episode)}`),
      kpi('Improvements', fmtInt(improvements), 'episodes that set a new best')
    );
  }

  // Chart options shared by the page and the report, so both always show the same thing.
  function chartSpecs(run, episode) {
    const cumulative = state.mode === 'cumulative';
    const pick = key => (cumulative ? run.cumulative[key] : run.cols[key]);
    const kind = cumulative ? 'last' : 'band';
    const title = (what, unit) => (cumulative ? `Cumulative ${what.toLowerCase()} (${unit})` : `${what} per episode (${unit})`);
    const i = episode - 1;
    const bestIdx = run.minIdx.distance[i];
    const inst = instances[run.config.instance];

    const energySeries = [
      { label: 'Total', color: '--series-1', values: pick('energy_consumed') },
      { label: 'CPU', color: '--series-2', values: pick('cpu_energy') },
      { label: 'RAM', color: '--series-3', values: pick('ram_energy') }
    ].map(s => ({ ...s, kind, unit: state.energyUnit }));

    return {
      energy: {
        title: title('Energy', state.energyUnit),
        caption: cumulative
          ? 'Energy used from episode 1 up to each episode.'
          : 'Line = energy of each episode; the shaded band shows the lowest and highest episode within each plotted step.',
        legend: energySeries,
        opts: { end: episode, series: energySeries, scale: ENERGY_UNITS[state.energyUnit], zeroBased: true, height: 260,
          ariaLabel: 'Energy per episode: total, CPU and RAM' }
      },
      emissions: {
        title: title('Emissions', `${state.emissionsUnit} CO₂eq`),
        opts: { end: episode, scale: EMISSION_UNITS[state.emissionsUnit], zeroBased: true, ariaLabel: 'Emissions per episode',
          series: [{ label: 'Emissions', color: '--series-1', values: pick('emissions'), kind, unit: state.emissionsUnit, endLabel: true }] }
      },
      duration: {
        title: title('Duration', 's'),
        opts: { end: episode, zeroBased: true, ariaLabel: 'Duration per episode',
          series: [{ label: 'Duration', color: '--series-1', values: pick('duration'), kind, unit: 's', endLabel: true }] }
      },
      distance: {
        caption: 'Blue: tour length found in each episode. Orange: best (shortest) length found so far.' +
          (inst?.optimum ? ' Grey line: known optimum.' : ''),
        legend: [
          { label: 'Episode distance', color: '--series-1' },
          { label: 'Best so far', color: '--series-2' }
        ],
        opts: {
          end: episode, height: 380, ariaLabel: 'Distance per episode with best distance so far',
          series: [
            { label: 'Episode distance', color: '--series-1', values: run.cols.distance, kind: 'band' },
            { label: 'Best so far', color: '--series-2', values: run.bestSoFar, kind: 'last', curve: 'step' }
          ],
          refLine: inst?.optimum ? { value: inst.optimum, label: `optimum ${fmtInt(inst.optimum)}` } : null,
          marker: bestIdx >= 0 ? {
            episode: bestIdx + 1, value: run.cols.distance[bestIdx], color: '--series-2',
            label: `best ${formatValue(run.cols.distance[bestIdx])} · ep ${fmtInt(bestIdx + 1)}`
          } : null
        }
      },
      routeCaption: inst && !inst.coords
        ? `${run.config.instance} is asymmetric (ATSP) and has no coordinates: nodes sit on a circle in index order.`
        : `${run.config.instance}: TSPLIB node coordinates.`
    };
  }

  function renderCharts() {
    const { run, episode } = state;
    const specs = chartSpecs(run, episode);
    const i = episode - 1;
    const bestIdx = run.minIdx.distance[i];

    $('energy-title').textContent = specs.energy.title;
    $('energy-caption').textContent = specs.energy.caption;
    $('emissions-title').textContent = specs.emissions.title;
    $('duration-title').textContent = specs.duration.title;
    $('distance-caption').textContent = specs.distance.caption;
    $('route-caption').textContent = specs.routeCaption;

    GreenRLCharts.legend('#energy-legend', specs.energy.legend);
    GreenRLCharts.timeSeries($('energy-chart'), specs.energy.opts);
    GreenRLCharts.timeSeries($('emissions-chart'), specs.emissions.opts);
    GreenRLCharts.timeSeries($('duration-chart'), specs.duration.opts);
    GreenRLCharts.legend('#distance-legend', specs.distance.legend);
    GreenRLCharts.timeSeries($('distance-chart'), specs.distance.opts);

    GreenRLCharts.legend('#route-legend', [
      { label: `Episode ${fmtInt(episode)}`, color: '--series-1' },
      ...(state.showBest ? [{ label: `Best (ep ${fmtInt(bestIdx + 1)})`, color: '--series-2', shape: 'wide' }] : [])
    ]);
    GreenRLCharts.routeChart($('route-chart'), {
      instance: instances[run.config.instance], current: run.path(i), best: bestIdx >= 0 ? run.path(bestIdx) : null,
      showBest: state.showBest, height: 380, ariaLabel: `Path of episode ${episode}`
    });
  }

  // ---------- Report ----------

  function openReportDialog() {
    if (!state.run) return;
    pause();
    const config = state.run.config;
    $('report-scope').textContent =
      `${displayValue(PARAMS[0], config.algorithm)} on ${config.instance}, episodes 1–${fmtInt(state.episode)} ` +
      `of ${fmtInt(state.run.n)}, ${state.mode === 'cumulative' ? 'cumulative' : 'per-episode'} charts, ` +
      `energy in ${state.energyUnit}, emissions in ${state.emissionsUnit} CO₂eq.`;
    $('report-dialog').showModal();
  }

  function exportReport(format) {
    const sections = new Set([...document.querySelectorAll('#report-dialog input[name="section"]:checked')].map(i => i.value));
    const html = GreenRLReport.build({
      run: state.run, episode: state.episode, sections, instance: instances[state.run.config.instance],
      specs: chartSpecs(state.run, state.episode), params: PARAMS, displayValue,
      units: { energy: state.energyUnit, energyFactor: ENERGY_UNITS[state.energyUnit],
        emissions: state.emissionsUnit, emissionsFactor: EMISSION_UNITS[state.emissionsUnit] },
      mode: state.mode, durationText, gapText
    });
    $('report-dialog').close();
    const name = `report_${state.run.id}_ep${state.episode}`;
    if (format === 'html') GreenRLReport.download(html, `${name}.html`);
    else GreenRLReport.print(html, name);
  }

  // ---------- Start ----------

  state.config = initialConfig();
  buildConfigForm();
  buildControls();
  $('dataset-count').textContent = `${fmtInt(manifest.runs.length)} run(s) in the dataset. ∅ marks options with no run for the other selected values.`;
  syncConfigForm();
  load();
})();

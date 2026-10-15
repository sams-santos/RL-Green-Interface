// Page controller: shared settings (grid, units), country picker, Explore tab and report export.
// Loaded last; it wires the other modules (config, data, charts, equivalents, report, compare).
(() => {
  const { PARAMS, valueKey, displayValue, runId, parseRunId } = GreenRLConfig;
  const { formatValue, flagUrl } = GreenRLCharts;
  const { instances = {}, countries = [] } = window.GREEN_RL_REFERENCE || {};
  const countryByIso = Object.fromEntries(countries.map(c => [c.iso, c]));
  const { manifest } = GreenRL;
  // Same interface as a Set of run ids: available.has(runId).
  const available = { has: id => GreenRL.available(parseRunId(id)) };

  const ENERGY_UNITS = { kWh: 1, Wh: 1e3, J: 3.6e6 };
  const EMISSION_UNITS = { kg: 1, g: 1e3, mg: 1e6 };
  // Title and icon of each view, shown in the page title bar.
  const PAGES = {
    explore: ['Explore a run', 'compass'],
    compare: ['Compare two runs', 'git-compare'],
    concepts: ['Concepts & references', 'book-open-text']
  };
  const SPEEDS = [5, 10, 25, 50, 100, 250, 500];
  const TICK_MS = 100;
  const MEASURED = 'measured';

  const $ = id => document.getElementById(id);
  const fmtInt = d3.format(',');
  const icon = name => GreenRLIcons.el(name);

  // Settings shared by both tabs.
  const settings = {
    tab: 'explore',
    country: MEASURED,   // ISO3 code, or MEASURED for the intensity recorded with each run
    energyUnit: 'kWh',
    emissionsUnit: 'kg'
  };

  // Explore tab.
  const state = {
    config: null,
    run: null,
    episode: 1,          // position 1..n (episodes shown so far)
    timer: null,
    carry: 0,
    speed: 50,
    mode: 'episode',
    insight: 'run',
    loadToken: 0
  };

  // ---------- Helpers shared with the compare tab ----------

  const energyText = v => `${formatValue(v * ENERGY_UNITS[settings.energyUnit])} ${settings.energyUnit}`;
  const emissionsText = v => `${formatValue(v * EMISSION_UNITS[settings.emissionsUnit])} ${settings.emissionsUnit}`;
  const epLabel = (run, index) => fmtInt(index + run.firstEpisode);  // 0-based index -> number in the data

  function durationText(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    if (seconds < 60) return `${formatValue(seconds)} s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s).padStart(2, '0')} s`;
  }

  function gapText(run, distance) {
    const opt = instances[run.config.instance]?.optimum;
    if (!opt || !Number.isFinite(distance)) return '—';
    return `${d3.format('+.1f')(((distance - opt) / opt) * 100)}%`;
  }

  // The country whose grid intensity matches what the experiment measured, if any.
  function measuredCountry(run) {
    if (!run || !Number.isFinite(run.carbonIntensity)) return null;
    return countries.find(c => Math.abs(c.intensity - run.carbonIntensity) < 0.01) || null;
  }

  // CO2eq = C × E. "As measured" uses the emissions column; a country rescales the energy column.
  function emissionsBasis(run) {
    const c = countryByIso[settings.country];
    if (!c) {
      const match = measuredCountry(run);
      return {
        perEpisode: run.cols.emissions, cumulative: run.cumulative.emissions, factor: 1,
        intensity: run.carbonIntensity, iso: match?.iso ?? null, flag: match?.flag ?? null,
        label: match ? `as measured (${match.name})` : 'as measured'
      };
    }
    return {
      perEpisode: run.cols.energy_consumed, cumulative: run.cumulative.energy_consumed, factor: c.intensity / 1000,
      intensity: c.intensity, iso: c.iso, flag: c.flag, label: c.name, year: c.year
    };
  }

  function gridText(basis) {
    if (!Number.isFinite(basis.intensity)) return 'carbon intensity not recorded for this run';
    return `C = ${formatValue(basis.intensity)} g CO₂eq/kWh · ${basis.label}` + (basis.year ? ` (${basis.year} data)` : '');
  }

  // A form with one select per parameter; options without a run (given the other values) get ∅.
  function configForm(container, prefix, getConfig, onChange) {
    const selects = PARAMS.map(param => {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.htmlFor = `${prefix}-${param.key}`;
      label.textContent = param.label;
      const select = document.createElement('select');
      select.id = `${prefix}-${param.key}`;
      param.values.forEach(value => select.add(new Option(displayValue(param, value), valueKey(param, value))));
      select.addEventListener('change', () => {
        getConfig()[param.key] = param.values.find(v => valueKey(param, v) === select.value);
        onChange();
      });
      wrap.append(label, select);
      container.appendChild(wrap);
      return select;
    });
    return function sync() {
      const config = getConfig();
      PARAMS.forEach((param, k) => {
        selects[k].value = valueKey(param, config[param.key]);
        [...selects[k].options].forEach((option, i) => {
          const has = available.has(runId({ ...config, [param.key]: param.values[i] }));
          option.textContent = displayValue(param, param.values[i]) + (has ? '' : ' ∅');
          option.classList.toggle('unavailable', !has);
        });
      });
    };
  }

  // Runs in the dataset that differ from `config` in one parameter, in PARAMS order.
  function nearestRuns(config) {
    const out = [];
    PARAMS.forEach(p => p.values.forEach(value => {
      const c = { ...config, [p.key]: value };
      if (valueKey(p, value) !== valueKey(p, config[p.key]) && available.has(runId(c))) out.push({ config: c, diffs: [p] });
    }));
    return out;
  }

  // ---------- Country picker (with flags) ----------

  function flagImg(code) {
    const img = document.createElement('img');
    img.className = 'flag';
    img.alt = '';
    img.loading = 'lazy';
    if (code) img.src = flagUrl(code);
    else img.classList.add('flag-empty');
    return img;
  }

  function countryPicker(root, onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-labelledby', 'country-label');

    const panel = document.createElement('div');
    panel.className = 'picker-panel';
    panel.hidden = true;
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search a country…';
    search.setAttribute('aria-label', 'Search a country');
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.id = 'country-options';
    panel.append(search, list);
    root.append(button, panel);

    const items = [{ value: MEASURED, name: 'As measured in the experiment', flag: null, meta: 'recorded C' },
      ...countries.map(c => ({ value: c.iso, name: c.name, flag: c.flag, meta: `${formatValue(c.intensity)} g/kWh` }))];
    const nodes = items.map((item, k) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = `country-opt-${k}`;
      const name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = item.name;
      const meta = document.createElement('span');
      meta.className = 'picker-meta';
      meta.textContent = item.meta;
      li.append(flagImg(item.flag), name, meta);
      li.addEventListener('click', () => choose(item.value));
      list.appendChild(li);
      return li;
    });
    let active = -1;

    const visible = () => nodes.filter(n => !n.hidden);
    function setActive(node) {
      nodes.forEach(n => n.classList.toggle('active', n === node));
      active = nodes.indexOf(node);
      if (node) {
        search.setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
      }
    }
    function open() {
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      search.value = '';
      nodes.forEach(n => { n.hidden = false; });
      setActive(nodes[items.findIndex(i => i.value === settings.country)]);
      search.focus();
    }
    function close(focusButton) {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
    }
    function choose(value) {
      close(true);
      if (value !== settings.country) onSelect(value);
    }

    button.addEventListener('click', () => (panel.hidden ? open() : close(false)));
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      items.forEach((item, k) => {
        nodes[k].hidden = q !== '' && !item.name.toLowerCase().includes(q) && !item.value.toLowerCase().includes(q);
      });
      setActive(visible()[0] || null);
    });
    search.addEventListener('keydown', e => {
      const vis = visible();
      const pos = vis.indexOf(nodes[active]);
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(vis[Math.min(vis.length - 1, pos + 1)] || null); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(vis[Math.max(0, pos - 1)] || null); }
      if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active].value); }
      if (e.key === 'Escape') close(true);
      if (e.key === 'Tab') close(false);
    });
    document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) close(false); });

    // Button shows the current choice; "as measured" borrows the matching country's flag.
    return function refresh(measured) {
      const c = countryByIso[settings.country];
      const meta = document.createElement('span');
      meta.className = 'picker-meta';
      meta.textContent = c ? `${formatValue(c.intensity)} g/kWh`
        : measured ? `${measured.name}, ${formatValue(measured.intensity)} g/kWh` : 'recorded C';
      const name = document.createElement('span');
      name.className = 'picker-name';
      name.textContent = c ? c.name : 'As measured in the experiment';
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '▾';
      button.replaceChildren(flagImg(c ? c.flag : measured?.flag), name, meta, chevron);
    };
  }

  // ---------- Setup ----------

  const hash = new URLSearchParams(location.hash.slice(1));

  function initialConfig() {
    if (countryByIso[hash.get('country')]) settings.country = hash.get('country');
    const fromHash = parseRunId(hash.get('run'));
    if (fromHash) {
      const ep = Number(hash.get('ep'));
      if (ep > 0) state.episode = ep;
      return fromHash;
    }
    // Default: a mid-grid Q-learning run on berlin52 (or the first value of each parameter).
    const preferred = { algorithm: 'q-learning', instance: 'berlin52', epsilon_decay: 'linear', reward: 'R1',
      gamma: 0.9, alpha: 0.15, epsilon_init: 0.1, seed: 42 };
    return Object.fromEntries(PARAMS.map(p => [p.key, p.values.includes(preferred[p.key]) ? preferred[p.key] : p.values[0]]));
  }

  let syncExploreForm;
  let refreshPicker;

  function buildControls() {
    syncExploreForm = configForm($('config-form'), 'param', () => state.config, onConfigChange);
    refreshPicker = countryPicker($('country-picker'), iso => { settings.country = iso; onSettingsChange(); });

    SPEEDS.forEach(s => $('speed-select').add(new Option(`${fmtInt(s)} episodes / s`, s)));
    $('speed-select').value = state.speed;
    $('speed-select').addEventListener('change', e => { state.speed = Number(e.target.value); });

    Object.keys(ENERGY_UNITS).forEach(u => $('energy-unit').add(new Option(u, u)));
    Object.keys(EMISSION_UNITS).forEach(u => $('emissions-unit').add(new Option(`${u} CO₂eq`, u)));
    $('energy-unit').value = settings.energyUnit;
    $('emissions-unit').value = settings.emissionsUnit;
    $('energy-unit').addEventListener('change', e => { settings.energyUnit = e.target.value; onSettingsChange(); });
    $('emissions-unit').addEventListener('change', e => { settings.emissionsUnit = e.target.value; onSettingsChange(); });

    document.querySelectorAll('.nav-list [role="tab"]').forEach(tab => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

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
    // The number box shows episode numbers as in the data (which may start at 0).
    $('episode-input').addEventListener('change', e => {
      pause();
      if (state.run) seek(Number(e.target.value) - state.run.firstEpisode + 1);
    });

    // In-page links (contents, citations, sources) scroll without touching the URL, which holds the view.
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href^="#"]');
      const target = link && document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      e.preventDefault();
      const panel = target.closest('[role="tabpanel"][hidden]');
      if (panel) showTab(panel.id.replace('tab-', ''));
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    });

    $('explore-weight').appendChild(GreenRLScores.view.weightControl(() => { state.overviewKey = null; renderOverview(); }));

    document.querySelectorAll('.insight-tabs button').forEach(button => {
      button.addEventListener('click', () => {
        state.insight = button.dataset.insight;
        state.overviewKey = null;
        renderOverview();
      });
    });

    $('report-btn').addEventListener('click', openReportDialog);
    $('report-pdf').addEventListener('click', () => exportReport('pdf'));
    $('report-html').addEventListener('click', () => exportReport('html'));

    document.addEventListener('keydown', e => {
      if (settings.tab !== 'explore' || !state.run || $('report-dialog').open ||
        e.target.closest('input, select, textarea, button, [tabindex]')) return;
      if (e.key === ' ') { e.preventDefault(); state.timer ? pause() : play(); }
      if (e.key === 'ArrowRight') { pause(); seek(state.episode + (e.shiftKey ? 100 : 1)); }
      if (e.key === 'ArrowLeft') { pause(); seek(state.episode - (e.shiftKey ? 100 : 1)); }
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => (settings.tab === 'explore' ? render() : GreenRLCompare.render()), 150);
    });
  }

  function showTab(tab) {
    settings.tab = tab;
    pause();
    document.querySelectorAll('.nav-list [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    ['explore', 'compare', 'concepts'].forEach(name => { $(`tab-${name}`).hidden = name !== tab; });
    const [title, iconName] = PAGES[tab];
    $('page-title').textContent = title;
    $('page-icon').replaceChildren(icon(iconName));
    $('status-pill').hidden = tab === 'concepts';
    // The grid and unit controls live in the configuration panel of the open tab.
    if (tab !== 'concepts') $(`${tab}-settings-slot`).appendChild($('grid-settings'));
    if (tab === 'compare') GreenRLCompare.show(state.config);
    else render();
    updateGridSettings();
    updateHash();
  }

  function onSettingsChange() {
    updateGridSettings();
    updateHash();
    if (settings.tab === 'explore') render();
    else GreenRLCompare.render();
  }

  function updateGridSettings() {
    const measured = settings.tab === 'explore' ? measuredCountry(state.run) : GreenRLCompare.measuredCountry();
    refreshPicker(measured);
    const c = countryByIso[settings.country];
    $('grid-info').textContent = c
      ? `CO₂eq = E × C · ${c.name}, ${c.year} data`
      : 'CO₂eq = E × C · C recorded with each run';
  }

  function updateHash() {
    const params = new URLSearchParams();
    if (settings.tab === 'compare') {
      params.set('tab', 'compare');
      Object.entries(GreenRLCompare.hashParams()).forEach(([k, v]) => params.set(k, v));
    } else {
      if (settings.tab === 'concepts') params.set('tab', 'concepts');
      params.set('run', runId(state.config));
      params.set('ep', state.episode);
    }
    if (settings.country !== MEASURED) params.set('country', settings.country);
    history.replaceState(null, '', `#${params}`);
  }

  // ---------- Loading ----------

  function onConfigChange() {
    pause();
    syncExploreForm();
    $('run-id').textContent = runId(state.config);
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
    Promise.all([GreenRL.loadRun(id), GreenRL.loadShard(state.config)]).then(([run, shard]) => {
      if (token !== state.loadToken) return;
      state.run = run;
      state.shard = shard;
      state.gridKey = null;
      state.overviewKey = null;
      state.episode = Math.min(Math.max(1, state.episode), run.n);
      $('empty-state').hidden = true;
      $('dashboard').hidden = false;
      $('dashboard').classList.remove('is-loading');
      $('report-btn').disabled = false;
      $('episode-range').max = run.n;
      $('episode-input').min = run.firstEpisode;
      $('episode-input').max = run.firstEpisode + run.n - 1;
      $('episode-max').textContent = fmtInt(run.firstEpisode + run.n - 1);
      $('status-pill').textContent = 'Paused';
      updateGridSettings();
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
      (manifest.shards.length
        ? 'The dataset does not contain this combination of parameters. Closest runs that do exist:'
        : 'The dataset is empty. Generate it with tools/fetch_release.py and tools/build_dataset.py.');

    const box = $('nearest-runs');
    box.replaceChildren();
    if (errorMessage) return;
    nearestRuns(state.config).slice(0, 6).forEach(({ config, diffs }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = diffs.map(p => `${p.label}: ${displayValue(p, config[p.key])}`).join(' · ');
      button.addEventListener('click', () => { state.config = config; onConfigChange(); });
      box.appendChild(button);
    });
  }

  // ---------- Playback ----------

  function play() {
    if (!state.run) return;
    if (state.episode >= state.run.n) state.episode = 1;
    clearInterval(state.timer);
    state.carry = 0;
    state.timer = setInterval(tick, TICK_MS);
    $('play-btn').replaceChildren(icon('pause'), ' Pause');
    $('status-pill').textContent = 'Playing';
  }

  function pause() {
    if (!state.timer) return;
    clearInterval(state.timer);
    state.timer = null;
    $('play-btn').replaceChildren(icon('play'), ' Play');
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

  // ---------- Explore rendering ----------

  function render() {
    if (!state.run || settings.tab !== 'explore') return;
    const basis = emissionsBasis(state.run);
    renderEpisodeState(basis);
    renderKpis();
    renderCharts(basis);
    renderGrid();
    renderOverview();
  }

  function renderEpisodeState(basis) {
    const { run, episode } = state;
    const i = episode - 1;
    $('episode-range').value = episode;
    $('episode-input').value = i + run.firstEpisode;
    $('episode-number').textContent = `Episode ${epLabel(run, i)}`;
    $('progress-bar').style.width = `${(episode / run.n) * 100}%`;
    $('new-best-badge').hidden = run.bestIdx[i] !== i;

    const items = [
      ['repeat', 'Episodes shown', `${fmtInt(episode)} of ${fmtInt(run.n)}`],
      ['timer', 'Duration', durationText(run.cols.duration[i])],
      ['cpu', 'CPU energy', energyText(run.cols.cpu_energy[i])],
      ['memory-stick', 'RAM energy', energyText(run.cols.ram_energy[i])],
      ['zap', 'Total energy', energyText(run.cols.energy_consumed[i])],
      ['cloud', 'Emissions', emissionsText(basis.perEpisode[i] * basis.factor)],
      ['route', 'Distance', formatValue(run.cols.distance[i])],
      ['trophy', 'Best so far', `${formatValue(run.bestSoFar[i])} (ep ${epLabel(run, run.bestIdx[i])})`]
    ];
    $('readout').replaceChildren(...items.flatMap(([name, label, value]) => {
      const dt = document.createElement('dt');
      dt.append(icon(name), label);
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }));
  }

  function kpi(name, label, value, sub, highlight) {
    const card = document.createElement('div');
    card.className = `metric-card${highlight ? ' highlight' : ''}`;
    const l = document.createElement('span');
    l.className = 'metric-label';
    l.appendChild(icon(name));
    l.append(label);
    const v = document.createElement('strong');
    v.textContent = value;
    const s = document.createElement('small');
    s.textContent = sub;
    card.append(l, v, s);
    return card;
  }

  function renderKpis() {
    const { run, episode } = state;
    const i = episode - 1;
    const bestIdx = run.bestIdx[i];
    const inst = instances[run.config.instance];
    $('perf-kpis').replaceChildren(
      kpi('trophy', 'Best distance', formatValue(run.bestSoFar[i]), `found at episode ${epLabel(run, bestIdx)}`, true),
      kpi('target', 'Gap to optimum', gapText(run, run.bestSoFar[i]), inst?.optimum ? `known optimum ${fmtInt(inst.optimum)}` : 'optimum unknown'),
      kpi('route', 'Current distance', formatValue(run.cols.distance[i]), `episode ${epLabel(run, i)}`),
      kpi('trending-down', 'Improvements', fmtInt(d3.bisectRight(run.improvements, i)), 'episodes that set a new best')
    );
  }

  // Energy board: elapsed time, CPU/RAM split, then CPU + RAM = E and E × C = CO2eq.
  // Each value covers the episodes shown so far; the small line gives the whole run's total.
  function renderFlow(run, episode, basis) {
    const i = episode - 1, last = run.n - 1;
    const c = run.cumulative;
    const total = c.energy_consumed[i];
    const share = v => (total > 0 ? v / total : 0);
    const percent = v => d3.format('.0%')(share(v));
    const tile = (name, label, value, sub, cls = '', flag = null) => {
      const card = document.createElement('div');
      card.className = `flow-tile ${cls}`;
      const head = document.createElement('span');
      head.className = 'flow-label';
      head.append(icon(name), label);
      const v = document.createElement('strong');
      v.textContent = value;
      const s = document.createElement('small');
      if (flag) s.appendChild(flagImg(flag));
      s.append(sub);
      card.append(head, v, s);
      return card;
    };
    const op = symbol => {
      const span = document.createElement('span');
      span.className = 'flow-op';
      span.textContent = symbol;
      span.setAttribute('aria-hidden', 'true');
      return span;
    };
    const ofTotal = (value, fmt) => `of ${fmt(value)} in total`;
    const emissions = v => `${emissionsText(v * basis.factor)} CO₂eq`;
    const intensity = Number.isFinite(basis.intensity) ? `${formatValue(basis.intensity)} g/kWh` : 'not recorded';

    $('board-time').replaceChildren(
      tile('timer', 'Elapsed time', durationText(c.duration[i]), ofTotal(c.duration[last], durationText), 'time'));
    $('flow').replaceChildren(
      tile('cpu', 'CPU', energyText(c.cpu_energy[i]), ofTotal(c.cpu_energy[last], energyText), 'cpu'),
      op('+'),
      tile('memory-stick', 'RAM', energyText(c.ram_energy[i]), ofTotal(c.ram_energy[last], energyText), 'ram'),
      op('='),
      tile('zap', 'Energy E', energyText(total), ofTotal(c.energy_consumed[last], energyText), 'energy'),
      op('×'),
      tile('factory', 'Grid C', intensity, basis.label, 'grid', basis.flag),
      op('='),
      tile('cloud', 'Emissions', emissions(basis.cumulative[i]), ofTotal(basis.cumulative[last], emissions), 'co2')
    );

    const { cpu_measurement: cpu, tracking_mode: tracking } = run.measurement;
    const scope = { machine: 'whole machine', process: 'training process only' };
    $('flow-caption').textContent = `Episodes ${epLabel(run, 0)}–${epLabel(run, i)}` +
      (cpu ? ` · CPU via ${cpu}` : '') + (scope[tracking] ? ` · ${scope[tracking]}` : '') +
      ` · average power CPU ${formatValue(run.summary.cpuPower)} W, RAM ${formatValue(run.summary.ramPower)} W`;

    const bar = document.createElement('div');
    bar.className = 'share-bar';
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `CPU ${percent(c.cpu_energy[i])}, RAM ${percent(c.ram_energy[i])} of the energy`);
    [['cpu', c.cpu_energy[i]], ['ram', c.ram_energy[i]]].forEach(([cls, v]) => {
      const part = document.createElement('span');
      part.className = cls;
      part.style.width = `${share(v) * 100}%`;
      part.textContent = `${cls.toUpperCase()} ${percent(v)}`;
      bar.appendChild(part);
    });
    $('energy-share').replaceChildren(bar);
  }

  // Run chips, ECOVIS score and the insights card. None of them depends on the
  // episode, so they are rebuilt only when the run, a unit or the insight tab changes.
  function renderOverview() {
    const { run, shard } = state;
    const key = [run.id, settings.energyUnit, settings.emissionsUnit, settings.country, state.insight, GreenRLScores.weight].join('|');
    if (key === state.overviewKey) return;
    state.overviewKey = key;
    const param = k => PARAMS.find(p => p.key === k);
    const show = k => displayValue(param(k), run.config[k]);
    const inst = instances[run.config.instance];

    const chip = (name, label, value) => {
      const el = document.createElement('div');
      el.className = 'chip';
      const text = document.createElement('div');
      const small = document.createElement('small');
      small.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = value;
      text.append(small, strong);
      el.append(text, icon(name));
      return el;
    };
    $('run-chips').replaceChildren(
      chip('bot', 'Algorithm', show('algorithm')),
      chip('route', inst ? `Instance · ${inst.dimension} cities` : 'Instance', run.config.instance),
      chip('target', 'Reward', show('reward')),
      chip('trending-down', 'Epsilon decay', show('epsilon_decay')),
      chip('compass', 'Initial ε₀', show('epsilon_init')),
      chip('sliders-horizontal', 'Alpha α', show('alpha')),
      chip('hourglass', 'Gamma γ', show('gamma'))
    );

    document.querySelectorAll('.insight-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.insight === state.insight)));
    $('insight-body').replaceChildren(...insightContent(state.insight, run, shard, inst));
    renderScore(run, inst);
  }

  // ECOVIS score of the open run and the energy of each algorithm with the same settings.
  function renderScore(run, inst) {
    const S = GreenRLScores;
    const token = state.scoreToken = (state.scoreToken || 0) + 1;
    S.load(run.config.instance).then(table => {
      if (token !== state.scoreToken) return;
      const s = S.scoreOf(table, run.config);
      if (!s) return;
      $('explore-score').replaceChildren(S.view.card(s, { instance: run.config.instance, compact: true }));
      const algo = c => displayValue(PARAMS[0], c.algorithm);
      const rows = PARAMS[0].values.map(algorithm => {
        const config = { ...run.config, algorithm };
        const r = S.scoreOf(table, config);
        if (!r) return null;
        return {
          name: algo(config), energy: r.energy, energyGrade: r.energyGrade, energyText: energyText(r.energy),
          tour: inst?.optimum ? `gap ${gapText(run, r.best)}` : `best ${fmtInt(r.best)}`,
          current: algorithm === run.config.algorithm,
          onClick: algorithm === run.config.algorithm ? null : () => { state.config = config; onConfigChange(); }
        };
      }).filter(Boolean);
      $('algos-caption').textContent = 'Total energy of each algorithm with the same settings. ' +
        'Letters are energy labels: ratings of the energy index on this instance, A = the fifth of runs with the lowest energy. Click a bar to open that run.';
      $('algos').replaceChildren(S.view.algorithmBars(rows));
    }).catch(err => { $('explore-score').textContent = err.message; });
  }

  // Short, data-driven notes. Numbers come from the summary files of this shard (64 runs).
  function insightContent(kind, run, shard, inst) {
    const html = text => {
      const p = document.createElement('p');
      p.innerHTML = text;
      return p;
    };
    const list = items => {
      const ul = document.createElement('ul');
      items.forEach(text => { const li = document.createElement('li'); li.innerHTML = text; ul.appendChild(li); });
      return ul;
    };
    const esc = v => String(v).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const s = run.summary, cfg = run.config;
    const param = k => PARAMS.find(p => p.key === k);
    const name = displayValue(param('algorithm'), cfg.algorithm);
    const gap = d => (inst?.optimum ? ((d - inst.optimum) / inst.optimum) * 100 : NaN);
    const gapStr = d => (inst?.optimum ? `${d3.format('+.1f')(gap(d))}%` : fmtInt(d));
    const ab = c => `α = ${Number(c.alpha).toFixed(2)}, γ = ${Number(c.gamma).toFixed(2)}`;

    if (kind === 'run') {
      const cells = shard.cells;
      const rank = (value, pick) => 1 + cells.filter(c => pick(c.summary) < value).length;
      const bestGap = cells.reduce((a, c) => (c.summary.best < a.summary.best ? c : a));
      const cheapest = cells.reduce((a, c) => (c.summary.energy < a.summary.energy ? c : a));
      const better = cells.filter(c => c.summary.best < s.best && c.summary.energy < s.energy);
      const toBest = run.cumulative.energy_consumed[s.bestEpisode];
      return [
        html(`Over all ${fmtInt(run.n)} episodes, the shortest tour is <strong>${fmtInt(s.best)}</strong>` +
          (inst?.optimum ? ` (<strong>${gapStr(s.best)}</strong> from the optimum ${fmtInt(inst.optimum)})` : '') +
          `, found at episode ${fmtInt(s.bestEpisode)} after ${esc(energyText(toBest))} (${d3.format('.0%')(toBest / s.energy)} of the run's energy).`),
        list([
          `Among the ${cells.length} α × γ runs with these settings it ranks <strong>#${rank(s.best, x => x.best)}</strong> for distance and <strong>#${rank(s.energy, x => x.energy)}</strong> for energy (1 = best).`,
          `Shortest tour: ${ab(bestGap)}, ${fmtInt(bestGap.summary.best)}${inst?.optimum ? ` (${gapStr(bestGap.summary.best)})` : ''}.`,
          `Least energy: ${ab(cheapest)}, ${esc(energyText(cheapest.summary.energy))}.`,
          better.length
            ? `${better.length} run${better.length > 1 ? 's' : ''} found a shorter tour <em>and</em> used less energy, e.g. ${ab(better[0])}.`
            : 'No other run with these settings found a shorter tour while using less energy.'
        ])
      ];
    }
    if (kind === 'algorithm') {
      const text = {
        'q-learning': 'Q-learning updates its Q-table towards the <strong>best</strong> next action, whatever it actually does next (off-policy).',
        'sarsa': 'SARSA updates its Q-table towards the action it <strong>really takes</strong> next, exploration included (on-policy).',
        'double-qlearning': 'Double Q-learning keeps <strong>two</strong> Q-tables: one picks the next action and the other values it, which reduces the overestimation of Q-learning.'
      }[cfg.algorithm] || '';
      return [
        html(`<strong>${esc(name)}</strong>. ${text}`),
        list([
          `α = ${Number(cfg.alpha).toFixed(2)}: how far each update moves the Q-value.`,
          `γ = ${Number(cfg.gamma).toFixed(2)}: how much the rest of the tour counts.`,
          'Formulas and references: <a href="#c-rl">Concepts &amp; references</a>.'
        ])
      ];
    }
    if (kind === 'instance') {
      return [
        html(`<strong>${esc(cfg.instance)}</strong> is ${inst?.type === 'ATSP' ? 'an <strong>asymmetric</strong> TSP (going i → j can cost more or less than j → i)' : 'a <strong>symmetric</strong> TSP'} from TSPLIB with ${inst ? fmtInt(inst.dimension) : '?'} cities.`),
        list([
          `Each episode builds one complete tour through all ${inst ? fmtInt(inst.dimension) : ''} cities.`,
          inst?.optimum ? `Best known tour: ${fmtInt(inst.optimum)}. The gap to optimum measures how far a tour is from it.` : 'No known optimum is listed for this instance.',
          inst?.type === 'ATSP' ? 'Its distances come from a full matrix.' : 'Its distances come from city coordinates.'
        ])
      ];
    }
    const eps = run.cols.epsilon;
    const constant = eps.length && eps.every(v => v === eps[0]);
    const describe = {
      linear: 'falls at a constant rate',
      concave: 'falls quickly at first, then more slowly',
      convex: 'stays near ε₀ for a long time, then drops near the end',
      fixed: 'never changes',
      step: 'is meant to fall in steps'
    }[cfg.epsilon_decay] || '';
    return [
      html(`With <strong>${esc(cfg.epsilon_decay)}</strong> decay, ε ${describe}: from <strong>${eps[0] ?? cfg.epsilon_init}</strong> to <strong>${formatValue(eps[eps.length - 1])}</strong> at episode ${fmtInt(run.n - 1)}.`),
      list([
        'With probability ε the agent picks a random city; otherwise it takes the best one in its Q-table.',
        constant && cfg.epsilon_decay === 'step'
          ? 'In this dataset no step happens within 1,000 episodes, so these runs behave like <em>fixed</em>.'
          : 'Details of each schedule: <a href="#c-settings">Concepts &amp; references</a>.'
      ])
    ];
  }

  // Every alpha x gamma run that shares the other settings, from the summary files. The grid
  // does not depend on the episode, so it is redrawn only when the run, unit or width changes.
  function renderGrid() {
    const { run, shard } = state;
    if (!shard) return;
    const key = [run.id, settings.energyUnit, $('grid-gap').clientWidth].join('|');
    if (key === state.gridKey) return;
    state.gridKey = key;
    const param = k => PARAMS.find(p => p.key === k);
    const inst = instances[run.config.instance];
    const cellOf = (g, a) => shard.cells.find(c => Math.abs(c.gamma - g) < 1e-9 && Math.abs(c.alpha - a) < 1e-9);
    const metric = fn => (g, a) => { const c = cellOf(g, a); return c ? fn(c.summary) : NaN; };
    const short = v => (Math.abs(v) >= 0.01 && Math.abs(v) < 1e4 ? d3.format('.3~r')(v) : d3.format('.1e')(v));
    const label = v => Number(v).toFixed(2);
    const common = {
      rows: param('gamma').values, cols: param('alpha').values, rowLabel: label, colLabel: label,
      selected: { row: run.config.gamma, col: run.config.alpha },
      onSelect: (gamma, alpha) => { state.config = { ...state.config, gamma, alpha }; onConfigChange(); }
    };
    GreenRLCharts.gridHeatmap($('grid-gap'), {
      ...common, ariaLabel: 'Gap to optimum for every alpha and gamma',
      unit: inst?.optimum ? 'gap to optimum' : 'best distance',
      value: metric(s => (inst?.optimum ? ((s.best - inst.optimum) / inst.optimum) * 100 : s.best)),
      format: (v, compact) => (!Number.isFinite(v) ? '—' : inst?.optimum ? `${d3.format(compact ? '.0f' : '.1f')(v)}%` : fmtInt(v))
    });
    GreenRLCharts.gridHeatmap($('grid-energy'), {
      ...common, ariaLabel: 'Total energy for every alpha and gamma', unit: 'total energy',
      value: metric(s => s.energy * ENERGY_UNITS[settings.energyUnit]),
      format: (v, compact) => (!Number.isFinite(v) ? '—' : compact ? short(v) : `${formatValue(v)} ${settings.energyUnit}`)
    });
    $('grid-energy-title').textContent = `Total energy (${settings.energyUnit})`;
    $('grid-caption').textContent = `${displayValue(param('algorithm'), run.config.algorithm)} · ${run.config.instance} · ` +
      `${run.config.reward} · ${run.config.epsilon_decay} decay · ε₀ = ${run.config.epsilon_init}. ` +
      'Each cell is a whole run; lighter = lower (better), ★ = lowest. Click a cell to open it.';
  }

  // Lowest, selected and highest grid under the map, plus how far apart the extremes are.
  function renderCountryFacts(spec) {
    const ranked = [...spec.opts.countries].sort((a, b) => a.value - b.value);
    if (!ranked.length) return;
    const lo = ranked[0], hi = ranked[ranked.length - 1];
    const sel = ranked.find(c => c.iso === spec.opts.selected);
    const unit = spec.opts.unit;
    const fact = (name, title, c) => {
      const div = document.createElement('div');
      div.className = 'map-fact';
      const head = document.createElement('span');
      head.append(icon(name), title);
      const body = document.createElement('strong');
      body.append(flagImg(c.flag), c.name);
      const sub = document.createElement('small');
      sub.textContent = `${formatValue(c.value)} ${unit} · ${formatValue(c.intensity)} g/kWh`;
      div.append(head, body, sub);
      return div;
    };
    const ratio = document.createElement('p');
    ratio.className = 'map-ratio';
    ratio.append(icon('info'),
      `${d3.format(',.0f')(hi.value / lo.value)}× more CO₂eq in ${hi.name} than in ${lo.name}, for the same run.`);
    $('country-facts').replaceChildren(
      fact('leaf', 'Cleanest grid', lo),
      ...(sel ? [fact('map-pin', settings.country === MEASURED ? 'As measured' : 'Your selection', sel)] : []),
      fact('factory', 'Most carbon-intensive grid', hi),
      ratio
    );
  }

  // Everyday equivalents and the daily projection for the episodes shown so far
  // (factors and sources: data/equivalents.json).
  function everydaySpec(run, episode, basis) {
    const Eq = GreenRLEquivalents;
    const i = episode - 1;
    const amounts = { energy: run.cumulative.energy_consumed[i], emissions: basis.cumulative[i] * basis.factor };
    const item = (eq, amount) => ({ ...Eq.describe(eq, amount), eq, source: Eq.sourceNumber(eq.source), published: eq.published });
    const groups = [
      { basis: 'energy', title: `Energy · ${energyText(amounts.energy)}` },
      { basis: 'emissions', title: `Emissions · ${emissionsText(amounts.emissions)} CO₂eq · ${basis.label}`, flag: basis.flag }
    ].map(g => ({ ...g, items: Eq.list.filter(eq => eq.basis === g.basis).map(eq => item(eq, amounts[g.basis])) }));

    const days = [1, 30, 365];
    const eqRow = (id, label) => {
      const eq = Eq.byId(id);
      return {
        label, eq, source: Eq.sourceNumber(eq.source), published: eq.published,
        cells: days.map(d => {
          const { value, label: text } = Eq.describe(eq, amounts[eq.basis] * d);
          return text.startsWith('of one') ? `${value} of one` : value;
        })
      };
    };
    return {
      scope: `Episodes ${epLabel(run, 0)}–${epLabel(run, i)} · ${basis.label}`,
      groups,
      columns: [
        { icon: 'play', label: 'This run', times: '×1' },
        { icon: 'calendar-days', label: '1 month', times: '×30' },
        { icon: 'calendar-range', label: '1 year', times: '×365' }
      ],
      rows: [
        { label: 'Energy', eq: { icon: 'zap', basis: 'energy' }, cells: days.map(d => energyText(amounts.energy * d)) },
        eqRow('smartphone', 'Phone charges'),
        eqRow('electric_car', 'Electric car'),
        { label: `Emissions · ${basis.label}`, eq: { icon: 'cloud', basis: 'emissions' },
          cells: days.map(d => `${emissionsText(amounts.emissions * d)} CO₂eq`) },
        eqRow('petrol_car', 'Petrol car'),
        eqRow('tree', 'Tree absorbing it')
      ],
      sources: Eq.sourceList(),
      retrieved: Eq.retrieved
    };
  }

  function renderEveryday(spec) {
    const ref = n => {
      const a = document.createElement('a');
      a.className = 'eq-ref';
      a.href = `#ref-${n}`;
      a.textContent = `[${n}]`;
      return a;
    };
    $('eq-scope').textContent = spec.scope;
    $('eq-cards').replaceChildren(...spec.groups.map(group => {
      const wrap = document.createElement('div');
      wrap.className = 'eq-group';
      const title = document.createElement('h4');
      if (group.flag) title.appendChild(flagImg(group.flag));
      title.append(group.title);
      const grid = document.createElement('div');
      grid.className = 'eq-grid';
      grid.append(...group.items.map(it => {
        const card = document.createElement('div');
        card.className = `eq-card ${group.basis}`;
        card.title = `Source value: ${it.published}`;
        const pic = document.createElement('span');
        pic.innerHTML = GreenRLEquivalents.iconHtml(it.eq, group.basis);
        const text = document.createElement('div');
        const value = document.createElement('strong');
        value.textContent = it.value;
        const label = document.createElement('span');
        label.append(`${it.label} `, ref(it.source));
        text.append(value, label);
        card.append(pic.firstElementChild, text);
        return card;
      }));
      wrap.append(title, grid);
      return wrap;
    }));

    const head = document.createElement('tr');
    head.appendChild(document.createElement('th'));
    spec.columns.forEach(col => {
      const th = document.createElement('th');
      const times = document.createElement('span');
      times.className = 'times';
      times.textContent = col.times;
      th.append(icon(col.icon), ` ${col.label} `, times);
      head.appendChild(th);
    });
    const rows = spec.rows.map(row => {
      const tr = document.createElement('tr');
      const th = document.createElement('td');
      const pic = document.createElement('span');
      pic.innerHTML = GreenRLEquivalents.iconHtml(row.eq);
      th.append(pic.firstElementChild, row.label);
      if (row.source) th.append(' ', ref(row.source));
      tr.appendChild(th);
      row.cells.forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      return tr;
    });
    const thead = document.createElement('thead');
    thead.appendChild(head);
    const tbody = document.createElement('tbody');
    tbody.append(...rows);
    $('eq-projection').replaceChildren(thead, tbody);
  }

  // Chart options shared by the page and the report, so both always show the same thing.
  function chartSpecs(run, episode, basis) {
    const cumulative = state.mode === 'cumulative';
    const pick = key => (cumulative ? run.cumulative[key] : run.cols[key]);
    const kind = cumulative ? 'last' : 'band';
    const title = (what, unit) => (cumulative ? `Cumulative ${what.toLowerCase()} (${unit})` : `${what} per episode (${unit})`);
    const i = episode - 1;
    const bestIdx = run.bestIdx[i];
    const inst = instances[run.config.instance];
    const base = run.firstEpisode;
    const energyKWh = run.cumulative.energy_consumed[i];
    const emissionsFactor = EMISSION_UNITS[settings.emissionsUnit];

    const energySeries = [
      { label: 'Total', color: '--series-1', values: pick('energy_consumed') },
      { label: 'CPU', color: '--series-2', values: pick('cpu_energy') },
      { label: 'RAM', color: '--series-3', values: pick('ram_energy') }
    ].map(s => ({ ...s, kind, unit: settings.energyUnit }));

    return {
      energy: {
        title: title('Energy', settings.energyUnit),
        caption: cumulative
          ? 'Running total.'
          : 'Line = mean · band = min–max.',
        legend: energySeries,
        opts: { end: episode, base, series: energySeries, scale: ENERGY_UNITS[settings.energyUnit], zeroBased: true, height: 260,
          ariaLabel: 'Energy per episode: total, CPU and RAM' }
      },
      emissions: {
        title: title('Emissions', `${settings.emissionsUnit} CO₂eq`),
        caption: gridText(basis),
        opts: { end: episode, base, scale: basis.factor * emissionsFactor, zeroBased: true, ariaLabel: 'Emissions per episode',
          series: [{ label: 'Emissions', color: '--series-1', kind, unit: settings.emissionsUnit, endLabel: true,
            values: cumulative ? basis.cumulative : basis.perEpisode }] }
      },
      duration: {
        title: title('Duration', 's'),
        opts: { end: episode, base, zeroBased: true, ariaLabel: 'Duration per episode',
          series: [{ label: 'Duration', color: '--series-1', values: pick('duration'), kind, unit: 's', endLabel: true }] }
      },
      country: {
        caption: `The same energy (${energyText(energyKWh)}) on each country's grid. Click a country to select it.`,
        opts: {
          unit: `${settings.emissionsUnit} CO₂eq`, selected: basis.iso, ariaLabel: 'Map of the emissions of this run in every country',
          countries: countries.map(c => ({ ...c, value: energyKWh * c.intensity / 1000 * emissionsFactor })),
          perIntensity: energyKWh / 1000 * emissionsFactor
        }
      },
      distance: {
        caption: inst?.optimum ? 'Grey line = known optimum.' : '',
        legend: [
          { label: 'Episode distance', color: '--series-1' },
          { label: 'Best so far', color: '--series-2' }
        ],
        opts: {
          end: episode, base, height: 380, ariaLabel: 'Distance per episode with best distance so far',
          series: [
            { label: 'Episode distance', color: '--series-1', values: run.cols.distance, kind: 'band' },
            { label: 'Best so far', color: '--series-2', values: run.bestSoFar, kind: 'last', curve: 'step' }
          ],
          refLine: inst?.optimum ? { value: inst.optimum, label: `optimum ${fmtInt(inst.optimum)}` } : null,
          marker: bestIdx >= 0 ? {
            episode: bestIdx + 1, value: run.cols.distance[bestIdx], color: '--series-2',
            label: `best ${formatValue(run.cols.distance[bestIdx])} · ep ${epLabel(run, bestIdx)}`
          } : null
        }
      },
      everyday: everydaySpec(run, episode, basis)
    };
  }

  function renderCharts(basis) {
    const { run, episode } = state;
    const specs = chartSpecs(run, episode, basis);
    const i = episode - 1;
    const bestIdx = run.bestIdx[i];

    $('energy-title').textContent = specs.energy.title;
    $('energy-caption').textContent = specs.energy.caption;
    $('emissions-title').textContent = specs.emissions.title;
    $('emissions-caption').textContent = specs.emissions.caption;
    $('duration-title').textContent = specs.duration.title;
    $('country-caption').textContent = specs.country.caption;
    $('distance-caption').textContent = specs.distance.caption;

    GreenRLCharts.legend('#energy-legend', specs.energy.legend);
    GreenRLCharts.timeSeries($('energy-chart'), specs.energy.opts);
    GreenRLCharts.timeSeries($('emissions-chart'), specs.emissions.opts);
    GreenRLCharts.timeSeries($('duration-chart'), specs.duration.opts);
    GreenRLCharts.countryMap($('country-chart'), {
      ...specs.country.opts, onSelect: iso => { settings.country = iso; onSettingsChange(); }
    });
    renderCountryFacts(specs.country);
    renderFlow(run, episode, basis);
    renderEveryday(specs.everyday);
    GreenRLCharts.legend('#distance-legend', specs.distance.legend);
    GreenRLCharts.timeSeries($('distance-chart'), specs.distance.opts);
  }

  // ---------- Report ----------

  function openReportDialog() {
    if (!state.run) return;
    pause();
    const { run } = state;
    const basis = emissionsBasis(run);
    $('report-scope').textContent =
      `${displayValue(PARAMS[0], run.config.algorithm)} · ${run.config.instance} · seed ${run.config.seed} · ` +
      `episodes ${epLabel(run, 0)}–${epLabel(run, state.episode - 1)} · ${basis.label}`;
    $('report-dialog').showModal();
  }

  function exportReport(format) {
    const run = state.run;
    const basis = emissionsBasis(run);
    const sections = new Set([...document.querySelectorAll('#report-dialog input[name="section"]:checked')]
      .filter(input => !input.closest('[hidden]')).map(input => input.value));
    const html = GreenRLReport.build({
      run, episode: state.episode, sections, instance: instances[run.config.instance],
      specs: chartSpecs(run, state.episode, basis), params: PARAMS, displayValue, basis,
      gridText: gridText(basis), epLabel: index => epLabel(run, index),
      units: { energy: settings.energyUnit, energyFactor: ENERGY_UNITS[settings.energyUnit],
        emissions: settings.emissionsUnit, emissionsFactor: EMISSION_UNITS[settings.emissionsUnit] },
      mode: state.mode, durationText, gapText: d => gapText(run, d)
    });
    $('report-dialog').close();
    const name = `report_${run.id}_ep${epLabel(run, state.episode - 1).replace(/,/g, '')}`;
    if (format === 'html') GreenRLReport.download(html, `${name}.html`);
    else GreenRLReport.print(html, name);
  }

  // ---------- Start ----------

  GreenRLIcons.hydrate();
  state.config = initialConfig();
  buildControls();
  GreenRLCompare.init({
    PARAMS, displayValue, valueKey, runId, available, instances, settings,
    ENERGY_UNITS, EMISSION_UNITS, fmtInt, formatValue,
    energyText, emissionsText, durationText, gapText, epLabel, measuredCountry, emissionsBasis,
    configForm, nearestRuns, updateHash, updateGridSettings
  }, parseRunId(hash.get('a')), parseRunId(hash.get('b')));
  $('dataset-count').textContent = `${fmtInt(manifest.runs || 0)} runs · ${fmtInt(manifest.episodes || 0)} episodes each`;
  syncExploreForm();
  $('run-id').textContent = runId(state.config);
  updateGridSettings();
  load();
  if (['compare', 'concepts'].includes(hash.get('tab'))) showTab(hash.get('tab'));
})();

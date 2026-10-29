// Page controller: shared settings (grid, units), country picker, Explore tab and report export.
// Loaded last; it wires the other modules (config, data, charts, equivalents, report, compare).
(() => {
  const { PARAMS, valueKey, displayValue, runId, parseRunId } = GreenRLConfig;
  const { formatValue, formatSI, siPrefix, flagUrl } = GreenRLCharts;
  const { instances = {}, countries = [] } = window.GREEN_RL_REFERENCE || {};
  const countryByIso = Object.fromEntries(countries.map(c => [c.iso, c]));
  const { manifest } = GreenRL;
  // Same interface as a Set of run ids: available.has(runId).
  const available = { has: id => GreenRL.available(parseRunId(id)) };

  // Energy is stored in kWh and emissions in kg CO2eq. They are shown in J (or Wh) and g, with the
  // SI prefix that suits each value (20.2 J, 11.2 mJ, 1.63 mg), so no number needs scientific notation.
  const ENERGY_UNITS = {
    J: { perKWh: 3.6e6, label: 'Joules (mJ, J, kJ)' },
    Wh: { perKWh: 1e3, label: 'Watt-hours (mWh, Wh, kWh)' }
  };
  // Title of each view, shown in the page title bar.
  const PAGES = {
    config: 'Initial setup',
    explore: 'Explore a run',
    compare: 'Compare two runs',
    concepts: 'Concepts & references'
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
    energyUnit: 'J'      // a key of ENERGY_UNITS
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
    view: 'energy',      // 'energy' or 'performance': the results shown under the playback bar
    // Charts of each view, large one first; clicking a small chart moves it to the front.
    deck: { energy: ['energy', 'emissions', 'duration'], performance: ['distance', 'gap', 'improvements'] },
    loadToken: 0
  };

  // ---------- Helpers shared with the compare tab ----------

  const energyText = kWh => formatSI(kWh * ENERGY_UNITS[settings.energyUnit].perKWh, settings.energyUnit);
  const emissionsText = kg => formatSI(kg * 1000, 'g');
  const epLabel = (run, index) => fmtInt(index + run.firstEpisode);  // 0-based index -> number in the data

  // Scale and unit for a chart axis whose largest value is `max`, so it reads 0–40 mJ, not 0–1.2e-8 kWh.
  function energyAxis(maxKWh) {
    const perKWh = ENERGY_UNITS[settings.energyUnit].perKWh;
    const p = siPrefix(maxKWh * perKWh);
    return { scale: perKWh / p.factor, unit: p.symbol + settings.energyUnit };
  }
  function emissionsAxis(maxKg) {
    const p = siPrefix(maxKg * 1000);
    return { scale: 1000 / p.factor, unit: `${p.symbol}g` };
  }
  function durationAxis(maxSeconds) {
    const p = maxSeconds >= 1 ? { factor: 1, symbol: '' } : siPrefix(maxSeconds);
    return { scale: 1 / p.factor, unit: `${p.symbol}s` };
  }

  function durationText(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    if (seconds < 1) return formatSI(seconds, 's');
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
    if (hash.get('view') === 'performance') state.view = 'performance';
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

    Object.entries(ENERGY_UNITS).forEach(([u, def]) => $('energy-unit').add(new Option(def.label, u)));
    $('energy-unit').value = settings.energyUnit;
    $('energy-unit').addEventListener('change', e => { settings.energyUnit = e.target.value; onSettingsChange(); });

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
    // A link into Concepts & references first shows the section that holds its target.
    document.addEventListener('click', e => {
      const link = e.target.closest('a[href^="#"]');
      const target = link && document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      e.preventDefault();
      const section = target.closest('#tab-concepts .concept');
      if (section) showConcept(section.id);
      const panel = target.closest('[role="tabpanel"][hidden]');
      if (panel) showTab(panel.id.replace('tab-', ''));
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
    });

    $('explore-weight').appendChild(GreenRLScores.view.weightControl(() => { state.overviewKey = null; renderOverview(); }));

    document.querySelectorAll('.view-tabs [role="tab"]').forEach(tab => {
      tab.addEventListener('click', () => showView(tab.dataset.view));
    });
    // A small chart swaps places with the large one of its view.
    document.querySelectorAll('.deck-thumb').forEach(button => {
      button.addEventListener('click', () => {
        const order = state.deck[button.closest('.view').id.replace('view-', '')];
        const k = order.indexOf(button.dataset.chart);
        [order[0], order[k]] = [order[k], order[0]];
        render();
      });
    });
    $('open-explore').addEventListener('click', () => showTab('explore'));
    $('palette-btn').addEventListener('click', () => setPalette(document.documentElement.dataset.palette !== 'cvd'));

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
      resizeTimer = setTimeout(() => {
        if (settings.tab === 'explore') render();
        if (settings.tab === 'compare') GreenRLCompare.render();
      }, 150);
    });
  }

  function showTab(tab) {
    settings.tab = tab;
    pause();
    document.querySelectorAll('.nav-list [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    Object.keys(PAGES).forEach(name => { $(`tab-${name}`).hidden = name !== tab; });
    $('page-title').textContent = PAGES[tab];
    $('status-pill').hidden = tab === 'concepts';
    if (tab === 'compare') GreenRLCompare.show(state.config);
    else render();
    updateGridSettings();
    updateHash();
  }

  // Energy or Performance view of the Explore tab. Only the open view is drawn (a chart in a hidden
  // view would have no width). The ECOVIS score panel moves to the top of the open view.
  function showView(view) {
    state.view = view;
    document.querySelectorAll('.view-tabs [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    ['energy', 'performance'].forEach(name => { $(`view-${name}`).hidden = name !== view; });
    $(`score-slot-${view}`).appendChild($('score-panel'));
    updateHash();
    render();
  }

  // Colour-blind palette on or off. The colours are CSS variables (css/style.css, [data-palette="cvd"]);
  // charts read them when drawn, so the open tab is redrawn. The choice is remembered in this browser.
  function setPalette(cvd) {
    if (cvd) document.documentElement.dataset.palette = 'cvd';
    else delete document.documentElement.dataset.palette;
    $('palette-btn').setAttribute('aria-pressed', String(cvd));
    try { localStorage.setItem('ecovis-palette', cvd ? 'cvd' : 'default'); } catch (e) { /* storage blocked */ }
    if (settings.tab === 'explore') render();
    if (settings.tab === 'compare') GreenRLCompare.render();
  }

  // Concepts & references shows one section at a time; the contents list picks which.
  function showConcept(id) {
    document.querySelectorAll('#tab-concepts .concept').forEach(s => { s.hidden = s.id !== id; });
    document.querySelectorAll('.concepts-toc a').forEach(a => {
      const current = a.getAttribute('href') === `#${id}`;
      a.classList.toggle('current', current);
      if (current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }

  function onSettingsChange() {
    updateGridSettings();
    updateHash();
    if (settings.tab === 'explore') render();
    if (settings.tab === 'compare') GreenRLCompare.render();
  }

  function updateGridSettings() {
    const measured = settings.tab === 'compare' ? GreenRLCompare.measuredCountry() : measuredCountry(state.run);
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
      if (settings.tab !== 'explore') params.set('tab', settings.tab);
      params.set('run', runId(state.config));
      params.set('ep', state.episode);
      if (state.view !== 'energy') params.set('view', state.view);
    }
    if (settings.country !== MEASURED) params.set('country', settings.country);
    history.replaceState(null, '', `#${params}`);
  }

  // ---------- Loading ----------

  function onConfigChange() {
    pause();
    syncExploreForm();
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
    $('config-status').textContent = '';
    $('open-explore').disabled = false;
    $('dashboard').classList.add('is-loading');
    Promise.all([GreenRL.loadRun(id), GreenRL.loadShard(state.config)]).then(([run, shard]) => {
      if (token !== state.loadToken) return;
      state.run = run;
      state.shard = shard;
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
    $('open-explore').disabled = !errorMessage;
    $('config-status').textContent = errorMessage ? '' : 'Not in the dataset: change a parameter marked ∅.';
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
    renderEpisodeState();
    const specs = chartSpecs(state.run, state.episode, basis);
    if (state.view === 'energy') renderEnergy(specs, basis);
    else renderPerformance(specs);
    renderOverview();
  }

  // Playback bar: slider, episode box and the "new best" badge.
  function renderEpisodeState() {
    const { run, episode } = state;
    const i = episode - 1;
    $('episode-range').value = episode;
    $('episode-input').value = i + run.firstEpisode;
    $('new-best-badge').hidden = run.bestIdx[i] !== i;
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

  // Run chips and ECOVIS score. Neither depends on the episode, so they are rebuilt only when
  // the run or the score weight changes.
  function renderOverview() {
    const { run } = state;
    const key = [run.id, GreenRLScores.weight].join('|');
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

    renderScore(run);
  }

  // ECOVIS score of the open run, against every run on its instance.
  function renderScore(run) {
    const S = GreenRLScores;
    const token = state.scoreToken = (state.scoreToken || 0) + 1;
    S.load(run.config.instance).then(table => {
      if (token !== state.scoreToken) return;
      const s = S.scoreOf(table, run.config);
      if (s) $('explore-score').replaceChildren(S.view.card(s, { instance: run.config.instance, compact: true }));
    }).catch(err => { $('explore-score').textContent = err.message; });
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
        eqRow('gemini', 'AI prompts (Gemini)'),
        eqRow('electric_car', 'Electric car'),
        { label: `Emissions · ${basis.label}`, eq: { icon: 'cloud', basis: 'emissions' },
          cells: days.map(d => `${emissionsText(amounts.emissions * d)} CO₂eq`) },
        eqRow('petrol_car', 'Petrol car'),
        eqRow('streaming', 'Video streaming'),
        eqRow('tree', 'Tree absorbing it')
      ],
      sources: Eq.sourceList(),
      retrieved: Eq.retrieved
    };
  }

  // The daily projection table (the report also lists every equivalent).
  function renderEveryday(spec) {
    const ref = n => {
      const a = document.createElement('a');
      a.className = 'eq-ref';
      a.href = `#ref-${n}`;
      a.textContent = `[${n}]`;
      return a;
    };
    $('eq-scope').textContent = spec.scope;
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

  // Performance series derived from a run, computed once per run: the gap to optimum of each
  // episode and of the best tour so far (%), and the running count of new best tours.
  const derived = new WeakMap();
  function performanceSeries(run, optimum) {
    if (!derived.has(run)) {
      const gap = new Float64Array(run.n), bestGap = new Float64Array(run.n), count = new Float64Array(run.n);
      for (let i = 0, k = 0; i < run.n; i++) {
        if (optimum) {
          gap[i] = ((run.cols.distance[i] - optimum) / optimum) * 100;
          bestGap[i] = ((run.bestSoFar[i] - optimum) / optimum) * 100;
        }
        while (k < run.improvements.length && run.improvements[k] <= i) k++;
        count[i] = k;
      }
      derived.set(run, { gap, bestGap, count });
    }
    return derived.get(run);
  }

  // Chart options shared by the page and the report, so both always show the same thing.
  // Each chart: { icon, title, caption, legend, opts }. Axis units come from the whole run, so they
  // stay the same while the run plays.
  function chartSpecs(run, episode, basis) {
    const cumulative = state.mode === 'cumulative';
    const pick = key => (cumulative ? run.cumulative[key] : run.cols[key]);
    const kind = cumulative ? 'last' : 'band';
    const title = what => (cumulative ? `Cumulative ${what.toLowerCase()}` : `${what} per episode`);
    const i = episode - 1;
    const bestIdx = run.bestIdx[i];
    const inst = instances[run.config.instance];
    const base = run.firstEpisode;
    const energyKWh = run.cumulative.energy_consumed[i];
    const perf = performanceSeries(run, inst?.optimum);

    const energy = energyAxis(d3.max(pick('energy_consumed')));
    const emissionsValues = cumulative ? basis.cumulative : basis.perEpisode;
    const emissions = emissionsAxis(d3.max(emissionsValues) * basis.factor);
    const duration = durationAxis(d3.max(pick('duration')));
    const energySeries = [
      { label: 'Total', color: '--series-1', values: pick('energy_consumed') },
      { label: 'CPU', color: '--series-2', values: pick('cpu_energy') },
      { label: 'RAM', color: '--series-3', values: pick('ram_energy') }
    ].map(s => ({ ...s, kind, unit: energy.unit }));
    // Map values in grams (kWh × g/kWh), with one prefix for every country.
    const map = siPrefix(energyKWh * d3.max(countries, c => c.intensity));

    return {
      energy: {
        icon: 'zap', title: title('Energy'), unit: energy.unit,
        caption: cumulative ? 'Running total.' : 'Line = mean · band = min–max.',
        legend: energySeries,
        opts: { end: episode, base, series: energySeries, scale: energy.scale, zeroBased: true,
          yLabel: `Energy (${energy.unit})`, ariaLabel: 'Energy per episode: total, CPU and RAM' }
      },
      emissions: {
        icon: 'cloud', title: title('Emissions'), unit: `${emissions.unit} CO₂eq`, caption: gridText(basis),
        opts: { end: episode, base, scale: basis.factor * emissions.scale, zeroBased: true,
          yLabel: `Emissions (${emissions.unit} CO₂eq)`, ariaLabel: 'Emissions per episode',
          series: [{ label: 'Emissions', color: '--series-1', kind, unit: emissions.unit, endLabel: true, values: emissionsValues }] }
      },
      duration: {
        icon: 'timer', title: title('Duration'), unit: duration.unit, caption: cumulative ? 'Running total.' : 'Time each episode took.',
        opts: { end: episode, base, scale: duration.scale, zeroBased: true, yLabel: `Duration (${duration.unit})`,
          ariaLabel: 'Duration per episode',
          series: [{ label: 'Duration', color: '--series-1', values: pick('duration'), kind, unit: duration.unit, endLabel: true }] }
      },
      country: {
        caption: `The same energy (${energyText(energyKWh)}) on each country's grid. Click a country to select it.`,
        opts: {
          unit: `${map.symbol}g CO₂eq`, selected: basis.iso, ariaLabel: 'Map of the emissions of this run in every country',
          countries: countries.map(c => ({ ...c, value: (energyKWh * c.intensity) / map.factor })),
          perIntensity: energyKWh / map.factor
        }
      },
      distance: {
        icon: 'route', title: 'Distance per episode', caption: inst?.optimum ? 'Grey line = known optimum.' : '',
        legend: [
          { label: 'Episode distance', color: '--series-1' },
          { label: 'Best so far', color: '--series-2' }
        ],
        opts: {
          end: episode, base, yLabel: 'Tour length', ariaLabel: 'Distance per episode with best distance so far',
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
      gap: inst?.optimum ? {
        icon: 'target', title: 'Gap to optimum', unit: '%', caption: 'How much longer each tour is than the best known tour; 0% is optimal.',
        legend: [
          { label: 'Episode gap', color: '--series-1' },
          { label: 'Best so far', color: '--series-2' }
        ],
        opts: { end: episode, base, zeroBased: true, yLabel: 'Gap (%)', ariaLabel: 'Gap to optimum per episode and of the best tour so far',
          series: [
            { label: 'Episode gap', color: '--series-1', values: perf.gap, kind: 'band', unit: '%' },
            { label: 'Best so far', color: '--series-2', values: perf.bestGap, kind: 'last', curve: 'step', unit: '%' }
          ] }
      } : {
        icon: 'target', title: 'Best distance so far', caption: 'No known optimum for this instance.',
        opts: { end: episode, base, yLabel: 'Tour length', ariaLabel: 'Best distance so far',
          series: [{ label: 'Best so far', color: '--series-2', values: run.bestSoFar, kind: 'last', curve: 'step', endLabel: true }] }
      },
      improvements: {
        icon: 'trending-down', title: 'New best tours', caption: 'Running count of episodes that found a shorter tour than every episode before.',
        opts: { end: episode, base, zeroBased: true, yLabel: 'New best tours', ariaLabel: 'Running count of new best tours',
          series: [{ label: 'New best tours', color: '--series-1', values: perf.count, kind: 'last', curve: 'step', endLabel: true }] }
      },
      everyday: everydaySpec(run, episode, basis)
    };
  }

  // One large chart and two small ones (buttons) for a view, in the order of state.deck[view].
  function renderDeck(view, specs) {
    const root = $(`${view}-deck`);
    const [main, ...small] = state.deck[view];
    const spec = specs[main];
    root.querySelector('.deck-icon').replaceChildren(icon(spec.icon));
    root.querySelector('.deck-title').textContent = spec.title;
    root.querySelector('.deck-unit').textContent = spec.unit || '';
    root.querySelector('.deck-unit').hidden = !spec.unit;
    root.querySelector('.deck-caption').textContent = spec.caption || '';
    GreenRLCharts.legend(root.querySelector('.deck-legend'), spec.legend || []);
    GreenRLCharts.timeSeries(root.querySelector('.deck-chart'), spec.opts);
    root.querySelectorAll('.deck-thumb').forEach((button, k) => {
      const s = specs[small[k]];
      if (!button.firstChild) {
        const head = document.createElement('span');
        head.className = 'deck-thumb-head';
        const legend = document.createElement('span');
        legend.className = 'legend';
        const chart = document.createElement('span');
        chart.className = 'chart small';
        const hint = document.createElement('span');
        hint.className = 'deck-hint';
        hint.textContent = 'Click to enlarge';
        button.append(head, legend, chart, hint);
      }
      button.dataset.chart = small[k];
      button.setAttribute('aria-label', `Show ${s.title.toLowerCase()} as the large chart`);
      const unit = document.createElement('span');
      unit.className = 'unit-badge';
      unit.textContent = s.unit || '';
      button.querySelector('.deck-thumb-head').replaceChildren(icon(s.icon), s.title, ...(s.unit ? [unit] : []));
      GreenRLCharts.legend(button.querySelector('.legend'), s.legend || []);
      GreenRLCharts.timeSeries(button.querySelector('.chart'), { ...s.opts, interactive: false, marker: null });
    });
  }

  function renderEnergy(specs, basis) {
    const { run, episode } = state;
    $('country-caption').textContent = specs.country.caption;
    renderFlow(run, episode, basis);
    renderDeck('energy', specs);
    GreenRLCharts.countryMap($('country-chart'), {
      ...specs.country.opts, onSelect: iso => { settings.country = iso; onSettingsChange(); }
    });
    renderCountryFacts(specs.country);
    renderEveryday(specs.everyday);
  }

  function renderPerformance(specs) {
    renderKpis();
    renderDeck('performance', specs);
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
      energyText, emissionsText, mode: state.mode, durationText, gapText: d => gapText(run, d)
    });
    $('report-dialog').close();
    const name = `report_${run.id}_ep${epLabel(run, state.episode - 1).replace(/,/g, '')}`;
    if (format === 'html') GreenRLReport.download(html, `${name}.html`);
    else GreenRLReport.print(html, name);
  }

  // ---------- Start ----------

  GreenRLIcons.hydrate();
  try { if (localStorage.getItem('ecovis-palette') === 'cvd') document.documentElement.dataset.palette = 'cvd'; } catch (e) { /* storage blocked */ }
  $('palette-btn').setAttribute('aria-pressed', String(document.documentElement.dataset.palette === 'cvd'));
  state.config = initialConfig();
  buildControls();
  GreenRLCompare.init({
    PARAMS, displayValue, valueKey, runId, available, instances, settings,
    energyAxis, emissionsAxis, fmtInt, formatValue,
    energyText, emissionsText, durationText, gapText, epLabel, measuredCountry, emissionsBasis,
    configForm, nearestRuns, updateHash, updateGridSettings
  }, parseRunId(hash.get('a')), parseRunId(hash.get('b')));
  $('dataset-count').textContent = `${fmtInt(manifest.runs || 0)} runs · ${fmtInt(manifest.episodes || 0)} episodes each`;
  syncExploreForm();
  updateGridSettings();
  load();
  showConcept('c-about');
  if (state.view !== 'energy') showView(state.view);
  // A link to a run opens Explore; a visit without one starts at Initial setup.
  const startTab = PAGES[hash.get('tab')] ? hash.get('tab') : hash.get('run') ? 'explore' : 'config';
  if (startTab !== 'explore') showTab(startTab);
})();

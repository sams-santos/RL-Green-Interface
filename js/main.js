(() => {
  const dataset = window.GREEN_RL_DATA;
  if (!dataset || !dataset.runs || !dataset.runs.length) {
    document.body.innerHTML = '<p style="padding:30px">Dataset not found.</p>';
    return;
  }

  let selectedRun = dataset.runs[0];
  let currentIndex = 0;
  let timer = null;

  const $ = id => document.getElementById(id);
  const status = $('status-pill');

  dataset.runs.forEach((run, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `${run.runId} — ${run.algorithm} — ${run.instance}`;
    $('run-select').appendChild(option);
  });

  $('run-select').addEventListener('change', event => {
    stop();
    selectedRun = dataset.runs[Number(event.target.value)];
    currentIndex = 0;
    renderAll();
  });

  $('play-btn').addEventListener('click', start);
  $('pause-btn').addEventListener('click', stop);
  $('reset-btn').addEventListener('click', () => { stop(); currentIndex = 0; renderAll(); });
  $('speed-range').addEventListener('input', event => {
    $('speed-value').textContent = `${event.target.value} ms`;
    if (timer) { stop(); start(); }
  });
  $('export-btn').addEventListener('click', exportCSV);

  function start() {
    if (currentIndex >= selectedRun.episodes.length - 1) currentIndex = 0;
    stop();
    status.textContent = 'Playing';
    timer = setInterval(() => {
      currentIndex += 1;
      renderAll();
      if (currentIndex >= selectedRun.episodes.length - 1) stop();
    }, Number($('speed-range').value));
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    status.textContent = 'Paused';
  }

  function renderAll() {
    renderParameters();
    renderMetrics();
    renderEpisodeState();
    renderCharts();
    renderTable();
  }

  function renderParameters() {
    $('p-algorithm').textContent = selectedRun.algorithm;
    $('p-instance').textContent = selectedRun.instance;
    $('p-size').textContent = selectedRun.problemSize;
    $('p-seed').textContent = selectedRun.seed;
    $('p-learning-rate').textContent = selectedRun.learningRate;
    $('p-gamma').textContent = selectedRun.gamma;
    $('p-epsilon').textContent = selectedRun.epsilon;
    $('p-patience').textContent = selectedRun.patience;
  }

  function renderMetrics() {
    $('metric-distance').textContent = selectedRun.summary.bestDistance.toFixed(1);
    $('metric-energy').textContent = `${selectedRun.summary.totalEnergyJ.toFixed(2)} J`;
    $('metric-time').textContent = `${selectedRun.summary.totalTimeS.toFixed(2)} s`;
    $('metric-episode').textContent = selectedRun.summary.bestEpisode;
  }

  function renderEpisodeState() {
    const episode = selectedRun.episodes[currentIndex];
    $('episode-number').textContent = episode.episode;
    $('progress-bar').style.width = `${((currentIndex + 1) / selectedRun.episodes.length) * 100}%`;
    $('route-caption').textContent = `Episode ${episode.episode}: reward ${episode.reward}, distance ${episode.distance}, energy ${episode.energy.toFixed(2)} J.`;
    GreenRLCharts.routeChart('#route-chart', selectedRun, episode);
  }

  function renderCharts() {
    GreenRLCharts.lineChart('#distance-chart', selectedRun.episodes, 'distance', { currentEpisode: selectedRun.episodes[currentIndex].episode, format: d3.format('.0f') });
    GreenRLCharts.lineChart('#reward-chart', selectedRun.episodes, 'reward', { currentEpisode: selectedRun.episodes[currentIndex].episode, format: d3.format('.0f') });
    GreenRLCharts.lineChart('#energy-chart', selectedRun.episodes, 'energy', { currentEpisode: selectedRun.episodes[currentIndex].episode, format: d3.format('.2f') });
    GreenRLCharts.lineChart('#epsilon-chart', selectedRun.episodes, 'epsilon', { currentEpisode: selectedRun.episodes[currentIndex].episode, format: d3.format('.2f') });
  }

  function renderTable() {
    const tbody = $('episode-table');
    tbody.innerHTML = '';
    selectedRun.episodes.forEach((row, i) => {
      const tr = document.createElement('tr');
      if (i === currentIndex) tr.className = 'active';
      tr.innerHTML = `
        <td>${row.episode}</td>
        <td>${row.reward.toFixed(0)}</td>
        <td>${row.distance.toFixed(1)}</td>
        <td>${row.energy.toFixed(2)}</td>
        <td>${row.time.toFixed(2)}</td>
        <td>${row.epsilon.toFixed(3)}</td>
        <td>${row.converged ? 'Yes' : 'No'}</td>`;
      tbody.appendChild(tr);
    });
  }

  function exportCSV() {
    const columns = ['episode','reward','distance','energy','time','epsilon','converged'];
    const lines = [columns.join(',')];
    selectedRun.episodes.forEach(row => {
      lines.push(columns.map(column => row[column]).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedRun.runId}-episodes.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  renderAll();
  status.textContent = 'Ready';
})();

window.GreenRLCharts = (() => {
  const palette = {
    accent: '#208b5a',
    best: '#d96b42',
    text: '#183126',
    muted: '#819088',
    grid: '#edf2ee'
  };

  function clear(selector) {
    d3.select(selector).selectAll('*').remove();
  }

  function lineChart(selector, data, key, options = {}) {
    clear(selector);
    const container = document.querySelector(selector);
    const width = Math.max(container.clientWidth || 500, 300);
    const height = 235;
    const margin = { top: 12, right: 16, bottom: 28, left: 42 };

    const svg = d3.select(selector).append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'none');

    const x = d3.scaleLinear()
      .domain(d3.extent(data, d => d.episode)).nice()
      .range([margin.left, width - margin.right]);

    const yExtent = d3.extent(data, d => Number(d[key]));
    const pad = (yExtent[1] - yExtent[0]) * 0.08 || 1;
    const y = d3.scaleLinear()
      .domain([yExtent[0] - pad, yExtent[1] + pad])
      .nice()
      .range([height - margin.bottom, margin.top]);

    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('d')))
      .selectAll('.tick line').remove();

    svg.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(options.format || d3.format('~g')))
      .selectAll('.tick line').remove();

    svg.append('g')
      .selectAll('line')
      .data(y.ticks(5))
      .join('line')
      .attr('class', 'grid-line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d));

    const line = d3.line()
      .x(d => x(d.episode))
      .y(d => y(Number(d[key])));

    svg.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', options.color || palette.accent)
      .attr('stroke-width', 2.5)
      .attr('d', line);

    if (options.currentEpisode) {
      svg.append('line')
        .attr('x1', x(options.currentEpisode))
        .attr('x2', x(options.currentEpisode))
        .attr('y1', margin.top)
        .attr('y2', height - margin.bottom)
        .attr('stroke', palette.best)
        .attr('stroke-dasharray', '4,4');
    }
  }

  function routeChart(selector, run, episode) {
    clear(selector);
    const container = document.querySelector(selector);
    const width = Math.max(container.clientWidth || 700, 300);
    const height = 360;
    const margin = 28;
    const svg = d3.select(selector).append('svg').attr('viewBox', `0 0 ${width} ${height}`);

    const maxX = d3.max(run.cities, d => d.x);
    const maxY = d3.max(run.cities, d => d.y);
    const sx = d3.scaleLinear().domain([0, maxX]).range([margin, width - margin]);
    const sy = d3.scaleLinear().domain([0, maxY]).range([margin, height - margin]);

    const best = run.bestRoute.map(id => run.cities.find(c => c.id === id));
    const current = episode.route.map(id => run.cities.find(c => c.id === id));

    const path = d3.line().x(d => sx(d.x)).y(d => sy(d.y));

    svg.append('path').datum(best)
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', palette.best)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,5')
      .attr('opacity', 0.65);

    svg.append('path').datum(current)
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', palette.accent)
      .attr('stroke-width', 3);

    svg.selectAll('.city')
      .data(run.cities)
      .join('circle')
      .attr('cx', d => sx(d.x))
      .attr('cy', d => sy(d.y))
      .attr('r', 8)
      .attr('fill', '#ffffff')
      .attr('stroke', palette.accent)
      .attr('stroke-width', 2);

    svg.selectAll('.label')
      .data(run.cities)
      .join('text')
      .attr('x', d => sx(d.x) + 11)
      .attr('y', d => sy(d.y) + 4)
      .text(d => d.id)
      .attr('font-size', 12)
      .attr('fill', palette.text);

    svg.append('text').attr('x', margin).attr('y', 18)
      .text(`Episode ${episode.episode} · distance ${episode.distance}`)
      .attr('font-size', 12).attr('fill', palette.muted);
  }

  return { lineChart, routeChart };
})();

# Green RL Playground

Interactive viewer for pre-computed tabular RL experiments on TSPLIB instances. Pick a configuration and the page replays its 10,000 episodes, showing per-episode **duration, CPU / RAM / total energy and CO₂ emissions** (time series and running totals) alongside **performance**: distance, path, and the best values found so far.

Nothing is trained or measured in the browser; the page only reads the dataset in `data/`.

## Running

Open `index.html` in a browser. No server or build step is needed (D3 is loaded from a CDN). It also works on GitHub Pages.

The URL keeps the selected run and episode (`#run=<id>&ep=<n>`), so a view can be shared by link.

## Report

**Export report** (sidebar) builds a report of the selected configuration from episode 1 to the current episode. The report uses the display choices currently set on the page: per-episode or cumulative charts, and the energy and emissions units.

In the dialog you choose which sections to include:

- energy & emissions summary: totals, mean, lowest and highest episode;
- energy, emissions and duration charts;
- performance summary: best distance, gap to optimum, and the time, energy and emissions spent until the best was found;
- distance chart;
- best path: map and node sequence;
- history of new best distances.

The configuration is always included. Output formats:

- **Print / save as PDF** opens the report in a new tab and calls the print dialog.
- **Download HTML** saves a self-contained file.

## Configuration space

| Parameter | Values |
|---|---|
| algorithm | `sarsa`, `q-learning`, `double-qlearning` |
| instance | every TSPLIB file in `data/instances/` (currently `eil51`, `berlin52`, `st70`, `kroA100`, `tsp225`, `br17`, `ftv33`, `ftv64`) |
| epsilon_decay | `linear`, `convex`, `concave`, `step`, `fixed` |
| reward | `R1`, `R2`, `R3` |
| gamma, alpha | `0.01`, `0.15`, `0.30`, `0.45`, `0.60`, `0.75`, `0.90`, `0.99` |
| epsilon_init | `0.01`, `0.05`, `0.10` |
| episodes | fixed at 10,000 |

Options with no run for the other selected values are marked ∅. Selecting a missing combination shows the closest runs that do exist.

## Instances

The TSPLIB files live in `data/instances/` (`*.tsp` with coordinates, `*.atsp` with a full matrix).

After adding or removing a file, run:

```bash
python tools/build_instances.py
```

This regenerates `data/instances.js`, which holds the coordinates, sizes and known optima the page needs.

ATSP instances have no coordinates, so their paths are drawn with nodes on a circle.

## Loading your results

`data/` currently holds **synthetic demo data**; a banner in the page says so. Replace it with your results, either one CSV with every run or a folder of CSVs:

```bash
python tools/build_dataset.py results.csv --fresh
```

There is one row per episode. Header names are case-insensitive, and common aliases are accepted (see `ALIASES` in `tools/build_dataset.py`).

| Column | Meaning |
|---|---|
| `algorithm`, `instance`, `epsilon_decay`, `reward`, `gamma`, `alpha`, `epsilon_init` | configuration; can be omitted and passed as flags instead (`--algorithm sarsa --instance eil51 ...`) for single-run files |
| `episode` | 1..10000 (0-based counters are shifted) |
| `duration` | seconds |
| `emissions` | kg CO₂eq |
| `cpu_energy`, `ram_energy`, `energy_consumed` | kWh (CodeCarbon units); `energy_consumed` is computed as CPU + RAM (+ GPU) if missing |
| `distance` | tour length |
| `path` | node sequence, e.g. `0 5 3 ...`, `[0, 5, 3]` or `0-5-3`; 1-based paths are detected and converted to 0-based |

`--fresh` deletes the existing runs, including the demo, first. Without it, new runs are merged into the manifest.

Output:

- `data/runs/<run-id>.js`: one file per configuration, loaded only when selected.
- `data/manifest.js`: the list of available runs.

Each run takes roughly 250–550 kB depending on instance size.

## Project layout

```
index.html              page
css/style.css           pastel theme (light and dark; chart colours validated for colour-blind readers)
js/config.js            parameter grid and run ids
js/data.js              on-demand run loading and derived series (totals, best-so-far)
js/charts.js            D3 time series and path map
js/report.js            report builder (print/PDF or HTML)
js/main.js              controls, playback, KPIs
data/instances/         TSPLIB instance files
data/instances.js       generated from data/instances (tools/build_instances.py)
data/manifest.js        available runs (generated)
data/runs/              one file per run (generated)
tools/build_dataset.py  CSV -> dataset converter
tools/make_demo_data.py synthetic demo data generator
```

## License

[![CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

© 2026 Samara Santos. Licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for the full text.

- **Use, share and adapt freely** for non-commercial purposes.
- **No commercial use.** You may not sell this work or anything derived from it, or use either to make a profit.
- **Same license for derivatives.** Anything built from this work must be released under CC BY-NC-SA 4.0.
- **Always credit the original**, for example:

  > Based on *Green RL Playground* by Samara Santos, https://github.com/sams-santos/RL-Green-Interface, licensed under CC BY-NC-SA 4.0.

The TSPLIB instance files in `data/instances/` are not covered by this license. They remain under the original TSPLIB95 terms.

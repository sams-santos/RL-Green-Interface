# Green RL Playground

Interactive viewer for pre-computed tabular RL experiments on TSPLIB instances. Pick a configuration and the page replays its 10,000 episodes. For each episode it shows **duration, CPU / RAM / total energy and CO₂ emissions** (time series and running totals) alongside **performance**: distance, path, and the best values found so far.

Nothing is trained or measured in the browser; the page only reads the dataset in `data/`.

## Running

Open `index.html` in a browser. No server or build step is needed (D3 is loaded from a CDN), and it also works on GitHub Pages.

The URL keeps the current view (tab, run, episode, country), so a view can be shared by link (e.g. `#tab=concepts`).

## Tabs

**Explore a run.** Pick one configuration and replay its episodes:

- **Configuration** holds the run's parameters, then the electricity grid (country) and the energy and emissions units.
- The **Energy & emissions** board shows the elapsed time, how the energy splits between CPU and RAM, and the calculation with the run's own numbers: CPU + RAM = E, E × C = CO₂eq. Each value covers the episodes shown so far, with the whole run's total below it.
- The **charts** show energy, emissions, duration and distance, the emissions map and the everyday equivalents.

**Compare two runs.** Pick run A and run B (any two configurations or seeds):

- **Configuration for both runs** holds the electricity grid, the units and the number of episodes to compare.
- A summary table shows the difference of B relative to A; ✓ marks the lower (better) value.
- Line charts overlay best distance, distance per episode, cumulative energy and cumulative emissions.

**Concepts & references.** A short, illustrated text on the ideas behind the platform:

- why the energy of learning is measured (Green AI);
- reinforcement learning, with Q-learning, SARSA and Double Q-learning;
- the settings α, γ, ε, epsilon decay, reward and seed;
- the TSP as an RL problem, TSPLIB and the gap to optimum;
- how energy is measured (RAPL, RAM estimate, tracking mode);
- CO₂eq and carbon intensity;
- the everyday comparisons and how to read the charts.

Each claim cites a numbered reference: the author's publications, the original papers and the data sources. Citation links scroll to the reference without changing the URL.

There is one set of grid and unit controls, shared by the Explore and Compare tabs. Icons mark every metric, and the same quantity always has the same icon (for example, a lightning bolt for energy and a cloud for emissions).

## Report

**Export report** (Explore tab) builds a report of the selected run, from its first episode to the current one. It uses the choices currently set on the page: per-episode or cumulative charts, units and country. The configuration and the measurement method are always included. You choose the other sections:

- energy & emissions summary;
- energy, emissions and duration charts;
- emissions by country (map and table);
- everyday equivalents and the daily projection, with sources;
- performance summary;
- distance chart;
- best path (only when the data records paths);
- history of new best distances.

**Print / save as PDF** opens the report and the print dialog. **Download HTML** saves a self-contained file.

## Emissions by country

```
CO₂eq = E × C
```

- **E** is the energy consumed, in kWh.
- **C** is the carbon intensity of the electricity, in g CO₂eq/kWh.

The **Electricity grid** control (in Configuration) offers:

- **As measured in the experiment.** This uses the emissions recorded in the data.
- **Any of 212 countries.** This recomputes the emissions from the measured energy, using the country's C.

`data/global_energy_mix.json` holds, for each country (keyed by ISO 3166 alpha-3), its name, its alpha-2 code (for the flag), its carbon intensity and the year of the data. Countries without a carbon intensity are not included.

### Emissions map

Each country is coloured by the emissions this run would have produced on its grid.

- **Colours.** There is one step per 100 g CO₂eq/kWh, from mint (cleanest) to plum (most carbon-intensive). Each step is darker than the one before, so the scale can be read without colour vision.
- **Small countries.** Countries too small for the map are drawn as dots. Countries with no data are hatched.
- **Interaction.** Hover over a country to see its values. Click it to use its grid.
- **Summary.** Cards below the map show the cleanest grid, the selected one and the most carbon-intensive one. A sentence says how many times more the same run emits on the dirtiest grid than on the cleanest.

## Everyday equivalents

The **In everyday terms** section covers the episodes shown so far. Emissions comparisons follow the selected country.

- **What this compares to** places the energy and emissions next to familiar activities, each with an icon.
- **If you ran this every day** repeats the same amount daily for a month (30 days) and a year (365 days).

Each comparison is one division: amount ÷ factor. `data/equivalents.json` keeps, for each factor, the value exactly as published, the normalised factor, its source and its icon:

| Comparison | Published value | Source |
|---|---|---|
| Full smartphone charge | 0.019 kWh per charge | [US EPA, GHG Equivalencies Calculator](https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references) |
| AI text prompt (median Gemini) | 0.24 Wh per prompt | [Elsworth et al. 2025, arXiv:2508.15734](https://arxiv.org/abs/2508.15734) |
| Electric car | 0.17 kWh/km | [EcoLogits Calculator](https://github.com/genai-impact/ecologits-calculator/blob/942e218903142041f5cfd6f078da7b4c0bb677af/src/config/constants.py) (Selectra, Tesla) |
| Walking, 70 kg person | 196 kJ/km | EcoLogits Calculator (runningtools.com) |
| Average US home's electricity | 12,194 kWh per year (2022, EIA) | US EPA |
| Petrol car | 142 g CO₂eq/km | EcoLogits Calculator (ADEME Impact CO₂) |
| Video streaming | 15.6 h per kg CO₂eq | EcoLogits Calculator (ADEME Impact CO₂) |
| Urban tree absorbing CO₂ | 0.060 t CO₂ per tree per year | US EPA |

Sources were retrieved on 2026-10-09.

## Configuration space

| Parameter | Values |
|---|---|
| algorithm | `sarsa`, `q-learning`, `double-qlearning` |
| instance | every TSPLIB file in `data/instances/` (`eil51`, `berlin52`, `st70`, `kroA100`, `tsp225`, `br17`, `ftv33`, `ftv64`) |
| epsilon_decay | `linear`, `convex`, `concave`, `step`, `fixed`, or `unknown` when the data does not record it |
| reward | `R1`, `R2`, `R3` |
| gamma, alpha | `0.01`, `0.15`, `0.30`, `0.45`, `0.60`, `0.75`, `0.90`, `0.99` |
| epsilon_init | `0.01`, `0.05`, `0.10` |
| seed | the repetitions found in the data |
| episodes | 10,000 per run, numbered as in the source files |

Options with no run for the other selected values are marked ∅. Selecting a missing combination lists the closest runs that do exist.

## Dataset

`data/runs/` holds 60 runs: Q-learning on berlin52, rewards R1–R3, γ = 0.15, α = 0.75, ε₀ = 0.01, seeds 42–61. CPU energy was read from RAPL counters, and the tracker measured the whole machine.

To load new results, point the converter at the folder with the CSV files:

```bash
python tools/build_dataset.py <results folder> --fresh
```

**Episode files** have one row per episode:

| Column | Meaning |
|---|---|
| `run_index`, `algorithm`, `instance`, `r_type` | identify the run (`q` → Q-learning, `berlin52.tsp` → berlin52) |
| `episode` | episode number, kept as is (0- or 1-based) |
| `distance` | tour length |
| `Duration_sec` | seconds |
| `Emissions_kgCO2` | kg CO₂eq, as measured |
| `CPU_Energy_kWh`, `RAM_Energy_kWh`, `Total_Energy_kWh` | kWh |
| `epsilon_decay` *(optional)* | decay schedule |
| `path` *(optional)* | node sequence; the path map and report section appear only when paths are present |

**Summary files** are CSV files without an `episode` column, one row per run. Rows are matched to the episode rows on (`run_index`, `algorithm`, `instance`, `r_type`) and provide:

- `seed`, `alpha`, `gamma` and `epsilon` (the initial epsilon);
- `carbon_intensity_kgCO2_per_kWh`;
- `cpu_measurement` and `tracking_mode`.

Values found in neither kind of file can be given as options, e.g. `--epsilon-decay linear`. `--fresh` deletes the existing runs first; without it, new runs are added to the existing ones.

The converter writes:

- one `data/runs/<run-id>.js` per configuration and seed (about 270 kB each, loaded only when selected);
- `data/manifest.js`, the list of runs.

## Reference data

| Command | Reads | Writes |
|---|---|---|
| `python tools/build_reference.py` | `data/instances/`, `data/global_energy_mix.json`, `data/equivalents.json` | `data/reference.js` |
| `python tools/build_world.py` | Natural Earth admin-0 countries v5.1.2 (downloaded) | `data/world.js` |

Run them again after changing their inputs. ATSP instances have no coordinates, so their paths are drawn with nodes on a circle. An equivalent's `icon` and `badge` must be names from `js/icons.js`.

## Project layout

```
index.html                   page (Explore and Compare tabs)
css/style.css                flat, light pastel theme (chart colours checked for colour-blind readers)
js/config.js                 parameter grid and run ids
js/data.js                   on-demand run loading and derived series
js/charts.js                 D3 charts: time series, world map, path map (all 2D)
js/icons.js                  Lucide line icons used by the page
js/equivalents.js            everyday comparisons
js/report.js                 report builder
js/compare.js                Compare tab
js/main.js                   page controller and Explore tab
data/instances/              TSPLIB instance files
data/global_energy_mix.json  carbon intensity per country
data/equivalents.json        everyday comparison factors and sources
data/reference.js            generated: instances, countries, equivalents
data/world.js                generated: country shapes
data/manifest.js             generated: list of runs
data/runs/                   generated: one file per run
tools/build_dataset.py       CSV files -> data/runs, data/manifest.js
tools/build_reference.py     -> data/reference.js
tools/build_world.py         -> data/world.js
```

## License

[![CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

© 2026 Samara Santos. Licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for the full text.

- **Use, share and adapt freely** for non-commercial purposes.
- **No commercial use.** You may not sell this work or anything derived from it, or use either to make a profit.
- **Same license for derivatives.** Anything built from this work must be released under CC BY-NC-SA 4.0.
- **Always credit the original**, for example:

  > Based on *Green RL Playground* by Samara Santos, https://github.com/sams-santos/RL-Green-Interface, licensed under CC BY-NC-SA 4.0.

Third-party material keeps its own terms (see [LICENSE](LICENSE)): the TSPLIB instance files, the CodeCarbon energy-mix data, D3.js, flag-icons, the Lucide icons (ISC) and the Natural Earth map data (public domain).

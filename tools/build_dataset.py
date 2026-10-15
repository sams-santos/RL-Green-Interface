"""Convert experiment CSV files into the dataset read by the page: data/runs/<run-id>.js and
data/manifest.js.

The input folder holds two kinds of CSV (header names are case-insensitive):

* episode files, one row per episode:
      run_index, algorithm, instance, r_type, episode, distance, Duration_sec, Emissions_kgCO2,
      CPU_Energy_kWh, RAM_Energy_kWh, Total_Energy_kWh [, epsilon_decay] [, path]
* summary files (no `episode` column), one row per run:
      run_index, algorithm, instance, r_type, seed, alpha, gamma, epsilon,
      carbon_intensity_kgCO2_per_kWh, cpu_measurement, tracking_mode [, epsilon_decay]

Each episode row takes the settings of the summary row with the same (run_index, algorithm,
instance, r_type). Settings found in neither file can be given as options, e.g.
--epsilon-decay linear; a missing epsilon decay is stored as "unknown".
Units follow CodeCarbon: seconds, kWh and kg CO2eq. Episode numbers are kept as in the files.

Usage:
    python tools/build_dataset.py <results folder> [--fresh] [--epsilon-decay linear]
"""
import argparse
import csv
import json
import math
import re
import statistics
import sys
from pathlib import Path

from build_reference import instances

DATA = Path(__file__).resolve().parent.parent / "data"
EPISODES = 10000

# Must match PARAMS in js/config.js.
ALGORITHMS = {"q": "q-learning", "qlearning": "q-learning", "sarsa": "sarsa",
              "dq": "double-qlearning", "dql": "double-qlearning", "doubleqlearning": "double-qlearning"}
EPSILON_DECAYS = ["linear", "convex", "concave", "step", "fixed", "unknown"]
REWARDS = ["R1", "R2", "R3"]
GRID = [0.01, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.99]
EPSILON_INITS = [0.01, 0.05, 0.10]
DIMENSIONS = {name: info["dimension"] for name, info in instances().items()}

CONFIG_KEYS = ["algorithm", "instance", "epsilon_decay", "reward", "gamma", "alpha", "epsilon_init", "seed"]
METRIC_KEYS = ["duration", "emissions", "cpu_energy", "ram_energy", "energy_consumed", "distance"]

# Canonical key -> accepted (lower-case) column names.
KEY_COLUMNS = {"run_index": ["run_index"], "algorithm": ["algorithm"], "instance": ["instance"],
               "reward": ["r_type", "reward"], "epsilon_decay": ["epsilon_decay"]}
EPISODE_COLUMNS = {**KEY_COLUMNS, "episode": ["episode"], "distance": ["distance"],
                   "duration": ["duration_sec"], "emissions": ["emissions_kgco2"],
                   "cpu_energy": ["cpu_energy_kwh"], "ram_energy": ["ram_energy_kwh"],
                   "energy_consumed": ["total_energy_kwh"], "path": ["path"]}
SUMMARY_COLUMNS = {**KEY_COLUMNS, "seed": ["seed"], "alpha": ["alpha"], "gamma": ["gamma"],
                   "epsilon_init": ["epsilon_init", "epsilon"],
                   "carbon_intensity": ["carbon_intensity_kgco2_per_kwh"],
                   "cpu_measurement": ["cpu_measurement"], "tracking_mode": ["tracking_mode"]}


def find_columns(fieldnames, wanted):
    """Canonical key -> actual column name, for the keys present in the file."""
    by_lower = {name.strip().lower(): name for name in fieldnames or []}
    return {key: by_lower[alias] for key, aliases in wanted.items() for alias in aliases if alias in by_lower}


def snap(value, choices, label):
    """The grid value equal to `value` (numbers) or matching it case-insensitively (text)."""
    for choice in choices:
        if isinstance(choice, float) and abs(float(value) - choice) < 1e-6:
            return choice
        if isinstance(choice, str) and str(value).strip().lower() == choice.lower():
            return choice
    raise ValueError(f"{label} {value!r} is not one of {choices}")


def canon_config(raw):
    algorithm = re.sub(r"[^a-z]", "", str(raw["algorithm"]).lower())
    if algorithm not in ALGORITHMS:
        raise ValueError(f"unknown algorithm {raw['algorithm']!r}")
    reward = str(raw["reward"]).strip().upper()
    return {
        "algorithm": ALGORITHMS[algorithm],
        "instance": snap(re.sub(r"\.a?tsp$", "", str(raw["instance"]).strip(), flags=re.I), list(DIMENSIONS), "instance"),
        "epsilon_decay": snap(raw["epsilon_decay"], EPSILON_DECAYS, "epsilon_decay"),
        "reward": snap(reward if reward.startswith("R") else "R" + reward, REWARDS, "reward"),
        "gamma": snap(raw["gamma"], GRID, "gamma"),
        "alpha": snap(raw["alpha"], GRID, "alpha"),
        "epsilon_init": snap(raw["epsilon_init"], EPSILON_INITS, "epsilon_init"),
        "seed": int(float(raw["seed"])),
    }


def run_id(config):
    """Must match runId() in js/config.js."""
    return (f"{config['algorithm']}_{config['instance']}_{config['epsilon_decay']}_{config['reward']}"
            f"_g{config['gamma']:.2f}_a{config['alpha']:.2f}_e{config['epsilon_init']:.2f}_s{config['seed']}")


def number(text):
    text = str(text).strip() if text is not None else ""
    return None if text.lower() in ("", "nan", "none", "null") else float(text)


def encode_column(values, digits=4):
    """Integers times a power-of-ten scale (`digits` significant digits of the largest value).
    Columns with long runs of equal values are run-length encoded as [value, count, ...]."""
    present = [abs(v) for v in values if v is not None]
    exponent = 0
    if present and max(present) > 0 and not all(float(v).is_integer() for v in present):
        exponent = math.floor(math.log10(max(present))) - (digits - 1)
    data = [None if v is None else int(round(v / 10.0 ** exponent)) for v in values]
    rle = []
    for value in data:
        if rle and rle[-2] == value:
            rle[-1] += 1
        else:
            rle += [value, 1]
    column = {"scale": 1 if exponent == 0 else float(f"1e{exponent}")}
    column.update({"rle": rle} if len(rle) < len(data) * 0.6 else {"data": data})
    return column


def write_run(config, summary, by_episode):
    """Write data/runs/<run-id>.js for one run; by_episode maps episode number -> record."""
    rid = run_id(config)
    first = min(by_episode)
    numbers = range(first, first + min(EPISODES, max(by_episode) - first + 1))
    missing = sum(1 for n in numbers if n not in by_episode)
    if missing:
        print(f"  ! {rid}: {missing} missing episodes, stored as empty")
    episodes = [by_episode.get(n, {}) for n in numbers]

    paths = [ep.get("path") for ep in episodes]
    if any(paths) and min(min(p) for p in paths if p) >= 1 and \
            max(max(p) for p in paths if p) == DIMENSIONS[config["instance"]]:
        paths = [[n - 1 for n in p] if p else p for p in paths]  # 1-based -> 0-based
    unique = list(dict.fromkeys(" ".join(map(str, p)) for p in paths if p))
    index = {key: k for k, key in enumerate(unique)}

    intensity = summary.get("carbon_intensity")
    if intensity is None:  # not recorded: recover it from emissions / energy
        ratios = [ep["emissions"] / ep["energy_consumed"] for ep in episodes
                  if ep.get("emissions") is not None and ep.get("energy_consumed")]
        intensity = statistics.median(ratios) * 1000 if ratios else None

    payload = {
        "id": rid,
        "config": config,
        "episodes": len(episodes),
        "firstEpisode": first,
        "carbonIntensity": round(intensity, 3) if intensity else None,
        "measurement": {k: summary[k] for k in ("cpu_measurement", "tracking_mode") if summary.get(k)},
        "columns": {key: encode_column([ep.get(key) for ep in episodes]) for key in METRIC_KEYS},
        "pathIndex": encode_column([index[" ".join(map(str, p))] if p else None for p in paths]),
        "paths": unique,
    }
    target = DATA / "runs" / f"{rid}.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("GreenRL.registerRun(" + json.dumps(payload, separators=(",", ":")) + ");\n", encoding="utf-8")
    print(f"  {rid}: episodes {first}-{numbers[-1]}")
    return rid


def read_rows(file):
    with open(file, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return reader.fieldnames or [], list(reader)


def run_key(row, columns):
    """(run_index, algorithm, instance, reward): identifies one run across episode and summary files."""
    return tuple(cell(row, columns, k).lower() for k in ("run_index", "algorithm", "instance", "reward"))


def cell(row, columns, key):
    """The row's value for a canonical key, or "" when the file has no such column."""
    return (row.get(columns[key]) or "").strip() if key in columns else ""


def read_summaries(files):
    table = {}
    for file in files:
        fieldnames, rows = read_rows(file)
        columns = find_columns(fieldnames, SUMMARY_COLUMNS)
        for row in rows:
            info = {k: row[c].strip() for k, c in columns.items() if row.get(c, "").strip()}
            if "carbon_intensity" in info:
                info["carbon_intensity"] = float(info["carbon_intensity"]) * 1000  # kg -> g per kWh
            table.setdefault(run_key(row, columns), {}).update(info)
    return table


def read_episodes(file, summaries, options):
    """{run_id: (config, summary, {episode: record})} for one episode file."""
    fieldnames, rows = read_rows(file)
    columns = find_columns(fieldnames, EPISODE_COLUMNS)
    runs = {}
    for line, row in enumerate(rows, start=2):
        summary = summaries.get(run_key(row, columns), {})
        raw = {}
        for key in CONFIG_KEYS:
            value = cell(row, columns, key) or summary.get(key) or options.get(key)
            raw[key] = value or ("unknown" if key == "epsilon_decay" else None)
        try:
            if None in raw.values():
                missing = [k for k, v in raw.items() if v is None]
                raise ValueError(f"no value for {', '.join(missing)}: add a summary file or an option")
            config = canon_config(raw)
        except ValueError as err:
            sys.exit(f"{file}:{line}: {err}")
        record = {key: number(cell(row, columns, key)) for key in METRIC_KEYS}
        if "path" in columns:
            record["path"] = [int(n) for n in re.findall(r"\d+", row[columns["path"]])] or None
        runs.setdefault(run_id(config), (config, summary, {}))[2][int(float(row[columns["episode"]]))] = record
    return runs


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", help="folder with the episode and summary CSV files")
    parser.add_argument("--fresh", action="store_true", help="delete the existing runs first")
    for key in CONFIG_KEYS:
        parser.add_argument("--" + key.replace("_", "-"), dest=key, help=f"{key} for runs that do not record it")
    args = parser.parse_args()

    files = sorted(Path(args.folder).rglob("*.csv"))
    episode_files = [f for f in files if "episode" in find_columns(read_rows(f)[0], EPISODE_COLUMNS)]
    summaries = read_summaries([f for f in files if f not in episode_files])
    if not episode_files:
        sys.exit(f"No episode CSV files in {args.folder}.")
    print(f"{len(episode_files)} episode file(s), {len(summaries)} run(s) described in summary files")

    if args.fresh:
        for old in (DATA / "runs").glob("*.js"):
            old.unlink()
    options = {k: getattr(args, k) for k in CONFIG_KEYS}
    written = set()
    for file in episode_files:  # one file at a time keeps memory bounded; a run must not span files
        print(file.name)
        for rid, (config, summary, by_episode) in sorted(read_episodes(file, summaries, options).items()):
            if rid in written:
                sys.exit(f"{rid} appears in more than one episode file; merge them first.")
            written.add(write_run(config, summary, by_episode))

    runs = sorted(p.stem for p in (DATA / "runs").glob("*.js"))
    (DATA / "manifest.js").write_text(
        "// Generated by tools/build_dataset.py. Do not edit by hand.\n"
        "window.GREEN_RL_MANIFEST = " + json.dumps({"runs": runs}, indent=1) + ";\n", encoding="utf-8")
    print(f"Wrote {len(written)} run(s); data/manifest.js lists {len(runs)}.")


if __name__ == "__main__":
    main()

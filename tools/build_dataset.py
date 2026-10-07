"""Convert raw experiment CSV files into the dataset read by the Green RL Playground.

Each CSV row is one episode. Expected columns (case-insensitive; common aliases accepted,
see ALIASES below):

    algorithm, instance, epsilon_decay, reward, gamma, alpha, epsilon_init,   <- configuration
    episode, duration, emissions, cpu_energy, ram_energy, energy_consumed,      <- per episode
    distance, path

Configuration columns may be omitted when a file holds a single run; pass them on the
command line instead (e.g. --algorithm sarsa --instance eil51 ...).
Units follow CodeCarbon: duration in seconds, energies in kWh, emissions in kg CO2eq.
`path` is any sequence of node indices ("0 5 3 ...", "[0, 5, 3]", "0-5-3", "0->5->3").

Usage:
    python tools/build_dataset.py results/            # every *.csv under results/
    python tools/build_dataset.py run.csv --algorithm sarsa --instance eil51 \
        --epsilon-decay linear --reward R1 --gamma 0.9 --alpha 0.15 --epsilon-init 0.1
    python tools/build_dataset.py results/ --fresh    # drop existing runs (e.g. the demo) first

Output: data/runs/<run-id>.js (one per configuration) and data/manifest.js.
"""
import argparse
import csv
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from tsplib_utils import instance_files, read_instance

ALGORITHMS = ["sarsa", "q-learning", "double-qlearning"]
EPSILON_DECAYS = ["linear", "convex", "concave", "step", "fixed"]
REWARDS = ["R1", "R2", "R3"]
GAMMAS = [0.01, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.99]
ALPHAS = [0.01, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.99]
EPSILON_INITS = [0.01, 0.05, 0.10]
EPISODES = 10000
# Instances are whatever TSPLIB files sit in data/instances.
DIMENSIONS = {name: read_instance(name)["dimension"] for name in instance_files()}
INSTANCES = list(DIMENSIONS)

CONFIG_KEYS = ["algorithm", "instance", "epsilon_decay", "reward", "gamma", "alpha", "epsilon_init"]
METRIC_KEYS = ["duration", "emissions", "cpu_energy", "ram_energy", "energy_consumed", "distance"]

ALIASES = {
    "algorithm": ["algorithm", "algo", "agent", "method"],
    "instance": ["instance", "problem", "instance_name", "tsp_instance"],
    "epsilon_decay": ["epsilon_decay", "epsilon_decay_type", "decay", "decay_type", "eps_decay"],
    "reward": ["reward_type", "reward_function", "reward_fn", "reward"],
    "gamma": ["gamma", "discount", "discount_factor"],
    "alpha": ["alpha", "learning_rate", "lr"],
    "epsilon_init": ["epsilon_init", "epsilon_initial", "initial_epsilon", "eps_init", "epsilon_start"],
    "episode": ["episode", "ep", "episode_id"],
    "duration": ["duration", "duration_s", "time", "time_s", "episode_duration"],
    "emissions": ["emissions", "emissions_kg", "emissions_kgco2", "emissionskgco2", "emissions_kg_co2",
                  "co2_kg", "emissions_kgco2eq"],
    "cpu_energy": ["cpu_energy", "cpu_energy_kwh"],
    "ram_energy": ["ram_energy", "ram_energy_kwh"],
    "gpu_energy": ["gpu_energy", "gpu_energy_kwh"],
    "energy_consumed": ["energy_consumed", "total_energy", "energy", "energy_kwh", "total_energy_kwh"],
    "distance": ["distance", "tour_length", "tour_distance", "total_distance", "length", "cost"],
    "path": ["path", "route", "tour", "caminho"],
}


def normalise_header(name):
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def match_columns(fieldnames):
    """Map canonical key -> actual CSV column name."""
    normalised = {normalise_header(f): f for f in fieldnames}
    found = {}
    for key, aliases in ALIASES.items():
        for alias in aliases:
            if alias in normalised:
                found[key] = normalised[alias]
                break
    return found


def canon_algorithm(value):
    key = re.sub(r"[^a-z]", "", str(value).lower())
    table = {"sarsa": "sarsa", "qlearning": "q-learning", "ql": "q-learning", "q": "q-learning",
             "doubleqlearning": "double-qlearning", "doubleq": "double-qlearning", "dql": "double-qlearning",
             "dqlearning": "double-qlearning"}
    if key not in table:
        raise ValueError(f"unknown algorithm {value!r} (expected one of {ALGORITHMS})")
    return table[key]


def canon_choice(value, choices, label):
    for choice in choices:
        if str(value).strip().lower() == choice.lower():
            return choice
    raise ValueError(f"unknown {label} {value!r} (expected one of {choices})")


def canon_reward(value):
    text = str(value).strip().upper()
    if re.fullmatch(r"\d", text):
        text = "R" + text
    return canon_choice(text, REWARDS, "reward")


def canon_number(value, grid, label):
    number = float(value)
    for g in grid:
        if abs(number - g) < 1e-6:
            return g
    raise ValueError(f"{label}={value} is not in the grid {grid}")


def canon_config(raw):
    return {
        "algorithm": canon_algorithm(raw["algorithm"]),
        "instance": canon_choice(raw["instance"], INSTANCES, "instance"),
        "epsilon_decay": canon_choice(raw["epsilon_decay"], EPSILON_DECAYS, "epsilon_decay"),
        "reward": canon_reward(raw["reward"]),
        "gamma": canon_number(raw["gamma"], GAMMAS, "gamma"),
        "alpha": canon_number(raw["alpha"], ALPHAS, "alpha"),
        "epsilon_init": canon_number(raw["epsilon_init"], EPSILON_INITS, "epsilon_init"),
    }


def run_id(config):
    """Must match runId() in js/config.js."""
    return (f"{config['algorithm']}_{config['instance']}_{config['epsilon_decay']}_{config['reward']}"
            f"_g{config['gamma']:.2f}_a{config['alpha']:.2f}_e{config['epsilon_init']:.2f}")


def parse_float(text):
    if text is None or str(text).strip() in ("", "nan", "NaN", "None", "null"):
        return None
    return float(text)


def parse_path(text):
    if text is None:
        return None
    nodes = [int(n) for n in re.findall(r"\d+", str(text))]
    return nodes or None


def run_length(data):
    pairs = []
    for value in data:
        if pairs and pairs[-2] == value:
            pairs[-1] += 1
        else:
            pairs += [value, 1]
    return pairs


def encode_column(values, digits=4):
    """Store a column as integers times a power-of-ten scale (`digits` significant digits
    relative to the largest value); integer columns keep full precision. Columns that stay
    constant over stretches of episodes are run-length encoded as [value, count, ...]."""
    present = [abs(v) for v in values if v is not None]
    if not present or all(float(v).is_integer() for v in present):
        exponent = 0
    else:
        exponent = math.floor(math.log10(max(present))) - (digits - 1) if max(present) > 0 else 0
    scale = 10.0 ** exponent
    data = [None if v is None else int(round(v / scale)) for v in values]
    column = {"scale": 1 if exponent == 0 else float(f"1e{exponent}")}
    rle = run_length(data)
    if len(rle) < len(data) * 0.6:
        column["rle"] = rle
    else:
        column["data"] = data
    return column


def write_run(out_dir, config, episodes, demo=False):
    """Write one run file.

    episodes: list (ordered by episode number, starting at 1) of dicts with the METRIC_KEYS
    plus `path` (list of 0-based node indices or None).
    """
    unique_paths, path_index, path_ids = [], {}, []
    for ep in episodes:
        path = ep.get("path")
        if path is None:
            path_ids.append(None)
            continue
        key = " ".join(map(str, path))
        if key not in path_index:
            path_index[key] = len(unique_paths)
            unique_paths.append(key)
        path_ids.append(path_index[key])

    payload = {
        "id": run_id(config),
        "config": config,
        "demo": demo,
        "units": {"duration": "s", "energy": "kWh", "emissions": "kg CO2eq"},
        "episodes": len(episodes),
        "columns": {key: encode_column([ep.get(key) for ep in episodes]) for key in METRIC_KEYS},
        "pathIndex": encode_column(path_ids),
        "paths": unique_paths,
    }
    runs_dir = Path(out_dir) / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    target = runs_dir / f"{payload['id']}.js"
    target.write_text("GreenRL.registerRun(" + json.dumps(payload, separators=(",", ":")) + ");\n",
                      encoding="utf-8")
    return payload["id"], target


def read_manifest(out_dir):
    path = Path(out_dir) / "manifest.js"
    if not path.exists():
        return []
    match = re.search(r"=\s*(\{.*\})\s*;", path.read_text(encoding="utf-8"), re.S)
    return json.loads(match.group(1)).get("runs", []) if match else []


def write_manifest(out_dir, run_ids):
    path = Path(out_dir) / "manifest.js"
    body = {
        "episodes": EPISODES,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "runs": sorted(set(run_ids)),
    }
    text = json.dumps(body, indent=1).replace('\n  "', ' "')
    path.write_text("// Generated by tools/build_dataset.py. Lists every run available in data/runs/.\n"
                    "window.GREEN_RL_MANIFEST = " + text + ";\n", encoding="utf-8")
    return path


def collect_csv_files(inputs):
    files = []
    for item in inputs:
        p = Path(item)
        if p.is_dir():
            files.extend(sorted(p.rglob("*.csv")))
        elif any(ch in item for ch in "*?["):
            files.extend(sorted(Path().glob(item)))
        else:
            files.append(p)
    return files


def read_groups(files, defaults):
    """Return {run_id: (config, {episode: row})}."""
    groups = {}
    for file in files:
        with open(file, newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            columns = match_columns(reader.fieldnames or [])
            missing = [k for k in CONFIG_KEYS if k not in columns and defaults.get(k) is None]
            if missing:
                sys.exit(f"{file}: missing configuration {missing}; add columns or pass --{missing[0].replace('_', '-')}")
            if "episode" not in columns:
                sys.exit(f"{file}: no 'episode' column")
            for line_no, row in enumerate(reader, start=2):
                raw = {k: row[columns[k]] if k in columns else defaults[k] for k in CONFIG_KEYS}
                try:
                    config = canon_config(raw)
                except ValueError as err:
                    sys.exit(f"{file}:{line_no}: {err}")
                rid = run_id(config)
                record = {k: parse_float(row.get(columns[k])) if k in columns else None
                          for k in METRIC_KEYS + ["gpu_energy"]}
                record["path"] = parse_path(row.get(columns["path"])) if "path" in columns else None
                episode = int(float(row[columns["episode"]]))
                groups.setdefault(rid, (config, {}))[1][episode] = record
    return groups


def normalise_paths(episodes, dimension, path_base):
    paths = [ep["path"] for ep in episodes if ep["path"]]
    if not paths:
        return
    if path_base == "auto":
        lo = min(min(p) for p in paths)
        hi = max(max(p) for p in paths)
        path_base = 1 if lo >= 1 and hi == dimension else 0
    for ep in episodes:
        if ep["path"]:
            ep["path"] = [n - int(path_base) for n in ep["path"]]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", help="CSV files, directories or glob patterns")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data"),
                        help="output data directory (default: ./data)")
    parser.add_argument("--fresh", action="store_true",
                        help="delete every existing run (including the demo data) before writing")
    parser.add_argument("--path-base", choices=["auto", "0", "1"], default="auto",
                        help="whether node indices in `path` start at 0 or 1 (default: auto-detect)")
    for key in CONFIG_KEYS:
        parser.add_argument("--" + key.replace("_", "-"), dest=key, help=f"{key} for files without that column")
    args = parser.parse_args()

    files = collect_csv_files(args.inputs)
    if not files:
        sys.exit("No CSV files found.")
    groups = read_groups(files, {k: getattr(args, k) for k in CONFIG_KEYS})
    if args.fresh:
        for old in (Path(args.out) / "runs").glob("*.js"):
            old.unlink()

    written = []
    for rid, (config, by_episode) in sorted(groups.items()):
        numbers = sorted(by_episode)
        if numbers[0] == 0:  # 0-based episode counters
            by_episode = {n + 1: v for n, v in by_episode.items()}
            numbers = sorted(by_episode)
        if numbers[-1] > EPISODES:
            print(f"  ! {rid}: {numbers[-1]} episodes, keeping the first {EPISODES}")
        last = min(numbers[-1], EPISODES)
        gaps = [n for n in range(1, last + 1) if n not in by_episode]
        if gaps:
            print(f"  ! {rid}: {len(gaps)} missing episodes (first: {gaps[0]}), stored as empty")
        empty = {k: None for k in METRIC_KEYS + ["gpu_energy", "path"]}
        episodes = [by_episode.get(n, dict(empty)) for n in range(1, last + 1)]
        for ep in episodes:
            if ep["energy_consumed"] is None and ep["cpu_energy"] is not None and ep["ram_energy"] is not None:
                ep["energy_consumed"] = ep["cpu_energy"] + ep["ram_energy"] + (ep["gpu_energy"] or 0)
        normalise_paths(episodes, DIMENSIONS[config["instance"]], args.path_base)
        run, target = write_run(args.out, config, episodes)
        written.append(run)
        print(f"  {run}: {last} episodes -> {target.name}")

    existing = [] if args.fresh else read_manifest(args.out)
    manifest = write_manifest(args.out, existing + written)
    print(f"Wrote {len(written)} run(s); manifest lists {len(set(existing + written))} run(s): {manifest}")


if __name__ == "__main__":
    main()

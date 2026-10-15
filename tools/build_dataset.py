"""Convert the experiment results into the dataset read by the page.

Input: a folder with the release files (see tools/fetch_release.py), one pair per algorithm and
instance:
* <name>_<instance>_master_episodes.csv(.gz) - one row per episode:
      run_index, algorithm, instance, r_type, e_type, epsilon_init, gamma, alpha, episode, epsilon,
      distance, Duration_sec, Emissions_kgCO2, CPU_Energy_kWh, RAM_Energy_kWh, Total_Energy_kWh, ...
* <name>_<instance>_master_summary.csv - one row per run, with its seed, totals, best distance,
  carbon intensity, average power and measurement method.

Output:
* data/runs/<algorithm>/<instance>/<reward>_<decay>_e<eps0>_s<seed>.js - one shard per reward,
  epsilon decay, initial epsilon and seed, holding its 64 alpha x gamma runs: the summary of each
  run (best tour, total energy, carbon intensity, average power, measurement method) and, per
  episode, the distance (exact), duration, CPU and RAM energy. Total energy is
  CPU + RAM and emissions are energy x carbon intensity, so they are not stored. Durations and
  energies are kept on a logarithmic 11-bit scale (at most 0.05% relative error); the columns are
  zlib-compressed and base64-encoded.
* data/manifest.js - the parameter grid, the list of shards and the epsilon schedule of each
  decay and initial epsilon (the same for every run that shares them).

Usage:
    python tools/build_dataset.py <results folder> [--jobs 4]
"""
import argparse
import base64
import csv
import gzip
import json
import math
import re
import struct
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import build_summaries
from build_reference import instances

DATA = Path(__file__).resolve().parent.parent / "data"
LEVELS = 2047  # log-scale steps for durations and energies; 0 is kept for an exact zero

# Must match PARAMS in js/config.js.
ALGORITHMS = {"sarsa": "sarsa", "q": "q-learning", "qlearning": "q-learning",
              "doubleq": "double-qlearning", "doubleqlearning": "double-qlearning"}
DECAYS = ["linear", "convex", "concave", "step", "fixed"]
REWARDS = ["R1", "R2", "R3"]
INSTANCES = list(instances())
RUN_KEY = ("run_index", "algorithm", "instance", "r_type", "e_type", "epsilon_init", "gamma", "alpha")


def canon(row):
    """Canonical (algorithm, instance, reward, decay, eps0, gamma, alpha) of a CSV row."""
    algorithm = ALGORITHMS.get(re.sub(r"[^a-z]", "", row["algorithm"].lower()))
    instance = re.sub(r"\.a?tsp$", "", row["instance"].strip(), flags=re.I)
    if algorithm is None or instance not in INSTANCES or row["r_type"] not in REWARDS or row["e_type"] not in DECAYS:
        raise ValueError(f"unexpected run {[row[k] for k in RUN_KEY]}")
    return (algorithm, instance, row["r_type"], row["e_type"],
            round(float(row["epsilon_init"]), 4), round(float(row["gamma"]), 4), round(float(row["alpha"]), 4))


def shard_id(algorithm, instance, reward, decay, eps0, seed):
    """Must match shardId() in js/data.js."""
    return f"{algorithm}/{instance}/{reward}_{decay}_e{eps0:.2f}_s{seed}"


def log_quantise(values):
    """(lo, hi, codes): 0 = exactly zero, 1..LEVELS = log-spaced between the smallest and largest
    positive values."""
    positive = [v for v in values if v > 0]
    if not positive:
        return 0, 0, [0] * len(values)
    lo, hi = min(positive), max(positive)
    span = math.log(hi / lo)
    codes = [0 if v <= 0 else 1 + (round(math.log(v / lo) / span * (LEVELS - 1)) if span else 0) for v in values]
    return lo, hi, codes


def summary_of(row):
    """What the page reads from the summary file. Duration, CPU/RAM energy and emissions are left
    out: the page sums them from the episodes (emissions = energy x intensity)."""
    f = lambda key: float(row[key])
    return {
        "best": f("best_distance"), "bestEpisode": int(row["best_episode"]),
        "energy": f("Total_Energy_kWh"),
        "intensity": round(f("carbon_intensity_kgCO2_per_kWh") * 1000, 3),  # kg -> g per kWh
        "cpuPower": round(f("CPU_Power_avg_W"), 3), "ramPower": round(f("RAM_Power_avg_W"), 3),
        "measurement": {k: row[k] for k in ("cpu_measurement", "tracking_mode") if row.get(k)},
    }


def write_shard(sid, key, runs, episodes):
    """runs: [(gamma, alpha, summary, rows)], rows = [(distance, duration, cpu, ram)] by episode."""
    meta, columns = [], [[], [], [], []]
    for gamma, alpha, summary, rows in sorted(runs, key=lambda r: (r[0], r[1])):
        distance = [int(r[0]) for r in rows]
        lo = min(distance)
        wide = max(distance) - lo > 65535
        columns[0].append(struct.pack(f"<{len(rows)}{'I' if wide else 'H'}", *[d - lo for d in distance]))
        scales = []
        for k in (1, 2, 3):
            vlo, vhi, codes = log_quantise([r[k] for r in rows])
            columns[k].append(struct.pack(f"<{len(rows)}H", *codes))
            scales.append([vlo, vhi])
        meta.append({"gamma": gamma, "alpha": alpha, "distance": [lo, int(wide)], "duration": scales[0],
                     "cpu": scales[1], "ram": scales[2], "summary": summary})
    payload = b"".join(b"".join(col) for col in columns)
    algorithm, instance, reward, decay, eps0, seed = key
    shard = {"id": sid, "algorithm": algorithm, "instance": instance, "reward": reward,
             "epsilon_decay": decay, "epsilon_init": eps0, "seed": seed, "episodes": episodes,
             "firstEpisode": 0, "levels": LEVELS, "runs": meta,
             "data": base64.b64encode(zlib.compress(payload, 9)).decode("ascii")}
    target = DATA / "runs" / f"{sid}.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("GreenRL.registerShard(" + json.dumps(shard, separators=(",", ":")) + ");\n", encoding="utf-8")


def convert(episodes_file, summary_file):
    """Convert one algorithm x instance pair. Returns what the manifest needs."""
    summaries, shard_size = {}, {}
    with open(summary_file, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            c = canon(row)
            seed = int(row["seed"])
            summaries[(row["run_index"],) + c] = (seed, int(row["episodes"]), summary_of(row))
            sk = c[:5] + (seed,)
            shard_size[sk] = shard_size.get(sk, 0) + 1

    pending, epsilon, written, mismatches = {}, {}, [], 0
    opener = gzip.open if str(episodes_file).endswith(".gz") else open
    with opener(episodes_file, "rt", newline="", encoding="utf-8-sig") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        col = {name: i for i, name in enumerate(header)}
        idx = [col[k] for k in RUN_KEY]
        ep_i, eps_i, dist_i = col["episode"], col["epsilon"], col["distance"]
        dur_i, cpu_i, ram_i = col["Duration_sec"], col["CPU_Energy_kWh"], col["RAM_Energy_kWh"]
        runs = {}
        for line, values in enumerate(reader, start=2):
            rk = tuple(values[i] for i in idx)
            run = runs.get(rk)
            if run is None:
                c = canon(dict(zip(RUN_KEY, rk)))
                if (rk[0],) + c not in summaries:
                    sys.exit(f"{episodes_file.name}:{line}: run {rk} has no summary row")
                seed, n, summary = summaries[(rk[0],) + c]
                run = runs[rk] = {"c": c, "seed": seed, "n": n, "summary": summary, "rows": [None] * n, "eps": [None] * n, "count": 0}
            e = int(values[ep_i])
            run["rows"][e] = (float(values[dist_i]), float(values[dur_i]), float(values[cpu_i]), float(values[ram_i]))
            run["eps"][e] = float(values[eps_i])
            run["count"] += 1
            if run["count"] < run["n"]:
                continue
            # Run complete: check it against its summary, then park it in its shard.
            del runs[rk]
            c, rows, summary = run["c"], run["rows"], run["summary"]
            distances = [r[0] for r in rows]
            best = min(distances)
            if best != summary["best"] or distances.index(best) != summary["bestEpisode"]:
                mismatches += 1
            epsilon.setdefault(f"{c[3]}_{c[4]:.2f}", [float(f"{v:.6g}") for v in run["eps"]])
            sk = c[:5] + (run["seed"],)
            pending.setdefault(sk, []).append((c[5], c[6], summary, rows))
            if len(pending[sk]) == shard_size[sk]:
                sid = shard_id(*sk)
                write_shard(sid, sk, pending.pop(sk), run["n"])
                written.append(sid)
        if runs or pending:
            sys.exit(f"{episodes_file.name}: {len(runs)} incomplete run(s), {len(pending)} incomplete shard(s)")
    grid = {}
    for key in summaries:
        for name, value in zip(("algorithm", "instance", "reward", "epsilon_decay", "epsilon_init", "gamma", "alpha"), key[1:]):
            grid.setdefault(name, set()).add(value)
    grid["seed"] = {s for s, _, _ in summaries.values()}
    episodes = {n for _, n, _ in summaries.values()}
    return {"file": episodes_file.name, "shards": written, "runs": len(summaries), "epsilon": epsilon,
            "grid": grid, "episodes": episodes, "mismatches": mismatches}


def pairs(folder):
    found = []
    for episodes_file in sorted(Path(folder).glob("*_master_episodes.csv*")):
        summary_file = Path(str(episodes_file).split("_master_episodes")[0] + "_master_summary.csv")
        if not summary_file.exists():
            sys.exit(f"{episodes_file.name} has no matching {summary_file.name}")
        found.append((episodes_file, summary_file))
    return found


def ordered(values, preferred):
    return [v for v in preferred if v in values] + sorted(v for v in values if v not in preferred)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", help="folder with the *_master_episodes.csv.gz and *_master_summary.csv files")
    parser.add_argument("--jobs", type=int, default=4, help="files converted in parallel (default: 4)")
    args = parser.parse_args()

    jobs = pairs(args.folder)
    if not jobs:
        sys.exit(f"No *_master_episodes.csv(.gz) files in {args.folder}.")
    for old in (DATA / "runs").rglob("*.js"):
        old.unlink()

    results = []
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        for result in pool.map(convert, *zip(*jobs)):
            print(f"  {result['file']}: {result['runs']} runs, {len(result['shards'])} shards"
                  + (f", {result['mismatches']} best-distance mismatch(es) with the summary" if result["mismatches"] else ""))
            results.append(result)

    grid, epsilon, episodes = {}, {}, set()
    for r in results:
        for name, values in r["grid"].items():
            grid.setdefault(name, set()).update(values)
        epsilon.update(r["epsilon"])
        episodes |= r["episodes"]
    if len(episodes) != 1:
        sys.exit(f"Runs have different lengths: {sorted(episodes)}")
    manifest = {
        "episodes": episodes.pop(),
        "grid": {
            "algorithm": ordered(grid["algorithm"], ["sarsa", "q-learning", "double-qlearning"]),
            "instance": ordered(grid["instance"], INSTANCES),
            "epsilon_decay": ordered(grid["epsilon_decay"], DECAYS),
            "reward": ordered(grid["reward"], REWARDS),
            "gamma": sorted(grid["gamma"]), "alpha": sorted(grid["alpha"]),
            "epsilon_init": sorted(grid["epsilon_init"]), "seed": sorted(grid["seed"]),
        },
        "runs": sum(r["runs"] for r in results),
        "shards": sorted(s for r in results for s in r["shards"]),
        "epsilon": dict(sorted(epsilon.items())),
    }
    (DATA / "manifest.js").write_text(
        "// Generated by tools/build_dataset.py. Do not edit by hand.\n"
        "window.GREEN_RL_MANIFEST = " + json.dumps(manifest, separators=(",", ":")) + ";\n", encoding="utf-8")
    size = sum(p.stat().st_size for p in (DATA / "runs").rglob("*.js"))
    print(f"Wrote {manifest['runs']:,} runs in {len(manifest['shards'])} shards ({size / 1e6:.0f} MB) and data/manifest.js.")
    build_summaries.main()  # per-instance index for the ECOVIS score


if __name__ == "__main__":
    main()

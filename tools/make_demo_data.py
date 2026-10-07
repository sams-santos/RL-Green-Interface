"""Generate SYNTHETIC demo runs so the playground works before real results are added.

The numbers are made up: tours come from a randomised 2-opt search (so every distance
matches its path), and duration/energy/emissions follow a simple size-based model.
They only illustrate the interface; they are not RL results.

Usage:  python tools/make_demo_data.py
Replace with real data:  python tools/build_dataset.py <your-results> --fresh
"""
import math
import random
import zlib
from pathlib import Path

from build_dataset import ALGORITHMS, EPISODES, INSTANCES, read_manifest, run_id, write_manifest, write_run
from tsplib_utils import read_instance, tour_length

OUT = Path(__file__).resolve().parent.parent / "data"

DEFAULT = {"epsilon_decay": "linear", "reward": "R1", "gamma": 0.90, "alpha": 0.15, "epsilon_init": 0.10}

CPU_POWER_W = 42.5          # CodeCarbon's constant-mode CPU power
RAM_POWER_W = 6.0
CARBON_INTENSITY = 0.296    # kg CO2eq per kWh (approx. Irish grid)


def demo_configs():
    configs = [dict(DEFAULT, algorithm=a, instance=i) for a in ALGORITHMS for i in INSTANCES]
    # A small sweep on one instance so switching parameters shows a difference.
    base = dict(DEFAULT, algorithm="q-learning", instance="berlin52")
    configs += [dict(base, reward="R2"), dict(base, reward="R3"),
                dict(base, epsilon_decay="convex"), dict(base, epsilon_decay="fixed"),
                dict(base, alpha=0.60), dict(base, gamma=0.30)]
    return configs


def epsilon_at(t, config):
    eps0, frac = config["epsilon_init"], t / EPISODES
    return {
        "linear": eps0 * (1 - frac),
        "convex": eps0 * (1 - frac) ** 2,
        "concave": eps0 * (1 - frac ** 2),
        "step": eps0 * 0.5 ** math.floor(frac * 5),
        "fixed": eps0,
    }[config["epsilon_decay"]]


def skill(config):
    algo = {"sarsa": 0.85, "q-learning": 1.0, "double-qlearning": 1.1}[config["algorithm"]]
    alpha = 0.35 + 0.65 * math.exp(-((config["alpha"] - 0.3) / 0.35) ** 2)
    gamma = 0.5 + 0.5 * config["gamma"]
    reward = {"R1": 1.0, "R2": 0.9, "R3": 1.05}[config["reward"]]
    return min(1.0, 0.75 * algo * alpha * gamma * reward + 0.1)


def simulate(config, instance):
    rng = random.Random(zlib.crc32(run_id(config).encode()))
    n, matrix = instance["dimension"], instance["matrix"]
    tour = list(range(n))
    rest = tour[1:]
    rng.shuffle(rest)
    tour = [0] + rest
    length = tour_length(tour, matrix)
    k = skill(config)
    moves_per_update = 3 * n
    base_duration = 2.0e-5 * n ** 1.7 * {"sarsa": 1.0, "q-learning": 0.97, "double-qlearning": 1.18}[config["algorithm"]]
    cpu_w = CPU_POWER_W * rng.uniform(0.95, 1.05)

    episodes = []
    for t in range(EPISODES):
        eps = epsilon_at(t, config)
        # The greedy tour changes in bursts that become rarer as learning settles.
        if rng.random() < 0.12 * math.exp(-t / 2500) + 0.012:
            for _ in range(moves_per_update):
                i, j = sorted(rng.sample(range(1, n), 2))
                candidate = tour[:i] + tour[i:j + 1][::-1] + tour[j + 1:]
                cand_len = tour_length(candidate, matrix)
                if cand_len < length and rng.random() < k:
                    tour, length = candidate, cand_len
            if rng.random() < 3 * eps * (1.2 - k):  # unstable update: policy gets worse
                i, j = sorted(rng.sample(range(1, n), 2))
                tour = tour[:i] + tour[i:j + 1][::-1] + tour[j + 1:]
                length = tour_length(tour, matrix)

        duration = base_duration * rng.lognormvariate(0, 0.08) * (1 + 0.6 * eps)
        if rng.random() < 0.01:  # background-load spike
            duration *= rng.uniform(1.5, 3.0)
        cpu = cpu_w * rng.uniform(0.9, 1.1) * duration / 3.6e6
        ram = RAM_POWER_W * duration / 3.6e6
        episodes.append({
            "duration": duration,
            "cpu_energy": cpu,
            "ram_energy": ram,
            "energy_consumed": cpu + ram,
            "emissions": (cpu + ram) * CARBON_INTENSITY,
            "distance": length,
            "path": list(tour),
        })
    return episodes


def main():
    instances = {}
    written = []
    for config in demo_configs():
        name = config["instance"]
        instances.setdefault(name, read_instance(name))
        episodes = simulate(config, instances[name])
        rid, target = write_run(OUT, config, episodes, demo=True)
        best = min(e["distance"] for e in episodes)
        print(f"  {rid}: best {best} (opt {instances[name]['optimum']}), {target.stat().st_size / 1e3:.0f} kB")
        written.append(rid)
    write_manifest(OUT, read_manifest(OUT) + written)


if __name__ == "__main__":
    main()

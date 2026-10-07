"""Minimal TSPLIB reader for the instances in data/instances (*.tsp and *.atsp)."""
import math
from pathlib import Path

INSTANCE_DIR = Path(__file__).resolve().parent.parent / "data" / "instances"

# Known optimal tour lengths (TSPLIB95). Instances not listed simply show no optimum.
OPTIMA = {
    "eil51": 426,
    "berlin52": 7542,
    "st70": 675,
    "kroA100": 21282,
    "tsp225": 3916,
    "br17": 39,
    "ftv33": 1286,
    "ftv64": 1839,
    "ftv170": 2755,
}


def _parse(path):
    header, section, body = {}, None, []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line == "EOF":
            continue
        if section is None and ":" in line:
            key, value = line.split(":", 1)
            header[key.strip().upper()] = value.strip()
        elif line.endswith("_SECTION"):
            section = line
        else:
            body.extend(line.split())
    return header, section, body


def instance_files():
    """{name: path} for every instance file, TSP first then ATSP, each by size."""
    found = []
    for path in list(INSTANCE_DIR.glob("*.tsp")) + list(INSTANCE_DIR.glob("*.atsp")):
        header, _, _ = _parse(path)
        found.append((header["TYPE"].upper() != "TSP", int(header["DIMENSION"]), path.stem, path))
    return {name: path for _, _, name, path in sorted(found)}


def read_instance(name):
    """Return dict with name, type, dimension, coords (TSP only) and full distance matrix."""
    header, section, body = _parse(instance_files()[name])
    n = int(header["DIMENSION"])
    if section == "NODE_COORD_SECTION":
        values = [float(v) for v in body]
        coords = [(values[i * 3 + 1], values[i * 3 + 2]) for i in range(n)]
        matrix = [[0 if i == j else int(math.hypot(a[0] - b[0], a[1] - b[1]) + 0.5)
                   for j, b in enumerate(coords)] for i, a in enumerate(coords)]
    elif section == "EDGE_WEIGHT_SECTION" and header.get("EDGE_WEIGHT_FORMAT") == "FULL_MATRIX":
        values = [int(v) for v in body]
        coords = None
        matrix = [values[i * n:(i + 1) * n] for i in range(n)]
    else:
        raise ValueError(f"Unsupported TSPLIB layout in {name}")

    return {"name": name, "type": header["TYPE"].upper(), "dimension": n, "coords": coords,
            "matrix": matrix, "optimum": OPTIMA.get(name)}


def tour_length(tour, matrix):
    """Length of a closed tour given as a list of 0-based node indices."""
    return sum(matrix[tour[i]][tour[(i + 1) % len(tour)]] for i in range(len(tour)))

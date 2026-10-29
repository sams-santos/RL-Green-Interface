"""Download the raw experiment files attached to a GitHub release of this repository.

The release holds, for each algorithm and instance, `<run>_<instance>_master_episodes.csv.gz`
(one row per episode) and `<run>_<instance>_master_summary.csv` (one row per run).
The repository is public, so no sign-in is needed. If GITHUB_TOKEN is set, it is sent with the
release query (a higher rate limit); the files themselves are downloaded from their public links.

Keep the download outside cloud-synced folders: it is about 5.4 GB.

Usage:
    python tools/fetch_release.py <target folder> [--tag data-runs-v1]
"""
import argparse
import json
import os
import urllib.request
from pathlib import Path

REPO = "sams-santos/RL-Green-Interface"


def get(url, accept="application/vnd.github+json"):
    headers = {"Accept": accept}
    if os.environ.get("GITHUB_TOKEN") and url.startswith("https://api.github.com/"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", help="folder to download into")
    parser.add_argument("--tag", default="data-runs-v1", help="release tag (default: data-runs-v1)")
    args = parser.parse_args()

    release = json.load(get(f"https://api.github.com/repos/{REPO}/releases/tags/{args.tag}"))
    target = Path(args.target)
    target.mkdir(parents=True, exist_ok=True)
    for asset in release["assets"]:
        path = target / asset["name"]
        if path.exists() and path.stat().st_size == asset["size"]:
            print(f"  {asset['name']}: already downloaded")
            continue
        print(f"  {asset['name']} ({asset['size'] / 1e6:.0f} MB)")
        with get(asset["browser_download_url"], "application/octet-stream") as response, open(path, "wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    print(f"{len(release['assets'])} file(s) in {target}")


if __name__ == "__main__":
    main()

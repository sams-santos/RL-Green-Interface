"""Download the raw experiment files attached to a GitHub release of this repository.

The release holds, for each algorithm and instance, `<run>_<instance>_master_episodes.csv.gz`
(one row per episode) and `<run>_<instance>_master_summary.csv` (one row per run).
The repository is private, so the request needs a token: GITHUB_TOKEN if set, otherwise the
GitHub credential that git already uses on this computer (it is never printed or saved).

Keep the download outside cloud-synced folders: it is about 5.4 GB.

Usage:
    python tools/fetch_release.py <target folder> [--tag data-runs-v1]
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "sams-santos/RL-Green-Interface"


def token():
    if os.environ.get("GITHUB_TOKEN"):
        return os.environ["GITHUB_TOKEN"]
    out = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                         capture_output=True, text=True, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    for line in out.stdout.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    sys.exit("No GitHub token: set GITHUB_TOKEN or sign in to GitHub with git.")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(url, auth, accept="application/vnd.github+json"):
    """GET with the token. Asset downloads redirect to a storage host, which is fetched without
    the token (it would reject a second authorisation)."""
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {auth}", "Accept": accept})
    try:
        return urllib.request.build_opener(NoRedirect).open(req)
    except urllib.error.HTTPError as err:
        if err.code in (301, 302, 303, 307, 308):
            return urllib.request.urlopen(err.headers["Location"])
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", help="folder to download into")
    parser.add_argument("--tag", default="data-runs-v1", help="release tag (default: data-runs-v1)")
    args = parser.parse_args()

    auth = token()
    release = json.load(request(f"https://api.github.com/repos/{REPO}/releases/tags/{args.tag}", auth))
    target = Path(args.target)
    target.mkdir(parents=True, exist_ok=True)
    for asset in release["assets"]:
        path = target / asset["name"]
        if path.exists() and path.stat().st_size == asset["size"]:
            print(f"  {asset['name']}: already downloaded")
            continue
        print(f"  {asset['name']} ({asset['size'] / 1e6:.0f} MB)")
        with request(asset["url"], auth, "application/octet-stream") as response, open(path, "wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    print(f"{len(release['assets'])} file(s) in {target}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Compare the existing Noir content lock with fresh official GitHub archives.

This never updates the lock. A mismatch produces failure evidence and a nonzero exit.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import tarfile
import tempfile
import urllib.request


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "billboard-noir-origin-verifier", "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(request, timeout=180)


def verify_repository(key, packages, download_dir):
    owner, repo, tag = key
    resolution_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{tag}"
    with fetch(resolution_url) as response:
        resolution = json.load(response)
    commit = resolution["sha"]
    if len(commit) != 40 or any(char not in "0123456789abcdef" for char in commit):
        raise ValueError(f"Unexpected commit identity: {commit}")
    url = f"https://codeload.github.com/{owner}/{repo}/tar.gz/{commit}"
    archive = download_dir / f"{owner}-{repo}-{commit}.tar.gz"
    sha = hashlib.sha256()
    with fetch(url) as response, archive.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            sha.update(chunk)
    results = []
    with tarfile.open(archive, "r:gz") as tree:
        members = {member.name.split("/", 1)[1]: member for member in tree.getmembers() if "/" in member.name and member.isfile()}
        for name, entry in packages:
            package_path = "/".join(name.split("/")[5:])
            package_prefix = package_path + "/" if package_path else ""
            source_prefix = package_prefix + "src/"
            actual = {}
            for relative, member in members.items():
                if relative == package_prefix + "Nargo.toml" or relative.startswith(source_prefix):
                    with tree.extractfile(member) as source:
                        actual[relative.removeprefix(package_prefix)] = digest(source.read())
            expected = entry["files"]
            changed = sorted(name for name in actual.keys() | expected.keys() if actual.get(name) != expected.get(name))
            results.append({"package": name, "outcome": "fail" if changed else "pass", "lockedFiles": len(expected), "archiveFiles": len(actual), "differences": changed,
                            "verifiedFileHashes": actual})
    return {"repository": f"https://github.com/{owner}/{repo}", "tag": tag, "resolvedCommit": commit,
            "resolutionUrl": resolution_url, "archiveUrl": url, "archiveSha256": sha.hexdigest(),
            "archiveBytes": archive.stat().st_size, "packages": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--download-dir")
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    lock_bytes = (root / "noir-dependencies.json").read_bytes()
    lock = json.loads(lock_bytes)
    repos = {}
    for name, package in lock["packages"].items():
        pieces = name.split("/")
        if pieces[:2] != ["dependencies", "github.com"]:
            raise ValueError(f"Unsupported dependency origin: {name}")
        repos.setdefault(tuple(pieces[2:5]), []).append((name, package))
    download_dir = pathlib.Path(args.download_dir) if args.download_dir else pathlib.Path(tempfile.mkdtemp(prefix="billboard-noir-origins-"))
    download_dir.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(verify_repository, key, packages, download_dir): key for key, packages in repos.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                result = future.result()
                results.append(result)
                print(f"Verified {result['repository']} at {result['resolvedCommit']}", flush=True)
            except Exception as error:
                errors.append({"repository": "/".join(futures[future]), "error": str(error)})
    passed = not errors and all(package["outcome"] == "pass" for repo in results for package in repo["packages"])
    report = {"schema": 1, "outcome": "pass" if passed else "fail", "recordedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "lockfileSha256": digest(lock_bytes), "method": "Fresh HTTPS downloads from official repository commit archives; compare every locked package manifest and source-directory file byte-for-byte by SHA-256. No developer cache used for downloaded comparison. Tags are resolved to commits at the recorded time. This establishes origin consistency, not an independent code audit.",
              "repositories": sorted(results, key=lambda value: value["repository"]), "errors": errors}
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{report['outcome'].upper()}: {len(results)} repository archives; evidence {output}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())

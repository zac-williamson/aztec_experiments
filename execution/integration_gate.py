#!/usr/bin/env python3
"""Fail-closed development integration gate. Policy is supplied by the lead."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


class GateError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    require(result.returncode == 0, "git operation failed: " + result.stderr.decode(errors="replace").strip())
    return result.stdout.decode()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    try:
        value = json.loads(Path(path).read_text())
    except (OSError, ValueError) as error:
        raise GateError(f"unreadable JSON {path}: {error}") from error
    require(isinstance(value, dict), f"expected object: {path}")
    return value


def strings(value, label, nonempty=True):
    require(isinstance(value, list) and (value or not nonempty), f"missing/invalid {label}")
    require(all(isinstance(item, str) and item.strip() for item in value), f"invalid {label}")
    require(len(value) == len(set(value)), f"duplicate {label}")
    return value


def safe_path(value):
    require(isinstance(value, str) and value and "\\" not in value, "invalid relative path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and all(part not in (".", "..") for part in value.split("/")), "unsafe relative path")
    return value


def contains(scope, path):
    # Scope is an exact file or directory prefix; no ambiguous glob semantics.
    return path == scope or path.startswith(scope + "/")


def artifacts(record, root, label):
    items = record.get("artifacts")
    require(isinstance(items, list) and items, f"missing {label} artifacts")
    for item in items:
        require(isinstance(item, dict), f"invalid {label} artifact")
        relative = safe_path(item.get("path"))
        path = (root / relative).resolve()
        require(path.is_relative_to(root), f"escaping {label} artifact")
        try:
            actual = digest(path)
        except OSError as error:
            raise GateError(f"unreadable {label} artifact {relative}: {error}") from error
        require(actual == item.get("sha256"), f"hash mismatch: {label} artifact {relative}")


def bound(record, candidate, base, label):
    require(isinstance(record, dict), f"missing/invalid {label}")
    require(record.get("candidate") == candidate and record.get("base") == base, f"stale {label} revision/base")


def passing(record, label):
    require(record.get("status") == "pass", f"{label} status: {record.get('status', 'missing')}")


def index_records(records, label):
    require(isinstance(records, list), f"missing/invalid {label}")
    result = {}
    for record in records:
        require(isinstance(record, dict) and isinstance(record.get("id"), str), f"invalid {label} record")
        require(record["id"] not in result, f"duplicate {label}: {record['id']}")
        result[record["id"]] = record
    return result


def validate(repo, policy, evidence, evidence_root):
    root = Path(evidence_root).resolve()
    candidate, base = policy.get("candidate"), policy.get("base")
    for label, revision in (("candidate", candidate), ("base", base)):
        require(isinstance(revision, str) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", revision), f"{label} must be a full object ID")
        require(git(repo, "rev-parse", "--verify", revision + "^{commit}").strip() == revision, f"invalid {label} commit")
    require(candidate != base, "candidate has no changes")
    ref = policy.get("integration_ref")
    require(isinstance(ref, str) and ref.startswith("refs/heads/"), "integration_ref must be a local branch ref")
    git(repo, "check-ref-format", ref)
    require(git(repo, "rev-parse", "--verify", ref).strip() == base, "integration base moved")
    git(repo, "merge-base", "--is-ancestor", base, candidate)
    require(policy.get("task_id") and policy.get("implementer"), "missing task/implementer identity")
    scopes = [safe_path(x) for x in strings(policy.get("allowed_paths"), "allowed_paths")]
    checks = strings(policy.get("required_checks"), "required_checks")
    requirements = strings(policy.get("requirements"), "requirements")
    require(policy.get("holds") == [], "policy holds missing or unresolved")
    ownership = policy.get("ownership")
    require(isinstance(ownership, list), "missing ownership snapshot")
    for claim in ownership:
        require(isinstance(claim, dict) and claim.get("owner") and claim.get("task_id"), "invalid ownership claim")
        paths = [safe_path(x) for x in strings(claim.get("paths"), "ownership paths")]
        if claim["owner"] != policy["implementer"] or claim["task_id"] != policy["task_id"]:
            require(not any(contains(a, b) or contains(b, a) for a in scopes for b in paths), "ownership conflict")
    own_claims = [c for c in ownership if c["owner"] == policy["implementer"] and c["task_id"] == policy["task_id"]]
    require(own_claims and all(any(contains(p, s) for c in own_claims for p in c["paths"]) for s in scopes), "missing task ownership claim")
    paths = git(repo, "diff", "--name-only", "--no-renames", "-z", base, candidate).split("\0")
    for path in filter(None, paths):
        require(any(contains(scope, path) for scope in scopes), f"out-of-scope change: {path}")
    bound(evidence, candidate, base, "evidence")
    require(evidence.get("task_id") == policy["task_id"], "wrong evidence task")
    require(evidence.get("holds") == [], "evidence holds missing or unresolved")
    findings = evidence.get("findings")
    require(isinstance(findings, list), "missing findings")
    for finding in findings:
        require(isinstance(finding, dict) and type(finding.get("blocking")) is bool and finding.get("status") in ("open", "resolved"), "invalid finding")
        require(not finding["blocking"] or finding["status"] == "resolved", "unresolved blocking finding")
    records = index_records(evidence.get("checks"), "checks")
    for name in checks:
        require(name in records, f"missing check: {name}")
        check = records[name]
        bound(check, candidate, base, "check " + name)
        passing(check, "check " + name)
        for field in ("command", "environment", "observed"):
            require(isinstance(check.get(field), str) and check[field].strip(), f"missing check {name} {field}")
        require(type(check.get("exit_code")) is int and check["exit_code"] == 0, f"failed exit code: {name}")
        artifacts(check, root, "check " + name)
    review = evidence.get("review")
    bound(review, candidate, base, "review")
    require(review.get("verdict") == "approve", "review not approved")
    require(review.get("kind") == "independent" and isinstance(review.get("reviewer"), str)
            and review["reviewer"].strip() and review["reviewer"] != policy["implementer"], "review is not independent")
    require(review.get("implementer") == policy["implementer"], "review implementer mismatch")
    artifacts(review, root, "review")
    acceptance = index_records(evidence.get("acceptance"), "acceptance")
    for requirement in requirements:
        require(requirement in acceptance, f"missing acceptance: {requirement}")
        record = acceptance[requirement]
        bound(record, candidate, base, "acceptance " + requirement)
        passing(record, "acceptance " + requirement)
        artifacts(record, root, "acceptance " + requirement)
    return candidate, base, ref


def advance(repo, candidate, base, ref):
    # Updating a checked-out ref would silently desynchronize its working tree.
    worktrees = git(repo, "worktree", "list", "--porcelain").splitlines()
    require("branch " + ref not in worktrees, "integration branch is checked out; detach it with a clean checkout first")
    git(repo, "update-ref", "-m", "integration gate: reviewed candidate", ref, candidate, base)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "integrate"))
    parser.add_argument("--repo", default=".")
    parser.add_argument("--policy", required=True, help="lead-owned immutable policy snapshot")
    parser.add_argument("--policy-sha256", required=True, help="lead-approved policy digest")
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--evidence-root", required=True)
    args = parser.parse_args(argv)
    try:
        require(digest(Path(args.policy)) == args.policy_sha256, "policy digest mismatch")
        policy = read_json(args.policy)
        require(digest(Path(args.policy)) == args.policy_sha256, "policy changed while reading")
        evidence = read_json(args.evidence)
        candidate, base, ref = validate(args.repo, policy, evidence, args.evidence_root)
        if args.mode == "integrate":
            advance(args.repo, candidate, base, ref)
        print(json.dumps({"status": "pass", "mode": args.mode, "candidate": candidate, "base": base, "ref": ref}))
        return 0
    except (GateError, OSError) as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())

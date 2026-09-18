#!/usr/bin/env python3
"""Read-only execution checks, selection, and explicit documentation rendering.

This validates records and content hashes; it does not certify their truth.
No third-party packages, network calls, transaction execution, or agent dispatch.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
STATES = {"planned", "active", "verification", "review", "done", "blocked"}
HASH = re.compile(r"^[0-9a-f]{64}$")


def read_json(path):
    return json.loads(path.read_text())


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def confined(base, name):
    if not isinstance(name, str) or not name or Path(name).is_absolute():
        raise ValueError(f"expected relative path: {name!r}")
    path = (base / name).resolve()
    if not path.is_relative_to(base.resolve()):
        raise ValueError(f"path escapes allowed directory: {name}")
    return path


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO 8601 string")
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("timestamp needs timezone")
    return dt.astimezone(timezone.utc)


def source_snapshot(repo=REPO):
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=repo, check=True, capture_output=True,
    )
    names = sorted(set(result.stdout.decode().split("\0")) - {""})
    files = []
    for name in names:
        if name == "AGENTS.md" or name.startswith("execution/"):
            continue
        path = confined(repo, name)
        files.append({"path": name, "sha256": sha(path) if path.is_file() else "DELETED"})
    if not files:
        raise ValueError("empty application source inventory")
    digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, check=True,
                              capture_output=True, text=True).stdout.strip()
    return {"fingerprint": digest, "git_revision": revision, "files": files}


def check_artifacts(items, base):
    if not isinstance(items, list) or not items:
        raise ValueError("nonempty artifacts list required")
    paths = set()
    for item in items:
        path = confined(base, item["path"])
        if item["path"] in paths:
            raise ValueError(f"duplicate artifact {item['path']}")
        paths.add(item["path"])
        if not HASH.fullmatch(item.get("sha256", "")):
            raise ValueError(f"invalid hash for {item['path']}")
        if not path.is_file() or sha(path) != item["sha256"]:
            raise ValueError(f"missing or changed artifact: {item['path']}")
    return paths


def dependency_edges(n):
    return n.get("depends_on", []) + n.get("completion_requires", [])


def write_paths(n):
    paths = n.get("write_paths")
    if not isinstance(paths, list) or not paths:
        raise ValueError("nonempty write_paths required")
    result = []
    for name in paths:
        if not isinstance(name, str) or any(c in name for c in "*?[]"):
            raise ValueError("write_paths must be literal relative paths, not globs")
        path = confined(REPO, name)
        if path in result:
            raise ValueError("duplicate write_paths")
        result.append(path)
    return result


def overlap(left, right):
    return any(a.is_relative_to(b) or b.is_relative_to(a) for a in left for b in right)


def exhausted(n):
    investigation = n.get("investigation")
    return investigation is not None and investigation["attempts"] >= investigation["max_attempts"]


def graph_errors(g):
    errors = []
    nodes = g.get("nodes", [])
    if g.get("schema_version") != 1 or not nodes:
        return ["unsupported schema or empty graph"]
    ids = [n.get("id") for n in nodes]
    if len(set(ids)) != len(ids):
        errors.append("duplicate task IDs")
    if any(not isinstance(i, str) or not re.fullmatch(r"[A-Z][0-9]{2}", i) for i in ids):
        return errors + ["invalid task ID"]
    by_id = {n["id"]: n for n in nodes}
    mandatory = {"X01", "X02", "X03", "O02", "T05", "T06", "R04"}
    if not mandatory.issubset(by_id) or g.get("terminal") != "R04":
        errors.append("mandatory production release gates missing or terminal changed")
    for ident in {"X02", "T05", "T06", "R04"} & by_id.keys():
        if by_id[ident].get("evidence_mode") != "current":
            errors.append(f"{ident}: final gate must bind to current application source")
    for ident in {"X01", "X02", "X03", "O02"} & by_id.keys():
        if by_id[ident].get("kind") != "external":
            errors.append(f"{ident}: external acceptance cannot become self-certification")
    reqs, findings = set(g.get("requirements", [])), set(g.get("findings", []))
    if reqs != {f"REQ{i:02}" for i in range(1, 13)}:
        errors.append("required REQ01–REQ12 catalog changed or missing")
    if findings != {f"B{i:02}" for i in range(1, 13)}:
        errors.append("baseline B01–B12 catalog changed or missing")
    covered_req, covered_findings, criteria = set(), set(), set()
    active = []
    for n in nodes:
        ident = n["id"]
        if n.get("status") not in STATES:
            errors.append(f"{ident}: invalid status")
        if not isinstance(n.get("priority"), int) or n["priority"] < 0:
            errors.append(f"{ident}: nonnegative scheduling priority required")
        if n.get("status") in {"active", "verification", "review"}:
            active.append(ident)
        if n.get("kind") not in {"internal", "external"} or n.get("evidence_mode") not in {"historical", "current"}:
            errors.append(f"{ident}: invalid kind/evidence mode")
        for key in ("title", "plan", "evidence", "checkpoint", "phase"):
            if not isinstance(n.get(key), str) or not n[key].strip():
                errors.append(f"{ident}: missing {key}")
        for key in ("scope", "actions", "acceptance", "requirements"):
            if not isinstance(n.get(key), list) or not n[key]:
                errors.append(f"{ident}: empty {key}")
        for key in ("depends_on", "completion_requires"):
            dependencies = n.get(key, [])
            if (not isinstance(dependencies, list) or any(not isinstance(d, str) for d in dependencies)
                    or len(set(dependencies)) != len(dependencies)):
                errors.append(f"{ident}: malformed/duplicate {key} dependencies")
                continue
            for dep in dependencies:
                if dep not in by_id or dep == ident:
                    errors.append(f"{ident}: missing/self dependency {dep}")
                elif (n.get("status") == "done" or key == "depends_on" and n.get("status") in {"active", "verification", "review"}) and by_id[dep].get("status") != "done":
                    errors.append(f"{ident}: {key} prerequisite {dep} is not done")
        if "execution_lane" in n and (not isinstance(n["execution_lane"], str) or not n["execution_lane"].strip()):
            errors.append(f"{ident}: invalid execution_lane")
        if "write_paths" in n:
            try:
                write_paths(n)
            except ValueError as exc:
                errors.append(f"{ident}: {exc}")
        if "investigation" in n:
            inv = n["investigation"]
            if (not isinstance(inv, dict)
                    or any(not isinstance(inv.get(k), str) or not inv[k].strip() for k in ("hypothesis", "next_action"))
                    or type(inv.get("attempts")) is not int or inv["attempts"] < 0
                    or type(inv.get("max_attempts")) is not int or inv["max_attempts"] < 1):
                errors.append(f"{ident}: malformed investigation")
        if set(n.get("requirements", [])) - reqs or set(n.get("findings", [])) - findings:
            errors.append(f"{ident}: unknown requirement/finding")
        covered_req.update(n.get("requirements", []))
        covered_findings.update(n.get("findings", []))
        for a in n.get("acceptance", []):
            aid = a.get("id", "")
            if not re.fullmatch(re.escape(ident) + r"-A[0-9]{2}", aid) or aid in criteria or not a.get("description"):
                errors.append(f"{ident}: invalid/duplicate acceptance criterion {aid}")
            criteria.add(aid)
        if n.get("status") == "blocked":
            b = n.get("blocker")
            if not isinstance(b, dict) or any(not b.get(k) for k in ("reason", "evidence", "unblock", "next_action")):
                errors.append(f"{ident}: incomplete blocker record")
        elif n.get("blocker") is not None:
            errors.append(f"{ident}: blocker must be null unless blocked")
    if len(active) > 3:
        errors.append("three-package work limit exceeded: " + ", ".join(active))
    if len(active) > 1:
        lanes, owners = set(), []
        for ident in active:
            n = by_id[ident]
            lane = n.get("execution_lane")
            if not isinstance(lane, str) or not lane.strip() or lane in lanes:
                errors.append(f"{ident}: parallel work requires distinct execution_lane")
            else:
                lanes.add(lane)
            try:
                paths = write_paths(n)
                for other, other_paths in owners:
                    if overlap(paths, other_paths):
                        errors.append(f"{ident}: write_paths overlap active package {other}")
                owners.append((ident, paths))
            except ValueError as exc:
                errors.append(f"{ident}: parallel work {exc}")
    if covered_req != reqs or covered_findings != findings:
        errors.append("unassigned requirement or baseline finding")
    if any("malformed/duplicate" in error for error in errors):
        return errors
    seen, visiting = set(), set()
    def walk(ident):
        if ident in visiting:
            errors.append(f"dependency cycle at {ident}")
            return
        if ident in seen or ident not in by_id:
            return
        visiting.add(ident)
        for dep in dependency_edges(by_id[ident]):
            walk(dep)
        visiting.remove(ident)
        seen.add(ident)
    for ident in ids:
        walk(ident)
    terminal = g.get("terminal")
    if terminal not in by_id:
        errors.append("terminal task missing")
    else:
        ancestors = set()
        def gather(ident):
            if ident in ancestors or ident not in by_id:
                return
            ancestors.add(ident)
            for dep in dependency_edges(by_id[ident]):
                gather(dep)
        gather(terminal)
        if ancestors != set(ids):
            errors.append("tasks disconnected from terminal gate: " + ", ".join(sorted(set(ids)-ancestors)))
        if set(by_id[terminal].get("requirements", [])) != reqs:
            errors.append("terminal gate must cover all requirements")
    if g.get("execution_state") not in {"awaiting_start", "running", "paused", "blocked", "complete"}:
        errors.append("invalid execution_state")
    if g.get("execution_state") == "awaiting_start" and any(n.get("status") != "planned" for n in nodes):
        errors.append("awaiting_start requires all application packages planned")
    if g.get("execution_state") == "complete" and any(n.get("status") != "done" for n in nodes):
        errors.append("complete objective has unfinished tasks")
    return errors


def verify_release(g, base, fingerprint):
    matrix = read_json(base / "release/acceptance-matrix.json")
    if matrix.get("source_fingerprint") != fingerprint:
        raise ValueError("acceptance matrix is not bound to current candidate")
    expected = {a["id"] for n in g["nodes"]
                if n["kind"] == "internal" and n["evidence_mode"] == "historical"
                for a in n["acceptance"]}
    entries = matrix.get("criteria", [])
    actual = [x["id"] for x in entries]
    if set(actual) != expected or len(set(actual)) != len(actual):
        raise ValueError("final matrix must cover every historical internal acceptance criterion exactly once")
    for entry in entries:
        if entry.get("result") != "pass" or not entry.get("summary"):
            raise ValueError(f"matrix criterion not passed: {entry['id']}")
        check_artifacts(entry.get("artifacts"), base)
    req_entries = matrix.get("requirements", [])
    req_ids = [r.get("id") for r in req_entries]
    if set(req_ids) != set(g["requirements"]) or len(set(req_ids)) != len(req_ids):
        raise ValueError("final matrix must cover each production requirement exactly once")
    for req in req_entries:
        valid = {a["id"] for n in g["nodes"] if req["id"] in n["requirements"]
                 for a in n["acceptance"]} & expected
        if not req.get("criteria") or not set(req["criteria"]).issubset(valid):
            raise ValueError(f"invalid requirement traceability: {req['id']}")
    manifest = read_json(base / "release/manifest.json")
    if manifest.get("source_fingerprint") != fingerprint:
        raise ValueError("release manifest is not bound to current candidate")
    for key in ("toolchain", "build_inputs", "target_network"):
        if not isinstance(manifest.get(key), dict) or not manifest[key]:
            raise ValueError(f"release manifest missing {key}")
    check_artifacts(manifest.get("artifacts"), base.parent)
    categories = {x.get("category") for x in manifest["artifacts"]}
    required = {"l1_contract", "l2_contract", "verification_keys", "frontend", "sdk_workers", "proving_assets", "operations"}
    if not required.issubset(categories):
        raise ValueError("release manifest missing distributable categories: " + ", ".join(sorted(required-categories)))


def verify_evidence(n, g, base, fingerprint, now):
    record = read_json(confined(base, n["evidence"]))
    if record.get("task_id") != n["id"] or record.get("outcome") != "pass":
        raise ValueError("evidence must name this task and have passing outcome")
    when = timestamp(record.get("recorded_at"))
    if when > now + timedelta(minutes=5):
        raise ValueError("evidence timestamp is in the future")
    source = record.get("source_fingerprint", "")
    if not HASH.fullmatch(source):
        raise ValueError("missing source fingerprint")
    if n["evidence_mode"] == "current" and source != fingerprint:
        raise ValueError("release evidence is stale after application changes")
    paths = check_artifacts(record.get("artifacts"), base)
    inventory_path = record.get("source_inventory")
    if inventory_path not in paths:
        raise ValueError("source inventory must be a hashed evidence artifact")
    inventory = read_json(confined(base, inventory_path))
    inventory_files = inventory.get("files")
    if not isinstance(inventory_files, list) or not inventory_files:
        raise ValueError("source inventory is empty")
    inventory_digest = hashlib.sha256(json.dumps(inventory_files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if inventory_digest != source or inventory.get("fingerprint") != source:
        raise ValueError("source inventory does not match evidence fingerprint")
    entries = record.get("criteria", [])
    expected = {a["id"] for a in n["acceptance"]}
    actual = [x.get("id") for x in entries]
    if set(actual) != expected or len(set(actual)) != len(actual):
        raise ValueError("evidence does not cover each acceptance criterion exactly once")
    for entry in entries:
        refs = entry.get("artifacts")
        if entry.get("result") != "pass" or not entry.get("summary") or not refs or not set(refs).issubset(paths):
            raise ValueError(f"criterion {entry.get('id')} lacks passing, linked evidence")
    review = record.get("review", {})
    if any(not review.get(k) for k in ("kind", "reviewer", "summary", "artifacts")) or not set(review.get("artifacts", [])).issubset(paths):
        raise ValueError("missing linked review record")
    if n["id"] in {"X01", "X02"} and review.get("kind") != "independent":
        raise ValueError("independent review is required; self-review cannot substitute")
    if n["id"] == "O02" and review.get("kind") != "operator":
        raise ValueError("operator acceptance is required")
    if n["id"] == "X03" and now - when > timedelta(days=7):
        raise ValueError("network readiness evidence is older than seven days")
    if n["id"] == "T06":
        soak = record.get("soak", {})
        start, end = timestamp(soak.get("started_at")), timestamp(soak.get("ended_at"))
        if end > now or start > end or end-start < timedelta(hours=336):
            raise ValueError("soak must evidence at least 336 actual elapsed hours")
        if not soak.get("coverage_artifact") in paths:
            raise ValueError("soak monitoring coverage evidence missing")
    if n["id"] in {"T05", "R04"}:
        if not {"release/manifest.json", "release/acceptance-matrix.json"}.issubset(paths):
            raise ValueError("final evidence must hash release manifest and acceptance matrix")
        verify_release(g, base, fingerprint)


def validate(g, base=HERE, fingerprint=None, now=None, check_plans=True):
    errors = graph_errors(g)
    if errors:
        return errors
    now = now or datetime.now(timezone.utc)
    for n in g["nodes"]:
        try:
            plan = confined(base, n["plan"])
            if check_plans and (not plan.is_file() or plan.read_text() != render_task(n)):
                raise ValueError("task plan missing/outdated; run graph.py render")
            if n["status"] == "done":
                if fingerprint is None:
                    fingerprint = source_snapshot(base.parent)["fingerprint"]
                verify_evidence(n, g, base, fingerprint, now)
        except (ValueError, OSError, KeyError, TypeError) as exc:
            errors.append(f"{n['id']}: {exc}")
    return errors


def available(g):
    by_id = {n["id"]: n for n in g["nodes"]}
    ready = [n for n in g["nodes"] if n["status"] == "planned"
             and all(by_id[d]["status"] == "done" for d in n["depends_on"])]
    return sorted(ready, key=lambda n: n["priority"])


def render_task(n):
    lines = [f"# {n['id']} — {n['title']}", "", "Generated from execution/graph.json. Edit the graph, then run graph.py render.", "",
             f"- Phase: {n['phase']}", f"- Type: {n['kind']}",
             f"- Prerequisites: {', '.join(n['depends_on']) or 'none'}",
             f"- Required before completion: {', '.join(n.get('completion_requires', [])) or 'none additional'}",
             f"- Execution lane: {n.get('execution_lane', 'single-package default')}",
             f"- Exclusive write paths: {', '.join(n.get('write_paths', [])) or 'assign before parallel execution'}",
             f"- Requirements: {', '.join(n['requirements'])}",
             f"- Baseline findings: {', '.join(n['findings']) or 'production component / release requirement'}",
             f"- Evidence: execution/{n['evidence']}", f"- Evidence binding: {n['evidence_mode']}", "",
             "## Purpose and context", "",
             "Read execution/requirements.md, decisions.md and the baseline assessment, then inspect prerequisite outputs and the relevant source. Requirements and acceptance below define completion; this plan does not assert any implementation already exists.", "",
             "## Source and edit boundaries", "", *[f"- `{p}`" for p in n['scope']], "",
             "These paths identify the working area; some new service/test/output paths will be created. Read related dependencies as needed. Record any necessary expansion before editing unrelated components. Use actual pinned APIs and discovered build commands; do not assume a proposed test or helper already exists.", "",
             "## Work", "", *[f"{i}. {s}" for i,s in enumerate(n['actions'],1)], "",
             "## Acceptance", "", *[f"- **{a['id']}** — {a['description']}" for a in n['acceptance']], "",
             "## Verification and handoff", "",
             "Record exact commands, environment, sanitized output, source inventory, expected/observed behavior and limitations. Use execution/evidence/README.md. Tests must exercise the behavior and fail for the relevant bad case where practical; mocked evidence cannot satisfy a real-proof criterion. Perform a separate diff/assumption review after implementation. Keep external review requirements distinct from self-review.", "",
             "If blocked, record reason, evidence, unblock condition and next action in graph.json; continue another ready package. Before marking done, verify all criteria and prerequisite states, save linked evidence, run graph.py validate, and update status.md. No unchecked criterion may be silently waived.", ""]
    return "\n".join(lines)


def render(g, base=HERE):
    for n in g["nodes"]:
        path = confined(base, n["plan"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_task(n))
    lines = ["# Execution graph", "", "Generated from graph.json. Solid arrows are start prerequisites; dotted arrows are completion prerequisites.", "", "```mermaid", "flowchart TD"]
    for n in g["nodes"]:
        title = n["title"].replace('"', "'")
        lines.append(f'    {n["id"]}["{n["id"]}: {title}"]')
        lines.extend(f"    {dep} --> {n['id']}" for dep in n["depends_on"])
        lines.extend(f"    {dep} -.-> {n['id']}" for dep in n.get("completion_requires", []))
    lines += ["```", "", "## Work packages", "", "| ID | Package | Prerequisites | Kind |", "|---|---|---|---|"]
    lines.extend(f"| [{n['id']}]({n['plan']}) | {n['title']} | {', '.join(n['depends_on']) or 'none'} | {n['kind']} |" for n in g['nodes'])
    (base / "GRAPH.md").write_text("\n".join(lines)+"\n")
    (base / "status.md").write_text(render_status(g))


def render_status(g):
    lines = ["# Current execution status", "", "Generated from graph.json; edit checkpoints and blockers there, then run graph.py render.", "",
             f"Objective state: **{g['execution_state']}**. Completed packages: {sum(n['status'] == 'done' for n in g['nodes'])}/{len(g['nodes'])}.", ""]
    for title, nodes in (
        ("In progress", [n for n in g["nodes"] if n["status"] in {"active", "verification", "review"}]),
        ("Ready internal work", [n for n in available(g) if n["kind"] == "internal"]),
        ("Blocked", [n for n in g["nodes"] if n["status"] == "blocked"]),
    ):
        lines += [f"## {title}", ""]
        for n in nodes:
            lines += [f"- **{n['title']} ({n['id']})** — {n['checkpoint']}"]
            if n.get("blocker"):
                lines += [f"  Blocker: {n['blocker']['reason']} Next action: {n['blocker']['next_action']}"]
            if n.get("investigation"):
                inv = n["investigation"]
                lines += [f"  Investigation: {inv['attempts']}/{inv['max_attempts']} attempts. {'Reassessment required. ' if exhausted(n) else ''}{inv['next_action']}"]
        if not nodes:
            lines.append("None.")
        lines.append("")
    lines += ["Completion remains subject to all acceptance evidence and release gates. Ready means start prerequisites are met, not that parallel write ownership is available.", ""]
    return "\n".join(lines)


def next_steps(g):
    if g['execution_state'] == 'paused':
        return "Paused; wait for user resume before execution."
    lines = []
    if g['execution_state'] == 'awaiting_start':
        lines.append("Prepared; awaiting user 'start'. On start set execution_state=running, then execute:")
    running = [n for n in g['nodes'] if n['status'] in {'active', 'verification', 'review'}]
    ready = available(g)
    internal = [n for n in ready if n['kind'] == 'internal']
    for n in running or internal[:1]:
        if exhausted(n):
            lines.append(f"REASSESS {n['id']}: {n['title']} — investigation budget exhausted. {n['investigation']['next_action']}")
        else:
            lines.append(f"NEXT {n['id']}: {n['title']}\nRead execution/{n['plan']}\nCheckpoint: {n['checkpoint']}")
    candidates = internal if running else internal[1:]
    if candidates:
        lines.append("Independent internal candidates (assign disjoint write ownership and a free lane before activation):")
        for n in candidates:
            label = "REASSESS" if exhausted(n) else "READY"
            lines.append(f"  {label} {n['id']}: {n['title']} — execution/{n['plan']}")
    external = [n for n in ready if n['kind'] == 'external']
    if external:
        lines.append("External gates ready for evidence collection (read-only checks may be performed without asking):")
        lines.extend(f"  {n['id']}: {n['title']} — execution/{n['plan']}" for n in external)
    if not running and not internal:
        lines.append("No ready internal work. Complete available external evidence, or resolve recorded blockers; do not claim production readiness prematurely.")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "next", "status", "render", "snapshot"])
    parser.add_argument("--output", help="snapshot output path relative to execution/; explicit write")
    args = parser.parse_args()
    if args.command == "snapshot":
        snapshot = source_snapshot()
        if args.output:
            path = confined(HERE, args.output)
            if path.exists():
                parser.error("snapshot output exists; use a new evidence filename")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(snapshot, indent=2)+"\n")
        print(json.dumps({k:v for k,v in snapshot.items() if k != "files"}, indent=2))
        return 0
    g = read_json(HERE / "graph.json")
    if args.command == "render":
        errors = graph_errors(g)
        if errors:
            print("\n".join(errors), file=sys.stderr)
            return 1
        render(g)
        print(f"Rendered {len(g['nodes'])} task plans, GRAPH.md and status.md.")
        return 0
    errors = validate(g)
    if errors:
        print("INVALID\n" + "\n".join(errors), file=sys.stderr)
        return 1
    if args.command == "validate":
        print(f"VALID: {len(g['nodes'])} packages, {sum(len(n['acceptance']) for n in g['nodes'])} criteria; dependency, plan and completed-evidence checks passed.")
    elif args.command == "status":
        print(f"Objective state: {g['execution_state']}")
        for state in sorted(STATES):
            ids = [n['id'] for n in g['nodes'] if n['status'] == state]
            if ids:
                print(f"{state}: {', '.join(ids)}")
        for n in g['nodes']:
            if n['status'] == 'blocked':
                print(f"BLOCKER {n['id']}: {json.dumps(n['blocker'])}")
    else:
        print(next_steps(g))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

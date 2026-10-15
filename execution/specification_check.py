#!/usr/bin/env python3
"""Check the Draft 3 item-to-task map without claiming product acceptance."""
import argparse
import json
import re
from pathlib import Path

REQUIREMENTS = {f"RC{i:02}" for i in range(1, 47)}
KINDS = {"mandatory", "proposed-default", "owner-reserved", "commercial", "release-gate"}


def check(graph, mapping):
    errors = []
    rows = mapping.get("requirements", [])
    ids = [row.get("id") for row in rows]
    if set(ids) != REQUIREMENTS or len(ids) != len(REQUIREMENTS):
        errors.append("Draft3 RC01-RC46 catalog missing, changed or duplicated")
    nodes = {n["id"]: n for n in graph["nodes"]}
    catalog = {r["id"]: r for r in graph.get("product_requirements", [])}
    if set(catalog) != REQUIREMENTS:
        errors.append("graph product catalog differs from Draft3")
    source_hash = mapping.get("source", {}).get("sha256")
    graph_hash = graph.get("specification", {}).get("sha256")
    if any(not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)
           for value in (source_hash, graph_hash)):
        errors.append("missing/invalid specification source hash")
    elif source_hash != graph_hash:
        errors.append("specification source hash mismatch")
    for row in rows:
        ident = row.get("id")
        tasks = row.get("tasks", [])
        if row.get("authority") not in KINDS or not row.get("requirement") or not 1 <= row.get("pdf_page", 0) <= 11:
            errors.append(f"{ident}: invalid requirement provenance")
        if not tasks or len(tasks) != len(set(tasks)):
            errors.append(f"{ident}: missing or duplicate task mapping")
        if catalog.get(ident, {}).get("tasks") != tasks or catalog.get(ident, {}).get("authority") != row.get("authority"):
            errors.append(f"{ident}: graph/catalog mismatch")
        criteria, evidence = [], []
        for task in tasks:
            node = nodes.get(task)
            if node is None:
                errors.append(f"{ident}: unknown task {task}")
                continue
            matches = [a["id"] for a in node["acceptance"] if a.get("specification_requirement") == ident]
            if len(matches) != 1 or ident not in node.get("specification_requirements", []):
                errors.append(f"{ident}: {task} needs one explicit acceptance criterion")
            criteria.extend(matches)
            evidence.append(node["evidence"])
            for field in ("owner", "branch", "verification_method", "scope"):
                if not node.get(field):
                    errors.append(f"{task}: missing {field}")
        if row.get("acceptance_criteria") != criteria or row.get("evidence") != evidence:
            errors.append(f"{ident}: dangling acceptance/evidence mapping")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=Path(__file__).with_name("graph.json"))
    parser.add_argument("--map", type=Path, default=Path(__file__).with_name("draft3-requirements.json"))
    args = parser.parse_args()
    try:
        errors = check(json.loads(args.graph.read_text()), json.loads(args.map.read_text()))
    except (OSError, ValueError, KeyError, TypeError) as error:
        errors = [f"unreadable/invalid specification map: {error}"]
    print(json.dumps({"status": "blocked" if errors else "pass", "errors": errors}))
    return bool(errors)


if __name__ == "__main__":
    raise SystemExit(main())

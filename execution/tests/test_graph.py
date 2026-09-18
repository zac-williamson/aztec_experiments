"""Adversarial checks for the completion gates, using disposable evidence only."""
import copy
import hashlib
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("execution_graph", BASE / "graph.py")
graph = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graph)


class GraphTests(unittest.TestCase):
    def setUp(self):
        self.g = graph.read_json(BASE / "graph.json")
        # Test a prepared fixture regardless of the live project checkpoint.
        self.g["execution_state"] = "awaiting_start"
        for node in self.g["nodes"]:
            node["status"] = "planned"
            node.pop("blocker", None)
        self.now = datetime(2026, 9, 11, 20, tzinfo=timezone.utc)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name) / "execution"
        self.base.mkdir()
        self.files = [{"path": "app.js", "sha256": "a" * 64}]
        self.fingerprint = hashlib.sha256(json.dumps(self.files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def node(self, ident):
        return next(n for n in self.g["nodes"] if n["id"] == ident)

    def artifact(self, name, content):
        path = self.base / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return {"path": name, "sha256": graph.sha(path)}

    def record(self, ident):
        n = self.node(ident)
        prefix = f"evidence/{ident}"
        inv = self.artifact(prefix + "/source.json", json.dumps({"files": self.files, "fingerprint": self.fingerprint}))
        log = self.artifact(prefix + "/result.txt", "Fixture only; not real product acceptance.\n")
        record = {
            "task_id": ident, "outcome": "pass", "recorded_at": self.now.isoformat(),
            "source_fingerprint": self.fingerprint, "source_inventory": inv["path"],
            "artifacts": [inv, log],
            "criteria": [{"id": a["id"], "result": "pass", "summary": "test fixture", "artifacts": [log["path"]]} for a in n["acceptance"]],
            "review": {"kind": "self-review", "reviewer": "unit test fixture", "summary": "fixture only", "artifacts": [log["path"]]},
        }
        self.save(ident, record)
        return record

    def save(self, ident, record):
        path = self.base / self.node(ident)["evidence"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record))

    def verify(self, ident):
        graph.verify_evidence(self.node(ident), self.g, self.base, self.fingerprint, self.now)

    def test_prepared_graph_and_rendered_plans_validate(self):
        graph.render(self.g, self.base)
        self.assertEqual(graph.validate(self.g, self.base), [])
        self.assertEqual([n["id"] for n in graph.available(self.g)], ["P01"])

    def parallel_fixture(self, count=2):
        self.g["execution_state"] = "running"
        nodes = self.g["nodes"][:count]
        for index, n in enumerate(nodes):
            n.update(status="active", completion_requires=n["depends_on"], depends_on=[],
                     execution_lane=f"lane-{index}", write_paths=[f"fixture/lane-{index}"])
        return nodes

    def test_parallel_disjoint_lanes_allowed(self):
        self.parallel_fixture(3)
        self.assertEqual(graph.graph_errors(self.g), [])

    def test_parallel_four_packages_rejected(self):
        self.parallel_fixture(4)
        self.assertTrue(any("three-package" in e for e in graph.graph_errors(self.g)))

    def test_parallel_requires_explicit_ownership_and_distinct_lanes(self):
        a, b = self.parallel_fixture()
        b["execution_lane"] = a["execution_lane"]
        del b["write_paths"]
        errors = graph.graph_errors(self.g)
        self.assertTrue(any("distinct execution_lane" in e for e in errors))
        self.assertTrue(any("write_paths required" in e for e in errors))

    def test_parallel_parent_child_write_overlap_rejected(self):
        a, b = self.parallel_fixture()
        a["write_paths"] = ["fixture/shared"]
        b["write_paths"] = ["fixture/shared/subdir/file.py"]
        self.assertTrue(any("overlap" in e for e in graph.graph_errors(self.g)))
        b["write_paths"] = ["fixture/shared-other"]
        self.assertEqual(graph.graph_errors(self.g), [])

    def test_write_paths_reject_escape_and_globs(self):
        for path in ("../escape", "/absolute", "scripts/*.mjs"):
            with self.subTest(path=path):
                self.node("P01")["write_paths"] = [path]
                self.assertTrue(graph.graph_errors(self.g))

    def test_legacy_single_active_allowed(self):
        self.g["execution_state"] = "running"
        n = self.node("P01")
        n["status"] = "active"
        n.pop("execution_lane", None)
        n.pop("write_paths", None)
        self.assertEqual(graph.graph_errors(self.g), [])

    def test_completion_edges_allow_start_but_prevent_completion(self):
        self.g["execution_state"] = "running"
        n = self.node("P02")
        n["depends_on"] = []
        n["completion_requires"] = ["P01"]
        self.assertIn(n, graph.available(self.g))
        n["status"] = "active"
        self.assertEqual(graph.graph_errors(self.g), [])
        n["status"] = "done"
        self.assertTrue(any("completion_requires prerequisite P01" in e for e in graph.graph_errors(self.g)))

    def test_completion_edges_detect_cycle(self):
        self.node("P01")["completion_requires"] = ["P02"]
        self.assertTrue(any("cycle" in e for e in graph.graph_errors(self.g)))

    def test_completion_edges_retain_terminal_ancestry(self):
        terminal = self.node("R04")
        terminal["depends_on"].remove("O02")
        terminal["completion_requires"] = ["O02"]
        self.assertEqual(graph.graph_errors(self.g), [])
        self.assertIn("Required before completion: O02", graph.render_task(terminal))

    def test_operations_start_independent_of_model_but_review_completion_is_gated(self):
        self.g["execution_state"] = "running"
        # Mark start ancestors complete; leave moderation explicitly blocked.
        def complete_start(ident):
            for dep in self.node(ident)["depends_on"]:
                complete_start(dep)
                self.node(dep)["status"] = "done"
        complete_start("O01")
        complete_start("R01")
        self.node("M03")["status"] = "blocked"
        self.node("M03")["blocker"] = dict(reason="Accuracy", evidence="fixture", unblock="Qualified model", next_action="Review candidate")
        self.assertIn(self.node("O01"), graph.available(self.g))
        self.assertIn(self.node("R01"), graph.available(self.g))
        self.node("R01")["status"] = "active"
        self.assertEqual(graph.graph_errors(self.g), [])
        self.node("R01")["status"] = "done"
        self.assertTrue(any("R01: completion_requires prerequisite M03" in e for e in graph.graph_errors(self.g)))

    def test_malformed_completion_edges_rejected_without_crash(self):
        for value in ("P01", ["P01", "P01"], [{}]):
            self.node("P02")["completion_requires"] = value
            self.assertTrue(any("malformed/duplicate" in e for e in graph.graph_errors(self.g)))

    def test_investigation_budget_requires_reassessment_and_keeps_candidates_visible(self):
        self.g["execution_state"] = "running"
        self.node("P01")["status"] = "done"
        self.node("P02")["status"] = "done"
        n = self.node("M01")
        n["status"] = "active"
        n["investigation"] = {"hypothesis": "Fixture hypothesis", "attempts": 2,
                              "max_attempts": 2, "next_action": "Review evidence before another run"}
        output = graph.next_steps(self.g)
        self.assertIn("REASSESS M01", output)
        self.assertNotIn("NEXT M01", output)
        self.assertIn("Independent internal candidates", output)
        self.assertIn("READY", output)

    def test_malformed_investigation_rejected(self):
        valid = {"hypothesis": "hypothesis", "attempts": 0, "max_attempts": 2, "next_action": "inspect"}
        for key, value in (("hypothesis", ""), ("attempts", True), ("attempts", -1),
                           ("max_attempts", 0), ("next_action", None)):
            with self.subTest(key=key, value=value):
                self.node("P01")["investigation"] = dict(valid, **{key: value})
                self.assertTrue(any("malformed investigation" in e for e in graph.graph_errors(self.g)))

    def test_render_status_replaces_stale_text_with_current_checkpoint(self):
        self.g["execution_state"] = "running"
        self.node("P01")["status"] = "active"
        self.node("P01")["checkpoint"] = "Current fixture observation"
        (self.base / "status.md").write_text("Stale activity")
        graph.render(self.g, self.base)
        status = (self.base / "status.md").read_text()
        self.assertIn("Current fixture observation", status)
        self.assertNotIn("Stale activity", status)

    def test_risk_priority_selects_shell_boundary_after_toolchain(self):
        self.node("P01")["status"] = self.node("P02")["status"] = "done"
        self.assertEqual(graph.available(self.g)[0]["id"], "M01")

    def test_missing_dependency_rejected(self):
        self.node("P01")["depends_on"] = ["Z99"]
        self.assertTrue(any("missing/self" in e for e in graph.graph_errors(self.g)))

    def test_cycle_rejected(self):
        self.node("P01")["depends_on"] = ["P02"]
        self.assertTrue(any("cycle" in e for e in graph.graph_errors(self.g)))

    def test_disconnected_release_work_rejected(self):
        self.node("R04")["depends_on"].remove("O02")
        self.assertTrue(any("disconnected" in e for e in graph.graph_errors(self.g)))

    def test_removing_external_audit_gate_rejected(self):
        self.g["nodes"].remove(self.node("X02"))
        self.node("R04")["depends_on"].remove("X02")
        self.assertTrue(any("mandatory" in e for e in graph.graph_errors(self.g)))

    def test_disabling_current_source_binding_rejected(self):
        self.node("T06")["evidence_mode"] = "historical"
        self.assertTrue(any("current application" in e for e in graph.graph_errors(self.g)))

    def test_unfinished_dependency_rejected_for_done_task(self):
        self.g["execution_state"] = "running"
        self.node("P02")["status"] = "done"
        self.assertTrue(any("prerequisite P01" in e for e in graph.graph_errors(self.g)))

    def test_done_without_evidence_rejected(self):
        self.g["execution_state"] = "running"
        self.node("P01")["status"] = "done"
        errors = graph.validate(self.g, self.base, self.fingerprint, self.now, check_plans=False)
        self.assertTrue(any("P01" in e for e in errors))

    def test_complete_state_with_unfinished_work_rejected(self):
        self.g["execution_state"] = "complete"
        self.assertTrue(any("unfinished tasks" in e for e in graph.graph_errors(self.g)))

    def test_incomplete_blocker_rejected(self):
        self.g["execution_state"] = "running"
        self.node("P01")["status"] = "blocked"
        self.node("P01")["blocker"] = {"reason": "missing input"}
        self.assertTrue(any("blocker" in e for e in graph.graph_errors(self.g)))

    def test_valid_fixture_evidence_accepted(self):
        self.record("P01")
        self.verify("P01")

    def test_missing_acceptance_result_rejected(self):
        r = self.record("P01")
        r["criteria"].pop()
        self.save("P01", r)
        with self.assertRaisesRegex(ValueError, "each acceptance"):
            self.verify("P01")

    def test_duplicate_acceptance_result_rejected(self):
        r = self.record("P01")
        r["criteria"].append(r["criteria"][0])
        self.save("P01", r)
        with self.assertRaisesRegex(ValueError, "each acceptance"):
            self.verify("P01")

    def test_tampered_artifact_rejected(self):
        self.record("P01")
        (self.base / "evidence/P01/result.txt").write_text("changed")
        with self.assertRaisesRegex(ValueError, "changed artifact"):
            self.verify("P01")

    def test_path_escape_rejected(self):
        with self.assertRaisesRegex(ValueError, "escapes"):
            graph.confined(self.base, "../private-file")

    def test_forged_source_inventory_digest_rejected(self):
        r = self.record("P01")
        r["source_fingerprint"] = "b" * 64
        self.save("P01", r)
        with self.assertRaisesRegex(ValueError, "inventory does not match"):
            self.verify("P01")

    def test_current_gate_rejects_changed_application(self):
        r = self.record("T06")
        r["source_fingerprint"] = "b" * 64
        self.save("T06", r)
        with self.assertRaisesRegex(ValueError, "stale"):
            self.verify("T06")

    def test_independent_audit_cannot_be_self_review(self):
        self.record("X02")
        with self.assertRaisesRegex(ValueError, "independent review"):
            self.verify("X02")

    def test_operator_acceptance_cannot_be_self_review(self):
        self.record("O02")
        with self.assertRaisesRegex(ValueError, "operator acceptance"):
            self.verify("O02")

    def test_expired_network_evidence_rejected(self):
        r = self.record("X03")
        r["recorded_at"] = (self.now - timedelta(days=8)).isoformat()
        self.save("X03", r)
        with self.assertRaisesRegex(ValueError, "older than seven"):
            self.verify("X03")

    def test_short_soak_rejected(self):
        r = self.record("T06")
        r["soak"] = {"started_at": (self.now-timedelta(hours=335)).isoformat(), "ended_at": self.now.isoformat(), "coverage_artifact": "evidence/T06/result.txt"}
        self.save("T06", r)
        with self.assertRaisesRegex(ValueError, "336"):
            self.verify("T06")

    def test_future_soak_end_rejected(self):
        r = self.record("T06")
        r["soak"] = {"started_at": (self.now-timedelta(days=15)).isoformat(), "ended_at": (self.now+timedelta(hours=1)).isoformat(), "coverage_artifact": "evidence/T06/result.txt"}
        self.save("T06", r)
        with self.assertRaisesRegex(ValueError, "336"):
            self.verify("T06")

    def test_14_day_soak_fixture_accepted(self):
        r = self.record("T06")
        r["soak"] = {"started_at": (self.now-timedelta(days=14)).isoformat(), "ended_at": self.now.isoformat(), "coverage_artifact": "evidence/T06/result.txt"}
        self.save("T06", r)
        self.verify("T06")

    def test_final_gate_cannot_omit_release_manifest(self):
        self.record("T05")
        with self.assertRaisesRegex(ValueError, "must hash release manifest"):
            self.verify("T05")

    def test_final_matrix_cannot_omit_historical_checks(self):
        self.artifact("release/acceptance-matrix.json", json.dumps({"source_fingerprint": self.fingerprint, "criteria": []}))
        with self.assertRaisesRegex(ValueError, "every historical"):
            graph.verify_release(self.g, self.base, self.fingerprint)

    def complete_fixture(self):
        """Create a fully synthetic release solely in the auto-deleted test directory."""
        log = self.artifact("evidence/final-fixture.txt", "Synthetic acceptance fixture, not application test evidence.")
        historical = [n for n in self.g["nodes"] if n["kind"] == "internal" and n["evidence_mode"] == "historical"]
        matrix = {"source_fingerprint": self.fingerprint,
                  "criteria": [{"id": a["id"], "result": "pass", "summary": "fixture", "artifacts": [log]}
                               for n in historical for a in n["acceptance"]],
                  "requirements": [{"id": req, "criteria": [a["id"] for n in historical if req in n["requirements"] for a in n["acceptance"]]}
                                   for req in self.g["requirements"]]}
        matrix_art = self.artifact("release/acceptance-matrix.json", json.dumps(matrix))
        artifacts = []
        for category in ["l1_contract", "l2_contract", "verification_keys", "frontend", "sdk_workers", "proving_assets", "operations"]:
            path = self.base.parent / (category + ".fixture")
            path.write_text("Synthetic " + category)
            artifacts.append({"path": path.name, "sha256": graph.sha(path), "category": category})
        manifest = {"source_fingerprint": self.fingerprint, "toolchain": {"fixture": True},
                    "build_inputs": {"fixture": True}, "target_network": {"fixture": True}, "artifacts": artifacts}
        manifest_art = self.artifact("release/manifest.json", json.dumps(manifest))
        for n in self.g["nodes"]:
            r = self.record(n["id"])
            if n["id"] in {"T05", "R04"}:
                r["artifacts"].extend([matrix_art, manifest_art])
            if n["id"] in {"X01", "X02"}:
                r["review"]["kind"] = "independent"
            if n["id"] == "O02":
                r["review"]["kind"] = "operator"
            if n["id"] == "T06":
                r["soak"] = {"started_at": (self.now-timedelta(days=14)).isoformat(), "ended_at": self.now.isoformat(), "coverage_artifact": "evidence/T06/result.txt"}
            self.save(n["id"], r)
            n["status"] = "done"
        self.g["execution_state"] = "complete"

    def test_complete_synthetic_release_can_pass_all_gates(self):
        self.complete_fixture()
        self.assertEqual(graph.validate(self.g, self.base, self.fingerprint, self.now, check_plans=False), [])

    def test_changed_distributable_invalidates_complete_release(self):
        self.complete_fixture()
        (self.base.parent / "frontend.fixture").write_text("Changed after acceptance")
        errors = graph.validate(self.g, self.base, self.fingerprint, self.now, check_plans=False)
        self.assertTrue(any("changed artifact: frontend.fixture" in e for e in errors))

    def test_missing_requirement_trace_rejected(self):
        self.complete_fixture()
        path = self.base / "release/acceptance-matrix.json"
        matrix = graph.read_json(path)
        matrix["requirements"].pop()
        path.write_text(json.dumps(matrix))
        with self.assertRaisesRegex(ValueError, "each production requirement"):
            graph.verify_release(self.g, self.base, self.fingerprint)


if __name__ == "__main__":
    unittest.main()

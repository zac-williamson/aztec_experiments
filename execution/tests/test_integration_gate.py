import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "integration_gate.py"
spec = importlib.util.spec_from_file_location("integration_gate", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class IntegrationGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Disposable Gate Test")
        self.git("config", "user.email", "gate@example.invalid")
        (self.repo / "app.txt").write_text("baseline\n")
        self.git("add", ".")
        self.git("commit", "-qm", "baseline")
        self.base = self.git("rev-parse", "HEAD")
        self.git("branch", "integration")
        self.git("checkout", "-qb", "worker")
        (self.repo / "app.txt").write_text("candidate\n")
        self.git("commit", "-qam", "candidate")
        self.candidate = self.git("rev-parse", "HEAD")
        self.ref = "refs/heads/integration"
        self.artifact = self.root / "observed.log"
        self.artifact.write_text("Disposable gate-control fixture; not application acceptance.\n")
        artifact = {"path": "observed.log", "sha256": gate.digest(self.artifact)}
        common = {"candidate": self.candidate, "base": self.base, "artifacts": [artifact]}
        self.policy = {
            "task_id": "G01", "implementer": "worker-session", "candidate": self.candidate,
            "base": self.base, "integration_ref": self.ref, "allowed_paths": ["app.txt"],
            "required_checks": ["unit"], "requirements": ["REQ11"], "holds": [],
            "ownership": [{"task_id": "G01", "owner": "worker-session", "paths": ["app.txt"]}],
        }
        self.evidence = {
            "candidate": self.candidate, "base": self.base, "task_id": "G01", "holds": [], "findings": [],
            "checks": [{**common, "id": "unit", "status": "pass", "exit_code": 0,
                        "command": "disposable control", "environment": "temporary git repo", "observed": "pass"}],
            "review": {**common, "verdict": "approve", "kind": "independent", "reviewer": "review-session", "implementer": "worker-session"},
            "acceptance": [{**common, "id": "REQ11", "status": "pass"}],
        }

    def git(self, *args):
        return gate.git(self.repo, *args).strip()

    def run_gate(self, mode="integrate"):
        policy_path = self.root / "policy.json"
        evidence_path = self.root / "evidence.json"
        policy_path.write_text(json.dumps(self.policy))
        evidence_path.write_text(json.dumps(self.evidence))
        result = subprocess.run([
            "python3", str(SCRIPT), mode, "--repo", str(self.repo), "--policy", str(policy_path),
            "--policy-sha256", gate.digest(policy_path), "--evidence", str(evidence_path),
            "--evidence-root", str(self.root),
        ], capture_output=True, text=True)
        self.assertNotIn("Traceback", result.stderr)
        return result.returncode, json.loads(result.stdout)

    def blocked(self, reason):
        code, result = self.run_gate()
        self.assertEqual(code, 1, result)
        self.assertIn(reason, result["reason"])
        self.assertEqual(self.git("rev-parse", self.ref), self.base)

    def test_passing_check_then_atomic_integration(self):
        self.assertEqual(self.run_gate("check")[0], 0)
        self.assertEqual(self.git("rev-parse", self.ref), self.base)
        self.assertEqual(self.run_gate()[0], 0)
        self.assertEqual(self.git("rev-parse", self.ref), self.candidate)
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_actual_deliberate_test_failure_prevents_integration(self):
        failed = subprocess.run(["python3", "-c", "assert False, 'deliberate gate drill'"], capture_output=True, text=True)
        self.assertNotEqual(failed.returncode, 0)
        self.artifact.write_text(failed.stderr)
        check = self.evidence["checks"][0]
        check.update(status="fail", exit_code=failed.returncode)
        self.blocked("check unit status: fail")

    def test_missing_review_prevents_integration(self):
        del self.evidence["review"]
        self.blocked("missing/invalid review")

    def test_check_states_are_not_passing(self):
        for status in ("pending", "skipped", "unreadable", "fail", None):
            with self.subTest(status=status):
                self.evidence["checks"][0]["status"] = status
                self.blocked("check unit status:")

    def test_missing_check_is_distinct(self):
        self.evidence["checks"] = []
        self.blocked("missing check: unit")

    def test_stale_source_or_base_fails_every_evidence_kind(self):
        original = copy.deepcopy(self.evidence)
        for kind in ("checks", "review", "acceptance"):
            for field in ("candidate", "base"):
                with self.subTest(kind=kind, field=field):
                    self.evidence = copy.deepcopy(original)
                    record = self.evidence[kind] if kind == "review" else self.evidence[kind][0]
                    record[field] = "0" * 40
                    self.blocked("stale")

    def test_self_review_is_rejected(self):
        self.evidence["review"]["reviewer"] = "worker-session"
        self.blocked("not independent")

    def test_artifact_tampering_is_rejected(self):
        self.artifact.write_text("changed after measurement")
        self.blocked("hash mismatch")

    def test_unreadable_artifact_is_distinct(self):
        self.artifact.unlink()
        self.blocked("unreadable check unit artifact")

    def test_escaping_evidence_is_rejected(self):
        self.evidence["checks"][0]["artifacts"][0]["path"] = "../private.txt"
        self.blocked("unsafe relative path")

    def test_out_of_scope_change_is_rejected(self):
        (self.repo / "outside.txt").write_text("not assigned")
        self.git("add", "outside.txt")
        self.git("commit", "-qm", "outside scope")
        self.policy["candidate"] = self.git("rev-parse", "HEAD")
        self.blocked("out-of-scope change: outside.txt")

    def test_rename_outside_scope_is_rejected(self):
        self.git("mv", "app.txt", "outside.txt")
        self.git("commit", "-qm", "rename outside scope")
        self.policy["candidate"] = self.git("rev-parse", "HEAD")
        self.blocked("out-of-scope change: outside.txt")

    def test_missing_acceptance_is_rejected(self):
        self.evidence["acceptance"] = []
        self.blocked("missing acceptance: REQ11")

    def test_hold_and_blocking_finding_are_rejected(self):
        self.policy["holds"] = ["release hold"]
        self.blocked("policy holds")
        self.policy["holds"] = []
        self.evidence["findings"] = [{"blocking": True, "status": "open"}]
        self.blocked("unresolved blocking finding")

    def test_conflicting_owner_or_task_is_rejected(self):
        self.policy["ownership"].append({"task_id": "G02", "owner": "worker-two", "paths": ["app.txt"]})
        self.blocked("ownership conflict")

    def test_missing_ownership_is_rejected(self):
        self.policy["ownership"] = []
        self.blocked("missing task ownership claim")

    def test_checked_out_target_ref_is_rejected(self):
        self.git("checkout", "-q", "integration")
        self.blocked("integration branch is checked out")

    def test_atomic_compare_and_swap_rejects_racing_writer(self):
        candidate, base, ref = gate.validate(self.repo, self.policy, self.evidence, self.root)
        self.git("update-ref", ref, candidate, base)
        with self.assertRaisesRegex(gate.GateError, "git operation failed"):
            gate.advance(self.repo, candidate, base, ref)
        self.assertEqual(self.git("rev-parse", ref), candidate)

    def test_policy_digest_mismatch_fails_closed(self):
        policy_path = self.root / "policy.json"
        policy_path.write_text(json.dumps(self.policy))
        code = gate.main(["integrate", "--repo", str(self.repo), "--policy", str(policy_path),
                          "--policy-sha256", "0" * 64, "--evidence", "unused", "--evidence-root", str(self.root)])
        self.assertEqual(code, 1)
        self.assertEqual(self.git("rev-parse", self.ref), self.base)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from chains import ChainExhaustedError, ChainProvider, build_distill_prompt, strip_code_fence, unquote
from distill_engine import run_distill, write_json_atomic
from gates import groundedness_gate
from providers import MockProvider
from worker import canonical_study_date, drain_once, enqueue_pending


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def seed_root(root: Path) -> None:
    write_json_atomic(
        root / "sessions" / "2026-06-09.json",
        {
            "date": "2026-06-09",
            "theme": "work",
            "best3": [],
            "weakMisses": [
                {
                    "ko": "막혔어",
                    "tried": "I blocked",
                    "correct": "I was stuck.",
                    "note": "work status",
                }
            ],
            "summary": "short practice",
            "savedAt": "2026-06-09T10:00:00Z",
        },
    )
    write_json_atomic(
        root / "weak-notes.json",
        {
            "updatedAt": "2026-06-09T10:00:00Z",
            "count": 2,
            "notes": [
                {
                    "ko": "막혔어",
                    "tried": "I blocked",
                    "correct": "I was stuck.",
                    "missCount": 2,
                    "lastSeen": "2026-06-09",
                    "note": "work status",
                    "firstSeen": "2026-06-08",
                    "sessions": ["2026-06-09", "2026-06-08"],
                },
                {
                    "ko": "늦었어",
                    "expression": "I am running late.",
                    "missCount": 1,
                    "lastSeen": "2026-06-08",
                    "sessions": ["2026-06-08"],
                },
            ],
        },
    )
    write_json_atomic(root / "best3.json", {"updatedAt": "2026-06-09T10:00:00Z", "entries": []})
    write_json_atomic(
        root / "profile" / "learner-profile.json",
        {
            "weak_patterns": [
                {
                    "expression": "I was stuck.",
                    "evidence_sessions": ["2026-06-09"],
                    "severity": "medium",
                }
            ],
            "strengths": ["keeps trying"],
            "progress": "baseline",
        },
    )


class MonaDistillTests(unittest.TestCase):
    def test_happy_path_writes_profile_and_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            seed_root(root)
            result = run_distill(root, {"date": "2026-06-09", "mode": "interrupt"}, MockProvider("valid"))
            self.assertTrue(result["ok"])
            profile = read_json(root / "profile" / "learner-profile.json")
            self.assertEqual(profile["weak_patterns"][0]["expression"], "I was stuck.")
            versions = list((root / "profile" / "_versions").glob("learner-profile.*.json"))
            self.assertEqual(len(versions), 1)

    def test_forced_failures_preserve_previous_and_write_alert(self) -> None:
        for mode in ["malformed", "fabricated", "drastic"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                seed_root(root)
                before = read_json(root / "profile" / "learner-profile.json")
                result = run_distill(root, {"date": "2026-06-09", "mode": "interrupt"}, MockProvider(mode))
                after = read_json(root / "profile" / "learner-profile.json")
                self.assertFalse(result["ok"])
                self.assertEqual(before, after)
                self.assertTrue((root / "_queue" / "last_error.json").exists())

    def test_debounce_latest_wins_pending_job(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            enqueue_pending(root, "2026-06-08")
            enqueue_pending(root, "2026-06-09")
            enqueue_pending(root, "2026-06-10")
            pending_files = list((root / "_queue").glob("pending.json"))
            self.assertEqual(len(pending_files), 1)
            self.assertEqual(read_json(pending_files[0])["date"], "2026-06-10")

    def test_groundedness_new_and_legacy_weak_schema(self) -> None:
        weak_notes = [
            {
                "ko": "막혔어",
                "tried": "I blocked",
                "correct": "I was stuck.",
                "sessions": ["2026-06-09"],
            },
            {
                "ko": "늦었어",
                "expression": "I am running late.",
                "sessions": ["2026-06-08"],
            },
        ]
        profile = {
            "weak_patterns": [
                {
                    "expression": "I was stuck.",
                    "evidence_sessions": ["2026-06-09"],
                    "severity": "medium",
                },
                {
                    "expression": "I am running late.",
                    "evidence_sessions": ["2026-06-08"],
                    "severity": "low",
                },
            ],
            "strengths": [],
            "progress": "",
        }
        self.assertTrue(groundedness_gate(profile, weak_notes).ok)


class ChainProviderTests(unittest.TestCase):
    PAYLOAD = {
        "weak_notes": [{"ko": "막혔어", "tried": "I blocked", "correct": "I was stuck.", "sessions": ["2026-06-09"]}],
        "sessions": [],
        "best3": {},
        "previous_profile": None,
        "job": {"date": "2026-06-09", "mode": "interrupt"},
    }

    def test_falls_back_to_next_adapter(self) -> None:
        def broken(system: str, prompt: str) -> str:
            raise RuntimeError("boom")

        def valid(system: str, prompt: str) -> str:
            return '{"learner-profile": {"weak_patterns": [], "strengths": [], "progress": ""}}'

        provider = ChainProvider([("broken", broken), ("valid", valid)])
        result = provider.call(self.PAYLOAD)
        self.assertIn("learner-profile", result)

    def test_exhausted_chain_raises(self) -> None:
        def broken(system: str, prompt: str) -> str:
            raise RuntimeError("boom")

        provider = ChainProvider([("a", broken), ("b", broken)])
        with self.assertRaises(ChainExhaustedError):
            provider.call(self.PAYLOAD)

    def test_prompt_grounds_on_inputs_and_forbids_fabrication(self) -> None:
        system, prompt = build_distill_prompt(self.PAYLOAD)
        self.assertIn("JSON", system)
        self.assertIn("I was stuck.", prompt)
        self.assertIn("창작 절대 금지", prompt)
        self.assertIn("weak_patterns", prompt)

    def test_strip_code_fence(self) -> None:
        fenced = "```json\n{\"a\": 1}\n```"
        self.assertEqual(strip_code_fence(fenced), '{"a": 1}')
        self.assertEqual(strip_code_fence('{"a": 1}'), '{"a": 1}')

    def test_unquote_handles_single_and_double_quotes(self) -> None:
        self.assertEqual(unquote(' "secret" '), "secret")
        self.assertEqual(unquote(" 'secret' "), "secret")
        self.assertEqual(unquote("secret"), "secret")

    def test_nightly_job_reaches_provider(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            seed_root(root)
            enqueue_pending(root, "2026-06-09", mode="nightly")
            result = drain_once(root, provider_mode="valid", provider_kind="mock")
            self.assertTrue(result["ok"], result)
            self.assertTrue(result["drained"])

    def test_nightly_writes_curriculum_interrupt_does_not(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            seed_root(root)
            run_distill(root, {"date": "2026-06-09", "mode": "interrupt"}, MockProvider("valid"))
            self.assertFalse((root / "curriculum-live.json").exists())
            result = run_distill(root, {"date": "2026-06-09", "mode": "nightly"}, MockProvider("valid"))
            self.assertTrue(result["ok"], result)
            curriculum = read_json(root / "curriculum-live.json")
            self.assertTrue(curriculum["next_focus"])

    def test_canonical_study_date_cutoff(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        seoul = ZoneInfo("Asia/Seoul")
        self.assertEqual(canonical_study_date(datetime(2026, 6, 10, 3, 59, tzinfo=seoul)), "2026-06-09")
        self.assertEqual(canonical_study_date(datetime(2026, 6, 10, 4, 0, tzinfo=seoul)), "2026-06-10")


if __name__ == "__main__":
    unittest.main()

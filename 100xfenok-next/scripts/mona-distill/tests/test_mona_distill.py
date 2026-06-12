from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from chains import ChainExhaustedError, ChainProvider, build_distill_prompt, strip_code_fence, unquote
from distill_engine import run_distill, write_json_atomic
from gates import (
    groundedness_gate,
    validate_coverage_lane,
    validate_distillate_records,
    validate_enriched_entry,
    validate_enriched_bank,
)
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

    def test_bank_gate_filters_and_dedupes(self) -> None:
        from bank_refresh import gate_entry, parse_entries

        seen: set[str] = set()
        ok = gate_entry({"ko": "막혔어", "en": "I was stuck.", "theme": "selftalk-emotion", "register": "casual"}, "vid1", seen)
        self.assertIsNotNone(ok)
        self.assertIsNone(gate_entry({"ko": "막혔어", "en": "I WAS  stuck.", "theme": "free"}, "vid1", seen))  # dedupe
        self.assertIsNone(gate_entry({"ko": "no hangul", "en": "I was late.", "theme": "free"}, "vid1", seen))
        self.assertIsNone(gate_entry({"ko": "긴 문장", "en": "one two three four five six seven eight nine ten eleven twelve thirteen", "theme": "free"}, "vid1", seen))
        bad_theme = gate_entry({"ko": "연락할게", "en": "I'll be in touch.", "theme": "weird"}, "vid1", seen)
        self.assertEqual(bad_theme["theme"], "free")
        entries = parse_entries('```json\n[{"ko":"늦었어","en":"I am running late.","theme":"free"}]\n```', "vid2", seen)
        self.assertEqual(len(entries), 1)
        self.assertEqual(parse_entries("not json", "vid3", seen), [])

    def test_enriched_validator_rejects_identity_or_over_cap_sibling(self) -> None:
        base = {
            "ko": "그 사람 역할을 대신해",
            "en": "Fill their shoes.",
            "note": None,
            "theme": "work-advanced",
            "register": "casual",
            "source_id": "vid1",
            "difficulty": 3,
            "word_count": 3,
            "pattern": "Fill their shoes",
            "variations": [
                {"kind": "question", "ko": "그 사람 역할을 대신해?", "en": "Can I fill their shoes?"},
                {"kind": "past", "ko": "그 사람 역할을 대신했어", "en": "I filled their shoes."},
            ],
            "sibling": {"ko": "그 사람 역할을 대신해", "en": "Fill their shoes."},
            "enrichedAt": "2026-06-13T00:00:00Z",
            "enrichVersion": 1,
        }
        identity = validate_enriched_entry(base)
        self.assertFalse(identity.ok)
        self.assertIn("must differ", identity.reason)

        longer_but_capped = dict(base)
        longer_but_capped["sibling"] = {"ko": "그 사람만큼 일을 잘해", "en": "Do the job as well as they did."}
        capped_result = validate_enriched_entry(longer_but_capped)
        self.assertTrue(capped_result.ok, capped_result.reason)

        over_cap = dict(base)
        over_cap["sibling"] = {"ko": "그 사람만큼 어려운 일을 잘해", "en": "I can do this difficult job as well as them."}
        over_cap_result = validate_enriched_entry(over_cap)
        self.assertFalse(over_cap_result.ok)
        self.assertIn("8 words", over_cap_result.reason)

    def test_w1_enrich_adds_fields_without_mutating_original_six(self) -> None:
        from enrich import run

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original = {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": [
                    {
                        "ko": "막혔어",
                        "en": "I was stuck.",
                        "note": None,
                        "theme": "selftalk-emotion",
                        "register": "casual",
                        "source_id": "vid1",
                    }
                ],
            }
            write_json_atomic(root / "expression-bank.json", original)
            transcripts = root / "raw" / "transcripts"
            transcripts.mkdir(parents=True)
            (transcripts / "vid1.txt").write_text("막혔을 때 I was stuck 라고 말해요.", encoding="utf-8")

            def provider(source_id, entries, transcript, grounded):
                return json.dumps([
                    {
                        "en": "I was stuck.",
                        "difficulty": 1,
                        "pattern": "I was ~",
                        "variations": [
                            {"kind": "question", "ko": "막혔어?", "en": "Was I stuck?"},
                            {"kind": "subject", "ko": "너는 막혔어.", "en": "You were stuck."},
                        ],
                        "sibling": None,
                    }
                ])

            report = run(root, transcript_dir=transcripts, provider=provider, write_staging=True)
            self.assertTrue(report["written"])
            staged = read_json(root / "expression-bank.staging.json")
            gate = validate_enriched_bank(original, staged)
            self.assertTrue(gate.ok, gate.reason)
            self.assertEqual(read_json(root / "expression-bank.json"), original)

    def test_w1_missing_enrichment_leaves_entry_byte_identical(self) -> None:
        from enrich import run

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original_entry = {
                "ko": "막혔어",
                "en": "I was stuck.",
                "note": None,
                "theme": "selftalk-emotion",
                "register": "casual",
                "source_id": "vid1",
            }
            write_json_atomic(root / "expression-bank.json", {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": [original_entry],
            })
            transcripts = root / "raw" / "transcripts"
            transcripts.mkdir(parents=True)
            (transcripts / "vid1.txt").write_text("막혔을 때 I was stuck 라고 말해요.", encoding="utf-8")

            def provider(source_id, entries, transcript, grounded):
                return "[]"

            report = run(root, transcript_dir=transcripts, provider=provider, write_staging=True)
            self.assertEqual(report["entries_enriched"], 0)
            self.assertEqual(report["missing_enrichment_by_source"], {"vid1": 1})
            staged = read_json(root / "expression-bank.staging.json")
            self.assertEqual(staged["entries"][0], original_entry)
            self.assertNotIn("enrichVersion", staged["entries"][0])

    def test_w1_missing_grounded_entry_gets_one_ungrounded_retry(self) -> None:
        from enrich import run

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_json_atomic(root / "expression-bank.json", {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": [
                    {
                        "ko": "어쩔 수 없지",
                        "en": "Better late than never.",
                        "note": None,
                        "theme": "free",
                        "register": "casual",
                        "source_id": "vid1",
                    }
                ],
            })
            transcripts = root / "raw" / "transcripts"
            transcripts.mkdir(parents=True)
            (transcripts / "vid1.txt").write_text("이 transcript에는 해당 영어 표현이 없습니다.", encoding="utf-8")
            calls: list[tuple[bool, int, str]] = []

            def provider(source_id, entries, transcript, grounded):
                calls.append((grounded, len(entries), transcript))
                if grounded:
                    return "[]"
                return json.dumps([
                    {
                        "en": "Better late than never.",
                        "difficulty": 3,
                        "pattern": "Better late ~",
                        "variations": [
                            {"kind": "question", "ko": "늦어도 괜찮을까?", "en": "Is it better late than never?"},
                            {"kind": "past", "ko": "늦어도 괜찮았어", "en": "It was better late than never."},
                        ],
                        "sibling": {"ko": "늦어도 하는 게 낫다", "en": "Doing it late is still good."},
                    }
                ])

            report = run(root, transcript_dir=transcripts, provider=provider, write_staging=True)
            self.assertEqual([(grounded, count) for grounded, count, _text in calls], [(True, 1), (False, 1)])
            self.assertEqual(calls[1][2], "")
            self.assertEqual(report["entries_enriched"], 1)
            self.assertEqual(report["ungrounded_retries"], 1)
            self.assertEqual(report["missing_enrichment_by_source"], {})
            staged = read_json(root / "expression-bank.staging.json")
            self.assertFalse(staged["entries"][0]["grounded"])

    def test_w1_invalid_utf8_transcript_does_not_abort_batch(self) -> None:
        from enrich import run

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_json_atomic(root / "expression-bank.json", {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": [
                    {
                        "ko": "첫 표현",
                        "en": "I was stuck.",
                        "note": None,
                        "theme": "selftalk-emotion",
                        "register": "casual",
                        "source_id": "bad",
                    },
                    {
                        "ko": "둘째 표현",
                        "en": "I am running late.",
                        "note": None,
                        "theme": "free",
                        "register": "casual",
                        "source_id": "good",
                    },
                ],
            })
            transcripts = root / "raw" / "transcripts"
            transcripts.mkdir(parents=True)
            (transcripts / "bad.txt").write_bytes(b"caf\xed remainder")
            (transcripts / "good.txt").write_text("늦었을 때 I am running late 라고 해요.", encoding="utf-8")
            seen_sources: list[str] = []

            def provider(source_id, entries, transcript, grounded):
                seen_sources.append(source_id)
                return json.dumps([
                    {
                        "en": entry["en"],
                        "difficulty": 1,
                        "pattern": "daily",
                        "variations": [
                            {"kind": "question", "ko": "질문", "en": f"{entry['en']}?"},
                            {"kind": "past", "ko": "과거", "en": entry["en"].replace("am", "was")},
                        ],
                        "sibling": None,
                    }
                    for entry in entries
                ])

            report = run(root, transcript_dir=transcripts, provider=provider, write_staging=True)
            self.assertEqual(seen_sources, ["bad", "good"])
            self.assertEqual(report["sources_scanned"], 2)
            self.assertEqual(report["entries_enriched"], 2)

    def test_w1_resume_prefers_staging_and_skips_already_enriched(self) -> None:
        from enrich import run

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            live_entries = [
                {
                    "ko": "막혔어",
                    "en": "I was stuck.",
                    "note": None,
                    "theme": "selftalk-emotion",
                    "register": "casual",
                    "source_id": "vid1",
                },
                {
                    "ko": "늦었어",
                    "en": "I am running late.",
                    "note": None,
                    "theme": "free",
                    "register": "casual",
                    "source_id": "vid2",
                },
            ]
            staged_entries = [
                dict(
                    live_entries[0],
                    difficulty=1,
                    word_count=3,
                    pattern="I was ~",
                    variations=[
                        {"kind": "question", "ko": "막혔어?", "en": "Was I stuck?"},
                        {"kind": "subject", "ko": "너는 막혔어.", "en": "You were stuck."},
                    ],
                    sibling=None,
                    enrichedAt="2026-06-13T00:00:00Z",
                    enrichVersion=1,
                ),
                live_entries[1],
            ]
            write_json_atomic(root / "expression-bank.json", {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": live_entries,
            })
            write_json_atomic(root / "expression-bank.staging.json", {
                "updatedAt": "2026-06-13T00:10:00Z",
                "source": "ppalmo-distill-v1",
                "entries": staged_entries,
            })
            transcripts = root / "raw" / "transcripts"
            transcripts.mkdir(parents=True)
            (transcripts / "vid1.txt").write_text("막혔을 때 I was stuck 라고 해요.", encoding="utf-8")
            (transcripts / "vid2.txt").write_text("늦었을 때 I am running late 라고 해요.", encoding="utf-8")
            seen_sources: list[str] = []

            def provider(source_id, entries, transcript, grounded):
                seen_sources.append(source_id)
                return json.dumps([
                    {
                        "en": "I am running late.",
                        "difficulty": 1,
                        "pattern": "I am ~",
                        "variations": [
                            {"kind": "question", "ko": "늦었어?", "en": "Am I running late?"},
                            {"kind": "subject", "ko": "너는 늦었어.", "en": "You are running late."},
                        ],
                        "sibling": None,
                    }
                ])

            report = run(root, transcript_dir=transcripts, provider=provider)
            self.assertEqual(seen_sources, ["vid2"])
            self.assertTrue(report["input"].endswith("expression-bank.staging.json"))
            self.assertEqual(report["sources_scanned"], 1)
            self.assertEqual(report["entries_enriched"], 1)

    def test_w2_full_distillate_coverage_and_jsonl(self) -> None:
        from bank_refresh import read_jsonl, run_full_distillate

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "vid1.txt").write_text("늦었을 때 I am running late 라고 해요.", encoding="utf-8")
            (transcripts / "vid2.txt").write_text("오늘은 표현이 별로 없어요.", encoding="utf-8")

            def provider(video_id, transcript):
                if video_id == "vid2":
                    return "[]"
                return json.dumps([
                    {
                        "ko": "늦었어",
                        "en": "I am running late.",
                        "note": None,
                        "theme": "free",
                        "register": "casual",
                        "difficulty": 1,
                        "pattern": "I am ~",
                        "variations": [
                            {"kind": "question", "ko": "늦었어?", "en": "Am I running late?"},
                            {"kind": "subject", "ko": "너는 늦었어.", "en": "You are running late."},
                        ],
                        "sibling": None,
                    }
                ])

            report = run_full_distillate(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(report["visited"], 2)
            coverage = read_json(root / "distillate" / "_coverage.json")
            gate = validate_coverage_lane(coverage, ["vid1", "vid2"], lane="expressions")
            self.assertTrue(gate.ok, gate.reason)
            records = read_jsonl(root / "distillate" / "expressions-full.jsonl")
            self.assertEqual(len(records), 1)
            gate = validate_distillate_records(records)
            self.assertTrue(gate.ok, gate.reason)

    def test_w2_full_distillate_zero_and_cli_default_limits_are_unlimited(self) -> None:
        import bank_refresh
        from bank_refresh import run_full_distillate

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            for video_id in ("vid1", "vid2", "vid3"):
                (transcripts / f"{video_id}.txt").write_text(f"{video_id} transcript", encoding="utf-8")

            seen_sources: list[str] = []

            def provider(video_id, transcript):
                seen_sources.append(video_id)
                return "[]"

            direct = run_full_distillate(root, transcript_dir=transcripts, provider=provider, limit=0)
            self.assertEqual(direct["visited"], 3)
            self.assertEqual(seen_sources, ["vid1", "vid2", "vid3"])

            output = io.StringIO()
            with patch.object(bank_refresh, "extract_enriched_from_transcript", return_value="[]"), redirect_stdout(output):
                code = bank_refresh.main(["--root", str(root), "--from-transcripts", str(transcripts), "--full-distillate"])
            self.assertEqual(code, 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["visited"], 3)

            output = io.StringIO()
            with patch.object(bank_refresh, "extract_enriched_from_transcript", return_value="[]"), redirect_stdout(output):
                code = bank_refresh.main([
                    "--root", str(root),
                    "--from-transcripts", str(transcripts),
                    "--full-distillate",
                    "--limit", "1",
                ])
            self.assertEqual(code, 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["visited"], 1)

    def test_w2_invalid_utf8_transcript_does_not_abort_lazy_walk(self) -> None:
        from bank_refresh import read_jsonl, run_full_distillate

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "bad.txt").write_bytes(b"caf\xed remainder")
            (transcripts / "good.txt").write_text("늦었을 때 I am running late 라고 해요.", encoding="utf-8")
            seen_sources: list[str] = []

            def provider(video_id, transcript):
                seen_sources.append(video_id)
                if video_id == "bad":
                    return "[]"
                return json.dumps([
                    {
                        "ko": "늦었어",
                        "en": "I am running late.",
                        "note": None,
                        "theme": "free",
                        "register": "casual",
                        "difficulty": 1,
                        "pattern": "I am ~",
                        "variations": [
                            {"kind": "question", "ko": "늦었어?", "en": "Am I running late?"},
                            {"kind": "subject", "ko": "너는 늦었어.", "en": "You are running late."},
                        ],
                        "sibling": None,
                    }
                ])

            report = run_full_distillate(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(seen_sources, ["bad", "good"])
            self.assertEqual(report["visited"], 2)
            self.assertEqual(report["zero_yield"], 1)
            self.assertEqual(report["extracted"], 1)
            records = read_jsonl(root / "distillate" / "expressions-full.jsonl")
            self.assertEqual(len(records), 1)

    def test_w2_invalid_enrichment_is_counted_and_error_lane_retries(self) -> None:
        from bank_refresh import read_jsonl, run_full_distillate

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "vid1.txt").write_text("재시도할 영상입니다.", encoding="utf-8")
            (transcripts / "vid2.txt").write_text("잘못된 enrichment 영상입니다.", encoding="utf-8")
            attempts = {"vid1": 0}

            def provider(video_id, transcript):
                if video_id == "vid1":
                    attempts["vid1"] += 1
                    if attempts["vid1"] == 1:
                        raise RuntimeError("429 rate limit")
                    return json.dumps([
                        {
                            "ko": "늦었어",
                            "en": "I am running late.",
                            "note": None,
                            "theme": "free",
                            "register": "casual",
                            "difficulty": 1,
                            "pattern": "I am ~",
                            "variations": [
                                {"kind": "question", "ko": "늦었어?", "en": "Am I running late?"},
                                {"kind": "subject", "ko": "너는 늦었어.", "en": "You are running late."},
                            ],
                            "sibling": None,
                        }
                    ])
                return json.dumps([
                    {
                        "ko": "힘들어",
                        "en": "It's demanding.",
                        "note": None,
                        "theme": "work-advanced",
                        "register": "neutral",
                        "difficulty": 3,
                        "pattern": "It's ~",
                        "variations": [{"kind": "question", "ko": "힘들어?", "en": "Is it demanding?"}],
                        "sibling": {"ko": "힘들어", "en": "It's demanding."},
                    }
                ])

            first = run_full_distillate(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(first["errors"], 1)
            self.assertEqual(first["enrichment_rejected"], 1)
            coverage = read_json(root / "distillate" / "_coverage.json")
            self.assertEqual(coverage["expressions"]["vid1"]["status"], "error")
            self.assertEqual(coverage["expressions"]["vid2"]["status"], "zero-yield")

            second = run_full_distillate(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(second["visited"], 1)
            self.assertEqual(second["skipped"], 1)
            self.assertEqual(second["extracted"], 1)
            coverage = read_json(root / "distillate" / "_coverage.json")
            self.assertEqual(coverage["expressions"]["vid1"]["status"], "extracted")
            records = read_jsonl(root / "distillate" / "expressions-full.jsonl")
            self.assertEqual(len(records), 1)

    def test_w2_curation_retains_existing_and_uses_distillate(self) -> None:
        from bank_refresh import append_jsonl, curate_bank_from_distillate

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            existing = {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": [
                    {
                        "ko": "막혔어",
                        "en": "I was stuck.",
                        "note": None,
                        "theme": "selftalk-emotion",
                        "register": "casual",
                        "source_id": "old1",
                        "difficulty": 1,
                        "word_count": 3,
                        "pattern": "I was ~",
                        "variations": [
                            {"kind": "question", "ko": "막혔어?", "en": "Was I stuck?"},
                            {"kind": "subject", "ko": "너는 막혔어.", "en": "You were stuck."},
                        ],
                        "sibling": None,
                        "enrichedAt": "2026-06-13T00:00:00Z",
                        "enrichVersion": 1,
                    }
                ],
            }
            write_json_atomic(root / "expression-bank.json", existing)
            append_jsonl(root / "distillate" / "expressions-full.jsonl", [
                {
                    "ko": "연락할게",
                    "en": "I'll be in touch.",
                    "note": None,
                    "theme": "family-friends",
                    "register": "neutral",
                    "source_id": "vid1",
                    "difficulty": 1,
                    "word_count": 4,
                    "pattern": "I'll be ~",
                    "variations": [
                        {"kind": "question", "ko": "연락할까?", "en": "Will I be in touch?"},
                        {"kind": "subject", "ko": "너는 연락할 거야.", "en": "You'll be in touch."},
                    ],
                    "sibling": None,
                    "enrichedAt": "2026-06-13T00:00:00Z",
                    "enrichVersion": 1,
                    "extractedAt": "2026-06-13T00:00:00Z",
                }
            ])
            report = curate_bank_from_distillate(root, write_staging=True)
            self.assertEqual(report["added"], 1)
            staged = read_json(root / "expression-bank.staging.json")
            self.assertEqual(staged["entries"][0]["en"], "I was stuck.")
            self.assertEqual(staged["entries"][1]["en"], "I'll be in touch.")
            self.assertTrue(staged["entries"][1]["verifiedInSource"])

    def test_w2_curation_adds_local_source_verification_flags(self) -> None:
        from bank_refresh import curate_bank_from_distillate

        def enriched_entry(en: str, source_id: str) -> dict[str, object]:
            return {
                "ko": "테스트",
                "en": en,
                "note": None,
                "theme": "free",
                "register": "neutral",
                "source_id": source_id,
                "difficulty": 1,
                "word_count": len(en.rstrip(".").split()),
                "pattern": en[:40],
                "variations": [
                    {"kind": "question", "ko": "질문", "en": f"{en.rstrip('.')}?"},
                    {"kind": "past", "ko": "과거", "en": en},
                ],
                "sibling": None,
                "enrichedAt": "2026-06-13T00:00:00Z",
                "enrichVersion": 1,
            }

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "verbatim.txt").write_text("강사는 I am running late 라고 말한다.", encoding="utf-8")
            (transcripts / "misattributed.txt").write_text("강사는 totally different phrase 를 말한다.", encoding="utf-8")
            write_json_atomic(root / "expression-bank.json", {
                "updatedAt": "2026-06-13T00:00:00Z",
                "source": "ppalmo-distill-v1",
                "entries": [
                    enriched_entry("I am running late.", "verbatim"),
                    enriched_entry("I was totally stuck.", "misattributed"),
                    enriched_entry("I'll be in touch.", "missing"),
                ],
            })

            report = curate_bank_from_distillate(root, write_staging=True, transcript_dir=transcripts)
            self.assertTrue(report["written"])
            entries = read_json(root / "expression-bank.staging.json")["entries"]
            self.assertTrue(entries[0]["verifiedInSource"])
            self.assertFalse(entries[1]["verifiedInSource"])
            self.assertNotIn("verifiedInSource", entries[2])

    def test_w3_teaching_map_reduce(self) -> None:
        from teach_notes import reduce_notes, run_map

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "vid1.txt").write_text("느낌 차이를 설명하고 여러 번 따라 하게 해요.", encoding="utf-8")

            def provider(video_id, transcript):
                return json.dumps({
                    "observations": {
                        "correction_style": ["틀린 표현을 바로 자연스러운 말로 바꿔준다"],
                        "nuance_framing": ["느낌이라는 말로 뉘앙스를 설명한다"],
                        "drilling_habits": ["같은 표현을 여러 번 따라 하게 한다"],
                        "encouragement_style": ["짧게 칭찬하고 바로 다음 예문으로 간다"],
                        "contrast_patterns": ["비슷한 표현의 상황 차이를 대비한다"],
                    }
                })

            map_report = run_map(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(map_report["observed"], 1)
            coverage = read_json(root / "distillate" / "_coverage.json")
            gate = validate_coverage_lane(coverage, ["vid1"], lane="teaching")
            self.assertTrue(gate.ok, gate.reason)
            out = root / "notes.md"

            def cluster_provider(section, items, merge):
                return json.dumps({
                    "clusters": [
                        {
                            "pattern": items[0]["text"],
                            "video_count": len(items[0]["video_ids"]),
                            "example_video_ids": items[0]["video_ids"][:6],
                        }
                    ] if items else []
                })

            reduce_report = reduce_notes(root, write=True, output_path=out, cluster_provider=cluster_provider)
            self.assertTrue(reduce_report["written"])
            text = out.read_text(encoding="utf-8")
            self.assertIn("[vid1]", text)
            self.assertIn("Nuance Framing", text)

    def test_w3_reduce_clusters_paraphrases_with_merged_ids(self) -> None:
        from bank_refresh import append_jsonl
        from teach_notes import reduce_notes

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            append_jsonl(root / "distillate" / "teaching-obs.jsonl", [
                {
                    "videoId": "vid1",
                    "observedAt": "2026-06-13T00:00:00Z",
                    "observations": {
                        "correction_style": [],
                        "nuance_framing": [],
                        "drilling_habits": ["여러 번 반복하여 입에 익히도록 한다"],
                        "encouragement_style": [],
                        "contrast_patterns": [],
                    },
                },
                {
                    "videoId": "vid2",
                    "observedAt": "2026-06-13T00:00:00Z",
                    "observations": {
                        "correction_style": [],
                        "nuance_framing": [],
                        "drilling_habits": ["두 번씩 반복하여 따라 하도록 한다"],
                        "encouragement_style": [],
                        "contrast_patterns": [],
                    },
                },
            ])

            def cluster_provider(section, items, merge):
                if section != "drilling_habits":
                    return '{"clusters":[]}'
                return json.dumps({
                    "clusters": [
                        {
                            "pattern": "반복 발화로 표현을 입에 붙이는 드릴을 한다",
                            "video_count": 2,
                            "example_video_ids": ["vid1", "vid2"],
                        }
                    ]
                })

            out = root / "notes.md"
            report = reduce_notes(root, write=True, output_path=out, cluster_provider=cluster_provider)
            self.assertTrue(report["written"])
            text = out.read_text(encoding="utf-8")
            self.assertIn("~2 videos: 반복 발화로 표현을 입에 붙이는 드릴을 한다 [vid1, vid2]", text)
            self.assertNotIn("여러 번 반복하여 입에 익히도록 한다", text)
            self.assertNotIn("두 번씩 반복하여 따라 하도록 한다", text)

    def test_w3_reduce_rejects_hallucinated_cluster_ids(self) -> None:
        from bank_refresh import append_jsonl
        from teach_notes import reduce_notes

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            append_jsonl(root / "distillate" / "teaching-obs.jsonl", [
                {
                    "videoId": "real1",
                    "observedAt": "2026-06-13T00:00:00Z",
                    "observations": {
                        "correction_style": ["틀린 말을 바로 자연스럽게 고쳐준다"],
                        "nuance_framing": [],
                        "drilling_habits": [],
                        "encouragement_style": [],
                        "contrast_patterns": [],
                    },
                }
            ])

            def cluster_provider(section, items, merge):
                if section != "correction_style":
                    return '{"clusters":[]}'
                return json.dumps({
                    "clusters": [
                        {
                            "pattern": "없는 영상으로 만든 잘못된 클러스터",
                            "video_count": 1,
                            "example_video_ids": ["fake-video"],
                        }
                    ]
                })

            out = root / "notes.md"
            reduce_notes(root, write=True, output_path=out, cluster_provider=cluster_provider)
            text = out.read_text(encoding="utf-8")
            self.assertNotIn("fake-video", text)
            self.assertNotIn("없는 영상으로 만든 잘못된 클러스터", text)
            self.assertIn("틀린 말을 바로 자연스럽게 고쳐준다 [real1]", text)

    def test_w3_invalid_utf8_transcript_does_not_abort_lazy_walk(self) -> None:
        from teach_notes import run_map

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "bad.txt").write_bytes(b"caf\xed remainder")
            (transcripts / "good.txt").write_text("느낌 차이를 설명합니다.", encoding="utf-8")
            seen_sources: list[str] = []

            def provider(video_id, transcript):
                seen_sources.append(video_id)
                if video_id == "bad":
                    return "{}"
                return json.dumps({
                    "observations": {
                        "correction_style": ["틀린 표현을 자연스럽게 고쳐준다"],
                        "nuance_framing": [],
                        "drilling_habits": [],
                        "encouragement_style": [],
                        "contrast_patterns": [],
                    }
                })

            report = run_map(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(seen_sources, ["bad", "good"])
            self.assertEqual(report["visited"], 2)
            self.assertEqual(report["zero_yield"], 1)
            self.assertEqual(report["observed"], 1)

    def test_w3_error_lane_retries(self) -> None:
        from teach_notes import run_map

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            transcripts = root / "transcripts"
            transcripts.mkdir()
            (transcripts / "vid1.txt").write_text("느낌 차이를 설명합니다.", encoding="utf-8")
            attempts = {"vid1": 0}

            def provider(video_id, transcript):
                attempts["vid1"] += 1
                if attempts["vid1"] == 1:
                    raise RuntimeError("429 rate limit")
                return json.dumps({
                    "observations": {
                        "correction_style": ["틀린 표현을 자연스럽게 고쳐준다"],
                        "nuance_framing": [],
                        "drilling_habits": [],
                        "encouragement_style": [],
                        "contrast_patterns": [],
                    }
                })

            first = run_map(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(first["errors"], 1)
            coverage = read_json(root / "distillate" / "_coverage.json")
            self.assertEqual(coverage["teaching"]["vid1"]["status"], "error")

            second = run_map(root, transcript_dir=transcripts, provider=provider, write=True)
            self.assertEqual(second["visited"], 1)
            self.assertEqual(second["observed"], 1)
            coverage = read_json(root / "distillate" / "_coverage.json")
            self.assertEqual(coverage["teaching"]["vid1"]["status"], "observed")

    def test_canonical_study_date_cutoff(self) -> None:
        from datetime import datetime
        from zoneinfo import ZoneInfo

        seoul = ZoneInfo("Asia/Seoul")
        self.assertEqual(canonical_study_date(datetime(2026, 6, 10, 3, 59, tzinfo=seoul)), "2026-06-09")
        self.assertEqual(canonical_study_date(datetime(2026, 6, 10, 4, 0, tzinfo=seoul)), "2026-06-10")


if __name__ == "__main__":
    unittest.main()

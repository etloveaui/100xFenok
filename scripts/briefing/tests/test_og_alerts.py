"""Preview image, failure alerts and the missed-run check (no network, fake senders only).
Run from scripts/: python -m unittest discover -s briefing/tests -t ."""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from briefing import alert, notify, publish, run_morning, watchdog
from briefing.common import CFG

try:
    from briefing import og_image
except ImportError:  # Pillow is installed only in the job venv
    og_image = None


def edition(date: str = "2026-10-08", headline: str = "10년물 5.36% 찍고 후퇴…대형주만 낙폭 회복") -> dict:
    pts = [[f"{9 + (30 + 5 * i) // 60:02d}:{(30 + 5 * i) % 60:02d}", 7780 + (i % 13) * 2.5] for i in range(78)]
    return {"edition_date": date, "market_date": "2026-10-07", "headline": headline, "thesis": "t", "story": {"why": ["a", "b"]},
            "pack": {"indices": {"S&P 500": {"close": 7801.77, "chg_pct": -0.22}, "나스닥": {"close": 27538.69, "chg_pct": -0.22},
                                 "러셀2000": {"close": 2793.2, "chg_pct": -1.31}},
                     "rates": {"us10y": 5.28, "us10y_prev": 5.27},
                     "intraday": {"S&P 500": {"open": 7780, "high": 7810.0, "high_time": "14:55", "low": 7780.0, "low_time": "09:30",
                                              "close": 7800.26, "points": pts}},
                     "edge": {"score": 41, "label": "방어", "prev_score": 70}}}


class Sender:
    def __init__(self, status: str = "success") -> None:
        self.calls: list[tuple[str, str]] = []
        self.status = status

    def __call__(self, content: str, run_id: str) -> dict:
        self.calls.append((content, run_id))
        return {"status": self.status, "sent": 1, "total": 1}


class AlertTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "alerts.json"

    def test_one_line_once_per_edition_and_step(self):
        s = Sender()
        log_path = Path.home() / ".local/state/100x-briefing/runs/2026-10-09/run.log"
        alert.send_failure("2026-10-09", "writer", "RuntimeError: both models failed\nsecond line", log_path, s, self.path)
        again = alert.send_failure("2026-10-09", "writer", "RuntimeError: again", log_path, s, self.path)
        alert.send_failure("2026-10-09", "push", "RuntimeError: push failed", log_path, s, self.path)
        self.assertEqual([r for _, r in s.calls], ["morning_article_alert:2026-10-09:writer", "morning_article_alert:2026-10-09:push"])
        self.assertTrue(again["skipped"])
        content = s.calls[0][0]
        self.assertNotIn("\n", content)
        for part in ("2026-10-09", "기사 작성", "writer", "both models failed", "~/.local/state/100x-briefing/runs/2026-10-09/run.log"):
            self.assertIn(part, content)
        self.assertEqual(json.loads(self.path.read_text())["2026-10-09:writer"]["status"], "sent")

    def test_send_error_is_recorded_never_raised_and_retried(self):
        def boom(content, run_id):
            raise OSError("gateway down")
        rec = alert.send_failure("2026-10-09", "notify", "x", "/l", boom, self.path)
        self.assertEqual(rec["status"], "error")
        s = Sender()
        alert.send_failure("2026-10-09", "notify", "x", "/l", s, self.path)
        self.assertEqual(len(s.calls), 1)

    def test_gateway_refusal_counts_as_sent(self):
        s = Sender("already_delivered")
        alert.send_failure("2026-10-09", "push", "x", "/l", s, self.path)
        alert.send_failure("2026-10-09", "push", "x", "/l", s, self.path)
        self.assertEqual(len(s.calls), 1)

    def test_ops_route_class(self):
        with mock.patch.object(notify, "gateway_send", return_value={"status": "success"}) as gw:
            alert.ops_send("c", "rid")
        gw.assert_called_once_with("c", "rid", message_class="ops_alert", product_id="")


class RunMorningAlertTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        p = mock.patch.dict(CFG["state"], {"dir": str(self.tmp)})
        p.start()
        self.addCleanup(p.stop)
        for target, kw in ((publish, {"worktree": mock.Mock(return_value=self.tmp / "repo"), "sync": mock.Mock(return_value="abc")}),):
            for name, value in kw.items():
                q = mock.patch.object(target, name, value)
                q.start()
                self.addCleanup(q.stop)
        self.gateway = mock.patch.object(notify, "gateway_send", side_effect=lambda c, r, **k: {"status": "success"})
        self.gw = self.gateway.start()
        self.addCleanup(self.gateway.stop)

    def test_failed_step_alerts_once(self):
        with mock.patch.object(run_morning, "wait_inputs", side_effect=RuntimeError("AA morning brief not ready by 09:30 KST")):
            self.assertEqual(run_morning.main(["--edition", "2026-10-08"]), 1)
            self.assertEqual(run_morning.main(["--edition", "2026-10-08"]), 1)
        self.assertEqual([c.args[1] for c in self.gw.call_args_list], ["morning_article_alert:2026-10-08:aa_brief"])
        state = json.loads((self.tmp / "editions" / "2026-10-08.json").read_text())
        self.assertEqual((state["status"], state["step"]), ("failed", "aa_brief"))

    def test_success_sends_no_alert_and_waits_for_the_image(self):
        doc = edition()
        with mock.patch.object(run_morning, "wait_inputs", return_value=(None, None)), \
                mock.patch.object(run_morning, "generate", return_value=(doc, {"writer": {}})), \
                mock.patch.object(run_morning, "render_og", return_value=b"\x89PNG"), \
                mock.patch.object(publish, "commit_and_push", return_value="sha") as push, \
                mock.patch.object(publish, "wait_published", return_value={"ok": True, "status": 200, "seconds": 0}), \
                mock.patch.object(notify, "send_once", return_value={}):
            self.assertEqual(run_morning.main(["--edition", "2026-10-08"]), 0)
        self.assertEqual(push.call_args.args[2], b"\x89PNG")
        self.assertEqual(self.gw.call_count, 0)


class WatchdogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())

    def test_missing_state_alerts_once(self):
        s = Sender()
        d = dt.date(2026, 10, 9)
        self.assertEqual(watchdog.check(d, s, self.tmp, self.tmp / "alerts.json"), "alerted")
        watchdog.check(d, s, self.tmp, self.tmp / "alerts.json")
        self.assertEqual([r for _, r in s.calls], ["morning_article_alert:2026-10-09:missed_run"])

    def test_started_or_no_session_is_quiet(self):
        s = Sender()
        (self.tmp / "2026-10-09.json").write_text("{}")
        self.assertEqual(watchdog.check(dt.date(2026, 10, 9), s, self.tmp, self.tmp / "a.json"), "started")
        self.assertEqual(watchdog.check(dt.date(2026, 10, 11), s, self.tmp, self.tmp / "a.json"), "no-session")
        self.assertEqual(s.calls, [])


class PublishImageTests(unittest.TestCase):
    def test_outputs_include_the_png(self):
        root = Path(tempfile.mkdtemp())
        paths = publish.write_outputs(root, edition(), b"\x89PNGdata")
        self.assertEqual([str(p.relative_to(root)) for p in paths], ["morning/2026-10-08.json", "og/2026-10-08.png", "index.json"])
        self.assertEqual(publish.og_url("2026-10-08"), "https://100xfenok.etloveaui.workers.dev/data/briefing/og/2026-10-08.png")

    def test_waits_for_both_pushed_json_and_png(self):
        js, png_old, png_new = b'{"edition_date":"2026-10-08"}', b"\x89PNGold", b"\x89PNGnew"
        pngs = [png_old, png_new]

        class Resp(io.BytesIO):
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_open(req, timeout=20):
            if ".png" in req.full_url:
                return Resp(pngs.pop(0) if len(pngs) > 1 else pngs[0])
            return Resp(js)

        sha = lambda b: hashlib.sha256(b).hexdigest()  # noqa: E731
        with mock.patch.object(publish.urllib.request, "urlopen", fake_open), mock.patch.object(publish.time, "sleep", lambda s: None):
            ok = publish.wait_published("2026-10-08", timeout=60, poll=1, expect_sha=sha(js), og_sha=sha(png_new))
            pngs[:] = [png_old]
            stale = publish.wait_published("2026-10-08", timeout=0, poll=1, expect_sha=sha(js), og_sha=sha(png_new))
        self.assertTrue(ok["ok"])
        self.assertFalse(stale["ok"])
        self.assertIn("og 200 (older version)", stale["status"])


@unittest.skipIf(og_image is None, "Pillow not installed")
class OgImageTests(unittest.TestCase):
    def test_png_size_and_dimensions(self):
        from PIL import Image
        png = og_image.render_bytes(edition())
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertLessEqual(len(png), CFG["og"]["max_bytes"])
        self.assertEqual(Image.open(io.BytesIO(png)).size, (1200, 630))

    def test_headline_wraps_to_two_lines_with_ellipsis(self):
        c = og_image.Canvas()
        f = og_image.font("Bold", 46)
        lines, fit = og_image.wrap(c, "아주 긴 헤드라인 " * 12, f, 1072, 2)
        self.assertEqual(len(lines), 2)
        self.assertFalse(fit)
        self.assertTrue(lines[1].endswith("…"))
        self.assertTrue(all(c.width(x, f) <= 1072 for x in lines))

    def test_missing_intraday_still_renders(self):
        doc = edition()
        doc["pack"].pop("intraday")
        doc["pack"].pop("edge")
        self.assertTrue(og_image.render_bytes(doc).startswith(b"\x89PNG"))


if __name__ == "__main__":
    unittest.main()

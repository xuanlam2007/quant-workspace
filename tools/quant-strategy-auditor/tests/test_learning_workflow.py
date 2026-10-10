import asyncio
import base64
import json
import subprocess
import threading
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from pydantic import ValidationError
from engine.cli_analyzer import CliLearningAnalyzer
from engine.learning_context import build_learning_prompt, load_strategy_documents
from engine.core import SessionLogger
from engine.observed_trades import FillReviewPayload, auto_record_candidates, identify_candidates, recorded_trades
from engine.observer_guard import decide
from engine.server import create_app, AiConfigPayload, AudioChunkPayload, AudioFramePayload, AudioStartPayload, ModePayload, ObservationPayload, RecordingPayload, StrategyModePayload, SwitchSessionPayload, TerminalPayload
from test_recording_controls import FakeListener


class LearningPromptTests(unittest.TestCase):
    def test_timeout_does_not_expose_command_or_schema(self):
        analyzer = CliLearningAnalyzer()
        analyzer.connection = {"connected": True}
        with patch.object(analyzer, "_run", side_effect=subprocess.TimeoutExpired(["PRIVATE_EXECUTABLE", "--json-schema", "PRIVATE_SCHEMA"], 120)):
            result = analyzer.analyze_event(None, None, {"strategy": {"enabled": False}})
        self.assertIn("120", result["ai_error"])
        self.assertNotIn("PRIVATE_EXECUTABLE", result["ai_error"])
        self.assertNotIn("PRIVATE_SCHEMA", result["ai_error"])

    def test_frame_sequence_is_correlated_with_audio_without_exposing_paths(self):
        prompt = build_learning_prompt({"observation_frames": [{"path": "PRIVATE_FRAME_LOCATION", "captured_at": "2026-10-09T08:00:00Z"}], "audio_started_at": "2026-10-09T08:00:00Z", "audio_ended_at": "2026-10-09T08:00:10Z"}, vision=True, audio=True)
        self.assertNotIn("PRIVATE_FRAME_LOCATION", prompt)
        self.assertIn("2026-10-09T08:00:00Z", prompt)
        self.assertIn("Correlate spoken reasons with visible actions", prompt)
        self.assertIn("not continuous video", prompt)

    def test_disabled_reference_does_not_send_historical_strategy(self):
        context = {"strategy": {"enabled": True, "documents": [{"content": "PRIVATE_RULE_OLD"}]}, "ai_strategy_context": {"enabled": False}, "reason": "A visible action", "audio_path": "private-location", "frame_path": "private-image-location"}
        prompt = build_learning_prompt(context)
        self.assertNotIn("PRIVATE_RULE_OLD", prompt)
        self.assertNotIn("private-location", prompt)
        self.assertIn("Do not evaluate against a strategy", prompt)
        self.assertIn("not image contents", prompt)

    def test_enabled_reference_has_source_and_uncertainty_constraints(self):
        prompt = build_learning_prompt({"strategy": {"enabled": True, "documents": [{"name": "Strategy_01.md", "content": "USER_RULE", "sha256": "source-hash"}]}}, vision=True)
        self.assertIn("USER_RULE", prompt)
        self.assertIn("source-hash", prompt)
        self.assertIn("not an automatic violation", prompt)
        self.assertIn("Inspect the attached screenshot", prompt)
        self.assertIn("Do not call tools", prompt)

    def test_missing_and_empty_documents_cannot_enable_reference(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "empty.md").write_text("  ", encoding="utf-8")
            docs, errors = load_strategy_documents({"strategy_documents": ["empty.md", "missing.md"]}, root / "config.json")
            self.assertEqual(docs, [])
            self.assertEqual(len(errors), 2)

    def test_cli_observes_without_reference_and_suppresses_compliance_flags(self):
        analyzer = CliLearningAnalyzer({"provider": "CODEX"})
        analyzer.connection = {"connected": True}
        response = json.dumps({"observation": "Visible action", "question": "Why?", "strategy_difference": True, "evidence_limitations": "No fill evidence", "transcript": "", "trade_observations": []})
        with patch.object(analyzer, "_run", return_value=response) as run:
            result = analyzer.analyze_event("frame.png", None, {"strategy": {"enabled": False}})
        self.assertEqual(run.call_args.kwargs["image"], "frame.png")
        self.assertFalse(result["ai_strategy_difference"])
        self.assertEqual(result["ai_question"], "Why?")
        self.assertEqual(result["ai_error"], "")

    def test_agy_supplies_image_and_audio_for_native_media_reading(self):
        analyzer = CliLearningAnalyzer()
        analyzer.connection = {"connected": True}
        response = json.dumps({"observation": "Evidence", "question": "", "strategy_difference": False, "evidence_limitations": "", "transcript": "Tôi đã khớp lệnh", "trade_observations": []})
        with patch.object(analyzer, "_run", return_value=response) as run:
            result = analyzer.analyze_event("frame.png", "voice.webm", {"strategy": {"enabled": False}})
        self.assertEqual(run.call_args.kwargs["image"], "frame.png")
        self.assertEqual(run.call_args.kwargs["audio"], "voice.webm")
        self.assertIn("Listen to the supplied audio", run.call_args.args[0])
        self.assertEqual(result["ai_transcript"], "Tôi đã khớp lệnh")

    def test_media_guard_allows_only_the_exact_supplied_files(self):
        with tempfile.TemporaryDirectory() as folder:
            media = Path(folder) / "voice.ogg"
            media.write_bytes(b"OggS")
            self.assertEqual(decide({"toolCall": {"name": "view_file", "args": {"AbsolutePath": str(media)}}}, [str(media)])["decision"], "allow")
            for name, args in (("run_command", {"CommandLine": "trade"}), ("browser", {}), ("view_file", {"AbsolutePath": str(media.parent / "private.json")}), ("broker_order", {})):
                self.assertEqual(decide({"toolCall": {"name": name, "args": args}}, [str(media)])["decision"], "deny")

    def test_media_guard_allows_native_structured_finish_without_order_actions(self):
        args = {"observation": "Visible chart", "question": "", "strategy_difference": False, "evidence_limitations": "Still frames only", "transcript": "", "trade_observations": [], "toolAction": "Respond", "toolSummary": "Return observation"}
        self.assertEqual(decide({"toolCall": {"name": "finish", "args": args}}, [])["decision"], "allow")
        for name in ("run_command", "broker_order", "publish", "finish_trade"):
            self.assertEqual(decide({"toolCall": {"name": name, "args": args}}, [])["decision"], "deny")
        self.assertEqual(decide({"toolCall": {"name": "finish", "args": {}}}, [])["decision"], "deny")

    def test_agy_media_requires_completed_read_steps(self):
        with tempfile.TemporaryDirectory() as folder:
            media = Path(folder) / "voice.ogg"
            media.write_bytes(b"OggS")
            def run(command, **kwargs):
                self.assertIn("--input-format", command)
                self.assertNotIn("--dangerously-skip-permissions", command)
                self.assertNotIn("--agent", command)
                self.assertNotIn("--effort", command)
                self.assertIn("preset-model", command)
                self.assertTrue((Path(kwargs["cwd"]) / ".agents" / "hooks.json").is_file())
                hooks = json.loads((Path(kwargs["cwd"]) / ".agents" / "hooks.json").read_text())
                guard = hooks["observer-evidence-only"]["PreToolUse"][0]["hooks"][0]["command"]
                self.assertEqual(guard.split()[1:], ["-I", "observer_guard.py"])
                self.assertNotIn('"', guard)
                self.assertTrue((Path(kwargs["cwd"]) / ".agents" / "observer_guard.py").is_file())
                self.assertEqual(kwargs["terminal_event"], "result")
                copied = json.loads(kwargs["env"]["QUANT_OBSERVER_MEDIA_PATHS"])
                events = [{"event": "step_update", "step_update": {"tool_name": "view_file", "state": "DONE", "tool_info": {"parameters": {"AbsolutePath": copied[0]}}}}, {"event": "result", "result": {"status": "SUCCESS", "response": "heard"}}]
                return type("Result", (), {"returncode": 0, "stderr": "", "stdout": "\n".join(json.dumps(event) for event in events)})()
            analyzer = CliLearningAnalyzer()
            with patch("engine.cli_analyzer.find_cli", return_value="agy.exe"), patch("engine.cli_analyzer.run_cli", side_effect=run):
                legacy = {**analyzer.settings, "model": "preset-model", "agent": "old-agent", "effort": "high"}
                self.assertEqual(analyzer._run("Listen", legacy, audio=media), "heard")
            result = type("Result", (), {"returncode": 0, "stderr": "", "stdout": json.dumps({"event": "result", "result": {"status": "SUCCESS", "response": "invented"}})})()
            with patch("engine.cli_analyzer.find_cli", return_value="agy.exe"), patch("engine.cli_analyzer.run_cli", return_value=result):
                with self.assertRaisesRegex(RuntimeError, "did not read"):
                    analyzer._run("Listen", analyzer.settings, audio=media)

    def test_changed_settings_and_account_stop_queued_analysis(self):
        analyzer = CliLearningAnalyzer()
        old = dict(analyzer.settings)
        analyzer.configure({"provider": "CODEX", "model": "", "agent": "", "effort": "medium"})
        with patch.object(analyzer, "_run") as run:
            result = analyzer.analyze_event(None, None, {"ai_settings": old})
        run.assert_not_called()
        self.assertIn("changed", result["ai_error"])

    def test_queued_analysis_checks_reference_before_sending_media(self):
        analyzer = CliLearningAnalyzer()
        analyzer.connection = {"connected": True}
        context = {"strategy": {"enabled": True, "documents": [{"content": "User strategy"}]}}
        with patch.object(analyzer, "_run") as run:
            result = analyzer.analyze_event("frame.png", "voice.webm", context, reference_is_current=lambda: False)
        run.assert_not_called()
        self.assertIn("reference changed", result["ai_error"])

    def test_connection_requires_real_confirmation(self):
        analyzer = CliLearningAnalyzer()
        with patch.object(analyzer, "_run", return_value="Please sign in"):
            self.assertFalse(analyzer.test_connection()["connected"])
        with patch.object(analyzer, "_run", return_value="PONG"):
            self.assertTrue(analyzer.test_connection()["connected"])

    def test_observer_command_does_not_inherit_broker_tools(self):
        analyzer = CliLearningAnalyzer({"provider": "CODEX"})
        def run(command, **kwargs):
            Path(command[command.index("-o") + 1]).write_text("PONG", encoding="utf-8")
            self.assertIn("--ignore-user-config", command)
            self.assertIn("read-only", command)
            self.assertIn("features.shell_tool=false", command)
            self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", command)
            self.assertNotEqual(Path(kwargs["cwd"]), Path.cwd())
            return type("Result", (), {"returncode": 0, "stdout": "", "stderr": ""})()
        with patch("engine.cli_analyzer.find_cli", return_value="codex.exe"), patch("engine.cli_analyzer.run_cli", side_effect=run):
            self.assertEqual(analyzer._run("Ping", analyzer.settings), "PONG")


class LearningWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.storage = tempfile.TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        self.root = Path(self.storage.name)
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"mode": "DESKTOP", "auto_start_recording": True, "strategy_documents": ["strategy.md"]}), encoding="utf-8")
        logger = SessionLogger(str(self.root / "sessions"))
        logger.new_session()
        self.analyzer = CliLearningAnalyzer()
        self.catalog = {"provider": "CODEX", "models": [{"id": "model-id", "label": "Model", "is_default": True, "efforts": [{"id": "high", "label": "High"}, {"id": "max", "label": "Max"}]}], "agents": [], "efforts": [], "errors": {}}
        catalog_mock = patch.object(self.analyzer, "catalog", return_value=self.catalog)
        catalog_mock.start()
        self.addCleanup(catalog_mock.stop)
        for mock in [patch("engine.server.DesktopListener", FakeListener), patch("engine.server.window_details", return_value={"id": 42, "title": "Chart window"}), patch("engine.server.CliLearningAnalyzer", return_value=self.analyzer)]:
            mock.start()
            self.addCleanup(mock.stop)
        self.app = create_app(str(self.config))
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))

    def endpoint(self, path, method="POST"):
        return next(route.endpoint for route in self.app.routes if route.path == path and method in getattr(route, "methods", []))

    def invoke(self, path, payload):
        return asyncio.run(self.endpoint(path)(payload))

    def status(self):
        return self.endpoint("/api/status", "GET")()

    def observe_connected(self):
        self.analyzer.connection = {"connected": True}
        async def observe():
            result = {"ai_thesis": "Trader waits for price confirmation", "ai_error": "", "ai_question": "", "ai_trade_observations": []}
            with patch.object(self.analyzer, "analyze_event", return_value=result) as analyze:
                saved = await self.endpoint("/api/observation")(ObservationPayload())
                await asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task()))
                context = analyze.call_args.args[2]
            return saved["event"], context
        return asyncio.run(observe())

    def test_observation_is_saved_without_connection_or_strategy_flags(self):
        with patch.object(self.analyzer, "analyze_event") as analyze:
            event = self.invoke("/api/observation", ObservationPayload(reason="My explanation"))["event"]
        analyze.assert_not_called()
        self.assertEqual(event["reason"], "My explanation")
        self.assertFalse(event["ai_pending"])
        self.assertEqual(event["warnings"], [])
        self.assertFalse(event["strategy"]["enabled"])
        self.assertTrue(Path(event["frame_path"]).is_file())

    def test_connected_recording_without_strategy_observes_evidence(self):
        event, context = self.observe_connected()
        self.assertFalse(event["ai_pending"])
        self.assertEqual(event["ai_thesis"], "Trader waits for price confirmation")
        self.assertFalse(context["ai_strategy_context"]["enabled"])
        self.assertEqual(context["ai_strategy_context"]["documents"], [])
        self.assertTrue(Path(event["frame_path"]).is_file())

    def test_slow_analysis_keeps_more_than_eight_observations_queued_in_order(self):
        self.analyzer.connection = {"connected": True}
        entered, release = threading.Event(), threading.Event()
        seen = []
        def analyze(image, audio, context, *args):
            seen.append(context)
            if len(seen) == 1:
                entered.set()
                if not release.wait(timeout=5):
                    raise RuntimeError("Test did not release the first observation")
            return {"ai_thesis": context["reason"], "ai_error": "", "ai_question": "", "ai_trade_observations": []}
        async def record():
            with patch.object(self.analyzer, "analyze_event", side_effect=analyze):
                first = (await self.endpoint("/api/observation")(ObservationPayload(reason="first")))["event"]
                try:
                    self.assertTrue(await asyncio.wait_for(asyncio.to_thread(entered.wait, 2), timeout=3))
                    queued = [(await self.endpoint("/api/observation")(ObservationPayload(reason=f"queued-{index}")))["event"] for index in range(12)]
                    self.assertEqual(len(seen), 1)
                    self.assertEqual(first["ai_status"], "processing")
                    self.assertTrue(all(event["ai_pending"] and event["ai_status"] == "queued" and not event["ai_error"] for event in queued))
                    with self.assertRaises(HTTPException):
                        await self.endpoint("/api/events/{event_id}/analyze")(queued[0]["id"], SwitchSessionPayload(date=queued[0]["date"], session_id=queued[0]["session_id"]))
                finally:
                    release.set()
                await asyncio.wait_for(asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task())), timeout=5)
                return [first, *queued]
        events = asyncio.run(record())
        self.assertEqual([context["reason"] for context in seen], [event["reason"] for event in events])
        self.assertTrue(all(not event["ai_pending"] and event["ai_status"] == "complete" and not event["ai_error"] for event in events))
        self.assertIn(events[0]["id"], [item["event_id"] for item in seen[1]["prior_observations"]])

    def test_connection_check_recovers_only_legacy_busy_errors(self):
        busy = self.invoke("/api/observation", ObservationPayload(reason="busy"))["event"]
        failed = self.invoke("/api/observation", ObservationPayload(reason="real failure"))["event"]
        async def reconnect():
            result = {"ai_thesis": "Recovered", "ai_error": "", "ai_question": "", "ai_trade_observations": []}
            def connected():
                self.analyzer.connection = {"connected": True}
                return {"connected": True}
            # Cập nhật trực tiếp nhật ký thử nghiệm qua đối tượng sự kiện đang hoạt động.
            busy["ai_error"] = "AI is busy with another observation. The recording is saved; retry shortly."
            failed["ai_error"] = "Audio unsupported"
            with patch.object(self.analyzer, "test_connection", side_effect=connected), patch.object(self.analyzer, "analyze_event", return_value=result) as analyze:
                await self.endpoint("/api/ai/connection/test")()
                await asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task()))
                self.assertEqual(analyze.call_count, 1)
        asyncio.run(reconnect())
        self.assertEqual(busy["ai_status"], "complete")
        self.assertEqual(failed["ai_error"], "Audio unsupported")

    def test_account_change_does_not_send_waiting_observation_to_new_provider(self):
        self.analyzer.connection = {"connected": True}
        entered, release = threading.Event(), threading.Event()
        def analyze(*args):
            entered.set()
            if not release.wait(timeout=5):
                raise RuntimeError("Test did not release the first observation")
            return {"ai_error": "Account changed", "ai_thesis": "", "ai_trade_observations": []}
        async def record():
            with patch.object(self.analyzer, "analyze_event", side_effect=analyze) as calls:
                await self.endpoint("/api/observation")(ObservationPayload(reason="active"))
                try:
                    self.assertTrue(await asyncio.wait_for(asyncio.to_thread(entered.wait, 2), timeout=3))
                    queued = (await self.endpoint("/api/observation")(ObservationPayload(reason="waiting")))["event"]
                    self.analyzer.configure({"provider": "CODEX"})
                finally:
                    release.set()
                await asyncio.wait_for(asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task())), timeout=5)
                self.assertEqual(calls.call_count, 1)
                return queued
        queued = asyncio.run(record())
        self.assertFalse(queued["ai_pending"])
        self.assertEqual(queued["ai_status"], "failed")
        self.assertIn("changed while queued", queued["ai_error"])

    def test_one_provider_failure_does_not_stop_the_saved_queue(self):
        self.analyzer.connection = {"connected": True}
        async def record():
            with patch.object(self.analyzer, "analyze_event", side_effect=[RuntimeError("Audio unsupported"), {"ai_thesis": "Next recording", "ai_error": "", "ai_trade_observations": []}]):
                first = (await self.endpoint("/api/observation")(ObservationPayload(reason="first")))["event"]
                second = (await self.endpoint("/api/observation")(ObservationPayload(reason="second")))["event"]
                await asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task()))
                return first, second
        first, second = asyncio.run(record())
        self.assertEqual(first["ai_status"], "failed")
        self.assertEqual(first["ai_error"], "Audio unsupported")
        self.assertEqual(second["ai_status"], "complete")
        self.assertFalse(second["ai_pending"])

    def test_saved_style_observations_are_context_after_reopening_session(self):
        event, _ = self.observe_connected()
        self.app = create_app(str(self.config))
        self.invoke("/api/mode", ModePayload(mode="DESKTOP", target_window_id=42))
        _, context = self.observe_connected()
        memory = next(item for item in context["prior_observations"] if item["event_id"] == event["id"])
        self.assertEqual(memory["observation"], event["ai_thesis"])
        self.assertFalse(context["ai_strategy_context"]["enabled"])

    def test_strategy_changes_are_detected_without_restart_or_automatic_enable(self):
        self.assertFalse(self.status()["strategy_available"])
        strategy_file = self.root / "strategy.md"
        strategy_file.write_text("Original user rule", encoding="utf-8")
        self.assertTrue(self.status()["strategy_available"])
        self.assertFalse(self.status()["strategy_mode"])
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        before = self.invoke("/api/observation", ObservationPayload())["event"]
        strategy_file.write_text("Updated user rule", encoding="utf-8")
        after = self.invoke("/api/observation", ObservationPayload())["event"]
        self.assertEqual(before["strategy"]["documents"][0]["content"], "Original user rule")
        self.assertEqual(after["strategy"]["documents"][0]["content"], "Updated user rule")
        self.assertNotEqual(before["strategy"]["documents"][0]["sha256"], after["strategy"]["documents"][0]["sha256"])
        strategy_file.unlink()
        event, context = self.observe_connected()
        self.assertFalse(event["ai_pending"])
        self.assertTrue(event["ai_thesis"])
        self.assertFalse(context["ai_strategy_context"]["enabled"])
        self.assertFalse(self.status()["strategy_mode"])

    def test_disabled_reference_keeps_observations_without_sending_documents(self):
        (self.root / "strategy.md").write_text("User rule", encoding="utf-8")
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=False))
        event, context = self.observe_connected()
        self.assertFalse(event["ai_pending"])
        self.assertTrue(event["ai_thesis"])
        self.assertEqual(context["ai_strategy_context"]["documents"], [])
        self.assertEqual(event["warnings"], [])

    def test_teaching_endpoint_is_outside_recorder_scope(self):
        self.assertNotIn("/api/events/{event_id}/teach", [route.path for route in self.app.routes])

    def test_pause_and_stale_generation_do_not_create_observations(self):
        generation = self.status()["capture_generation"]
        self.invoke("/api/recording", RecordingPayload(action="pause"))
        with self.assertRaises(HTTPException):
            self.invoke("/api/observation", ObservationPayload())
        self.invoke("/api/recording", RecordingPayload(action="resume"))
        with self.assertRaises(HTTPException):
            self.invoke("/api/observation", ObservationPayload(capture_generation=generation))
        self.assertEqual(self.status()["recent_events"], [])

    def test_provider_settings_persist_and_require_another_connection_check(self):
        self.analyzer.connection = {"connected": True}
        result = self.invoke("/api/ai/config", AiConfigPayload(provider="CODEX", model="model-id", effort="high"))
        self.assertEqual(result["provider"], "CODEX")
        self.assertEqual(result["agent"], "")
        self.assertIsNone(result["connected"])
        self.assertEqual(json.loads(self.config.read_text())["ai_connection"]["model"], "model-id")

    def test_failed_settings_save_keeps_previous_provider(self):
        with patch("engine.server.json.dump", side_effect=OSError("Disk unavailable")):
            with self.assertRaises(HTTPException):
                self.invoke("/api/ai/config", AiConfigPayload(provider="CODEX"))
        self.assertEqual(self.analyzer.settings["provider"], "AGY")

    def test_config_accepts_only_efforts_discovered_for_selected_model(self):
        result = self.invoke("/api/ai/config", AiConfigPayload(provider="CODEX", model="model-id", effort="max"))
        self.assertEqual(result["effort"], "max")
        with self.assertRaises(HTTPException) as error:
            self.invoke("/api/ai/config", AiConfigPayload(provider="CODEX", model="model-id", effort="undiscovered"))
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.analyzer.settings["effort"], "max")

    def test_config_rejects_missing_models_without_saving(self):
        for payload in (AiConfigPayload(provider="CODEX", model="missing"), AiConfigPayload(provider="AGY", model="missing")):
            with self.subTest(payload=payload), self.assertRaises(HTTPException):
                self.invoke("/api/ai/config", payload)
        self.assertEqual(self.analyzer.settings["model"], "")
        self.assertEqual(self.analyzer.settings["agent"], "")

    def test_agy_save_clears_stored_legacy_agent_and_effort_overrides(self):
        self.analyzer.settings["agent"] = "legacy-agent"
        result = self.invoke("/api/ai/config", AiConfigPayload(provider="AGY", model="model-id", effort="high"))
        self.assertEqual(result["agent"], "")
        self.assertEqual(result["effort"], "")
        saved = json.loads(self.config.read_text())["ai_connection"]
        self.assertEqual(saved["model"], "model-id")
        self.assertEqual(saved["agent"], "")
        self.assertEqual(saved["effort"], "")

    def test_grouped_agy_selection_persists_native_variant_not_display_name(self):
        self.catalog["models"] = [
            {"id": "future-high", "label": "Future Model (High)", "preset_group": {"id": "future-high", "label": "Future Model"}, "preset_effort": "High"},
            {"id": "future-low", "label": "Future Model (Low)", "preset_group": {"id": "future-high", "label": "Future Model"}, "preset_effort": "Low"},
        ]
        result = self.invoke("/api/ai/config", AiConfigPayload(provider="AGY", model="future-low"))
        self.assertEqual(result["model"], "future-low")
        saved = json.loads(self.config.read_text())["ai_connection"]
        self.assertEqual(saved["model"], "future-low")
        self.assertEqual(saved["effort"], "")
        with self.assertRaises(HTTPException):
            self.invoke("/api/ai/config", AiConfigPayload(provider="AGY", model="Future Model"))
        self.assertEqual(self.analyzer.settings["model"], "future-low")

    def test_audio_final_clip_remains_in_original_session(self):
        before = self.status()
        token = self.invoke("/api/audio/start", AudioStartPayload(date=before["current_date"], session_id=before["session_id"]))["token"]
        asyncio.run(self.endpoint("/api/sessions/new")())
        data = base64.b64encode(b"\x1a\x45\xdf\xa3test-audio").decode()
        payload = AudioChunkPayload(data=data, mime="audio/webm", started_at="2026-10-08T00:00:00Z", ended_at="2026-10-08T00:00:01Z")
        result = asyncio.run(self.endpoint("/api/audio/{token}")(token, payload))
        self.assertEqual(result["event"]["session_id"], before["session_id"])
        self.assertNotIn("frame_path", result["event"])
        self.assertTrue(Path(result["event"]["audio_path"]).is_file())
        self.assertEqual(self.status()["recent_events"], [])

    def audio_payload(self, **updates):
        return AudioChunkPayload(data=base64.b64encode(b"\x1a\x45\xdf\xa3test-audio").decode(), mime="audio/webm", started_at="2026-10-08T00:00:00Z", ended_at="2026-10-08T00:00:01Z", **updates)

    def start_audio(self):
        state = self.status()
        return self.invoke("/api/audio/start", AudioStartPayload(date=state["current_date"], session_id=state["session_id"], capture_generation=state["capture_generation"]))["token"]

    def test_recorded_frames_are_attached_only_to_matching_audio_window(self):
        token = self.start_audio()
        frame = asyncio.run(self.endpoint("/api/audio/{token}/frame")(token, AudioFramePayload()))["frame"]
        stamp = frame["captured_at"]
        event = asyncio.run(self.endpoint("/api/audio/{token}")(token, self.audio_payload().model_copy(update={"started_at": stamp, "ended_at": stamp})))["event"]
        self.assertEqual(event["observation_frames"], [frame])
        self.assertEqual(event["frame_path"], frame["path"])
        other = asyncio.run(self.endpoint("/api/audio/{token}")(token, self.audio_payload()))["event"]
        self.assertNotIn("observation_frames", other)

    def test_source_change_blocks_new_frames_but_preserves_final_clip_frames(self):
        token = self.start_audio()
        frame = asyncio.run(self.endpoint("/api/audio/{token}/frame")(token, AudioFramePayload()))["frame"]
        self.invoke("/api/recording", RecordingPayload(action="pause"))
        with self.assertRaises(HTTPException):
            asyncio.run(self.endpoint("/api/audio/{token}/frame")(token, AudioFramePayload()))
        stamp = frame["captured_at"]
        event = asyncio.run(self.endpoint("/api/audio/{token}")(token, self.audio_payload().model_copy(update={"started_at": stamp, "ended_at": stamp})))["event"]
        self.assertEqual(event["observation_frames"], [frame])
        self.assertTrue(Path(event["audio_path"]).is_file())

    def test_stale_capture_cannot_start_microphone(self):
        before = self.status()
        self.invoke("/api/recording", RecordingPayload(action="pause"))
        self.invoke("/api/recording", RecordingPayload(action="resume"))
        with self.assertRaises(HTTPException) as error:
            self.invoke("/api/audio/start", AudioStartPayload(date=before["current_date"], session_id=before["session_id"], capture_generation=before["capture_generation"]))
        self.assertEqual(error.exception.status_code, 409)

    def test_connected_audio_without_strategy_is_saved_and_analyzed_with_screenshot(self):
        token = self.start_audio()
        self.analyzer.connection = {"connected": True}
        async def save():
            result = {"ai_thesis": "Recorded explanation", "ai_transcript": "Tôi đang chờ xác nhận", "ai_error": "", "ai_question": "", "ai_trade_observations": []}
            with patch.object(self.analyzer, "analyze_event", return_value=result) as analyze:
                saved = await self.endpoint("/api/audio/{token}")(token, self.audio_payload())
                await asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task()))
                image, audio, context = analyze.call_args.args[:3]
            return saved["event"], image, audio, context
        event, image, audio, context = asyncio.run(save())
        self.assertTrue(Path(image).is_file())
        self.assertTrue(Path(audio).is_file())
        self.assertFalse(context["ai_strategy_context"]["enabled"])
        self.assertEqual(context["ai_strategy_context"]["documents"], [])
        self.assertEqual(event["ai_transcript"], "Tôi đang chờ xác nhận")
        self.assertFalse(event["ai_pending"])
        response = self.endpoint("/api/sessions/{date}/{session_id}/audio/{filename}", "GET")(event["date"], event["session_id"], Path(audio).name)
        self.assertEqual(response.media_type, "audio/webm")

    def test_codex_audio_is_automatically_analyzed_without_strategy(self):
        self.analyzer.configure({"provider": "CODEX"})
        self.test_connected_audio_without_strategy_is_saved_and_analyzed_with_screenshot()

    def test_saved_audio_can_be_retried_with_codex(self):
        token = self.start_audio()
        event = asyncio.run(self.endpoint("/api/audio/{token}")(token, self.audio_payload()))["event"]
        self.analyzer.configure({"provider": "CODEX"})
        self.analyzer.connection = {"connected": True}
        async def retry():
            result = {"ai_thesis": "Recorded speech", "ai_transcript": "Tôi đang chờ", "ai_error": "", "ai_trade_observations": []}
            with patch.object(self.analyzer, "analyze_event", return_value=result) as analyze:
                response = await self.endpoint("/api/events/{event_id}/analyze")(event["id"], SwitchSessionPayload(date=event["date"], session_id=event["session_id"]))
                await asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task()))
                self.assertEqual(analyze.call_args.args[2]["ai_settings"]["provider"], "CODEX")
                return response["event"]
        updated = asyncio.run(retry())
        self.assertEqual(updated["ai_transcript"], "Tôi đang chờ")
        self.assertEqual(updated["audio_path"], event["audio_path"])

    def test_audio_survives_screenshot_failure(self):
        token = self.start_audio()
        with patch.object(FakeListener, "capture_screen", return_value=None):
            event = asyncio.run(self.endpoint("/api/audio/{token}")(token, self.audio_payload()))["event"]
        self.assertTrue(Path(event["audio_path"]).is_file())
        self.assertNotIn("frame_path", event)
        self.assertTrue(event["capture_error"])

    def test_final_clip_after_pause_does_not_capture_resumed_source(self):
        token = self.start_audio()
        self.invoke("/api/recording", RecordingPayload(action="pause"))
        self.invoke("/api/recording", RecordingPayload(action="resume"))
        with patch.object(FakeListener, "capture_screen") as capture:
            event = asyncio.run(self.endpoint("/api/audio/{token}")(token, self.audio_payload()))["event"]
        capture.assert_not_called()
        self.assertTrue(Path(event["audio_path"]).is_file())

    def test_mixed_timezone_audio_is_rejected_before_saving(self):
        token = self.start_audio()
        payload = self.audio_payload().model_copy(update={"started_at": "2026-10-08T00:00:00"})
        with self.assertRaises(HTTPException) as error:
            asyncio.run(self.endpoint("/api/audio/{token}")(token, payload))
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(self.status()["recent_events"], [])

    def test_deleted_session_cannot_be_recreated_by_final_audio(self):
        before = self.status()
        token = self.invoke("/api/audio/start", AudioStartPayload(date=before["current_date"], session_id=before["session_id"]))["token"]
        asyncio.run(self.endpoint("/api/sessions/{date}/{session_id}", "DELETE")(before["current_date"], before["session_id"]))
        payload = AudioChunkPayload(data=base64.b64encode(b"\x1a\x45\xdf\xa3audio").decode(), mime="audio/webm", started_at="2026-10-08T00:00:00Z", ended_at="2026-10-08T00:00:01Z")
        with self.assertRaises(HTTPException) as error:
            asyncio.run(self.endpoint("/api/audio/{token}")(token, payload))
        self.assertEqual(error.exception.status_code, 404)
        self.assertFalse((self.root / "sessions" / before["current_date"] / before["session_id"]).exists())

    def test_all_terminal_hosts_open_interactive_cli_without_account_commands(self):
        for provider in ("AGY", "CODEX"):
            for host in ("ORCA", "WINDOWS", "WT"):
                executable = f"C:/cli/{provider.lower()}.exe"
                with self.subTest(provider=provider, host=host), patch("engine.server.find_cli", return_value=executable), patch("engine.server.shutil.which", return_value="C:/cli/host.exe"), patch("engine.server.os.path.isfile", return_value=True), patch("engine.server.subprocess.run", return_value=type("Result", (), {"returncode": 0, "stdout": json.dumps({"ok": True, "result": {"terminal": {"handle": "test"}}})})()) as run, patch("engine.server.subprocess.Popen") as launch:
                    self.analyzer.connection = {"connected": True}
                    result = self.invoke("/api/terminal/open", TerminalPayload(terminal_type=host, purpose="account", provider=provider))
                    self.assertIn(result["status"], ("opened", "launched"))
                    if host == "ORCA":
                        command = run.call_args.args[0]
                        text = command[command.index("--command") + 1]
                    else:
                        command = launch.call_args.args[0]
                        text = base64.b64decode(command[-1]).decode("utf-16le")
                    self.assertIn(executable, text)
                    self.assertNotIn("Write-Host", text)
                    self.assertNotIn("'login'", text)
                    self.assertNotIn("'logout'", text)
                    self.assertNotIn("$LASTEXITCODE", text)
                    self.assertIsNone(self.analyzer.connection["connected"])

    def test_hidden_account_commands_and_agent_are_rejected(self):
        for action in ("interactive", "login", "logout", "switch"):
            with self.assertRaises(ValidationError):
                TerminalPayload(account_action=action)
        with self.assertRaises(ValidationError):
            AiConfigPayload(provider="CODEX", agent="legacy-agent")

    def fill(self, action="BUY", price=1900, contracts=1, execution_id="execution-1", timestamp="09:00:00", **updates):
        return {"status": "filled", "action": action, "price": price, "contracts": contracts, "timestamp": timestamp, "instrument": "VN30F1M", "execution_id": execution_id, "incremental": True, "evidence": "Execution row shows filled quantity, price, time and execution identifier", **updates}

    def test_only_complete_individual_executions_are_automatic(self):
        for updates in ({"status": "intent"}, {"status": "submitted"}, {"status": "cancelled"}, {"status": "unknown"}, {"price": None}, {"contracts": None}, {"execution_id": ""}, {"incremental": False}, {"timestamp": None}, {"evidence": ""}, {"instrument": "OTHER"}):
            candidates = identify_candidates([self.fill(**updates)], "source")
            self.assertEqual(auto_record_candidates(candidates, [], []), [])
        records = auto_record_candidates(identify_candidates([self.fill(contracts=2)], "source"), [], [])
        self.assertEqual(records[0]["contracts"], 2)
        self.assertEqual(records[0]["status"], "confirmed")

    def test_repeated_screenshots_and_excluded_execution_are_not_recounted(self):
        candidate = identify_candidates([self.fill()], "first")
        record = auto_record_candidates(candidate, [], [])[0]
        second = identify_candidates([self.fill()], "second")
        self.assertEqual(auto_record_candidates(second, [{"observed_fills": [record]}], []), [])
        record.update(status="excluded", execution_id="corrected-identifier")
        self.assertEqual(auto_record_candidates(second, [{"observed_fills": [record]}], []), [])

    def test_detection_updates_pairs_and_corrections_rebuild_results(self):
        (self.root / "strategy.md").write_text("User strategy", encoding="utf-8")
        self.invoke("/api/strategy-mode", StrategyModePayload(enabled=True))
        async def observe(trade):
            self.analyzer.connection = {"connected": True}
            result = {"ai_thesis": "Filled execution", "ai_question": "", "ai_error": "", "ai_trade_observations": [trade]}
            with patch.object(self.analyzer, "analyze_event", return_value=result):
                saved = await self.endpoint("/api/observation")(ObservationPayload())
                await asyncio.gather(*(task for task in asyncio.all_tasks() if task is not asyncio.current_task()))
            return saved["event"]
        opening = asyncio.run(observe(self.fill(contracts=3)))
        closing = asyncio.run(observe(self.fill(action="SELL", price=1910, contracts=2, execution_id="execution-2", timestamp="09:01:00")))
        summary = self.status()["summary"]
        self.assertEqual(summary["total_closed_pairs"], 2)
        self.assertEqual(summary["open_longs_count"], 1)
        self.assertEqual(summary["total_fees_points"], 0.9)
        self.assertEqual(summary["total_net_points"], 19.1)
        candidate_id = closing["observed_fills"][0]["id"]
        review = FillReviewPayload(date=closing["date"], session_id=closing["session_id"], candidate_id=candidate_id, decision="confirm", action="SELL", price=1905, contracts=1, timestamp="09:01:00", execution_id="execution-2")
        corrected = asyncio.run(self.endpoint("/api/events/{event_id}/fill")(closing["id"], review))
        self.assertEqual(corrected["summary"]["total_closed_pairs"], 1)
        self.assertEqual(corrected["summary"]["total_net_points"], 4.55)
        self.assertEqual(corrected["summary"]["open_longs_count"], 2)
        self.assertEqual(len(corrected["event"]["fill_review_history"]), 1)
        review.decision = "exclude"
        excluded = asyncio.run(self.endpoint("/api/events/{event_id}/fill")(closing["id"], review))
        self.assertEqual(excluded["summary"]["total_closed_pairs"], 0)
        self.assertEqual(excluded["summary"]["open_longs_count"], 3)
        self.app = create_app(str(self.config))
        self.assertEqual(self.status()["summary"]["open_longs_count"], 3)
        self.assertEqual(self.status()["summary"]["total_closed_pairs"], 0)
        self.assertTrue(opening["observed_fills"])

    def test_failed_fill_write_does_not_change_ledger(self):
        event = self.invoke("/api/observation", ObservationPayload())["event"]
        event["ai_trade_observations"] = identify_candidates([self.fill(execution_id="")], event["id"])
        candidate_id = event["ai_trade_observations"][0]["id"]
        payload = FillReviewPayload(date=event["date"], session_id=event["session_id"], candidate_id=candidate_id, decision="confirm", action="BUY", price=1900, contracts=1, timestamp="09:00:00")
        with patch("engine.core.os.replace", side_effect=OSError("Disk failure")):
            with self.assertRaises(OSError):
                asyncio.run(self.endpoint("/api/events/{event_id}/fill")(event["id"], payload))
        self.assertNotIn("observed_fills", event)
        self.assertEqual(self.status()["summary"]["open_longs_count"], 0)

    def test_recorded_trades_ignore_intent_and_replay_fill_time_order(self):
        events = [{"type": "OBSERVATION", "action": "BUY", "price": 1800}, {"observed_fills": [{**self.fill(action="SELL", timestamp="09:02:00"), "status": "confirmed"}]}, {"observed_fills": [{**self.fill(timestamp="09:01:00"), "status": "confirmed"}, {**self.fill(), "status": "excluded"}]}]
        self.assertEqual([trade["action"] for trade in recorded_trades(events)], ["BUY", "SELL"])


if __name__ == "__main__":
    unittest.main()

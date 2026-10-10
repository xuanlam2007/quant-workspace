import json
import queue
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.codex_audio import AudioRpc, run_codex_audio
from engine.cli_analyzer import CliLearningAnalyzer
from engine.learning_context import build_learning_prompt


class CodexAudioTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.audio = self.root / "original.ogg"
        self.audio.write_bytes(b"OggS-recorded-audio")
        self.image = self.root / "original.png"
        self.image.write_bytes(b"screenshot")
        self.settings = {"provider": "CODEX", "model": "selected-model", "effort": "high"}
        self.client = Mock()
        self.client.rpc.side_effect = [{}, {}, {"config": {"mcp_servers": {"broker": {"enabled": True}}}}, {"thread": {"id": "thread"}}, {"turn": {"id": "turn"}}]
        self.client.next_event.side_effect = [
            {"method": "item/completed", "params": {"threadId": "other-thread", "turnId": "turn", "item": {"type": "agentMessage", "text": "wrong recording"}}},
            {"method": "item/completed", "params": {"threadId": "thread", "turnId": "turn", "item": {"type": "agentMessage", "phase": "final_answer", "text": "transcribed observation"}}},
            {"method": "turn/completed", "params": {"threadId": "thread", "turn": {"id": "turn", "status": "completed"}}},
        ]

    def run_audio(self):
        with patch("engine.codex_audio.AudioRpc", return_value=self.client):
            return run_codex_audio("codex.exe", self.root, "Observe", self.settings, self.audio, self.image, {"type": "object"})

    def test_audio_and_image_use_native_attachments_with_selected_model(self):
        self.assertEqual(self.run_audio(), "transcribed observation")
        calls = {call.args[0]: call.args[1] for call in self.client.rpc.call_args_list}
        thread = calls["thread/start"]
        self.assertEqual(thread["model"], "selected-model")
        self.assertEqual(thread["sandbox"], "read-only")
        self.assertTrue(thread["ephemeral"])
        self.assertEqual(thread["config"]["mcp_servers"], {"broker": {"enabled": False}})
        turn = calls["turn/start"]
        self.assertEqual(turn["effort"], "high")
        self.assertEqual(turn["outputSchema"], {"type": "object"})
        self.assertEqual([item["type"] for item in turn["input"]], ["text", "localAudio", "localImage"])
        self.assertNotIn(str(self.audio), json.dumps(turn))
        self.assertEqual(Path(turn["input"][1]["path"]).read_bytes(), self.audio.read_bytes())
        self.client.close.assert_called_once()

    def test_failed_turn_does_not_accept_partial_transcript(self):
        self.client.next_event.side_effect = [
            {"method": "item/completed", "params": {"threadId": "thread", "turnId": "turn", "item": {"type": "agentMessage", "text": "partial"}}},
            {"method": "turn/completed", "params": {"threadId": "thread", "turn": {"id": "turn", "status": "failed", "error": {"message": "Audio unsupported"}}}},
        ]
        with self.assertRaisesRegex(RuntimeError, "Audio unsupported"):
            self.run_audio()
        self.client.close.assert_called_once()
        self.assertTrue(self.audio.is_file())

    def test_timestamped_frame_sequence_is_sent_with_audio_in_one_turn(self):
        earlier = self.root / "earlier.png"
        earlier.write_bytes(b"earlier chart")
        frames = [{"path": str(earlier), "captured_at": "2026-10-09T08:00:00Z"}, {"path": str(self.image), "captured_at": "2026-10-09T08:00:03Z"}]
        with patch("engine.codex_audio.AudioRpc", return_value=self.client):
            run_codex_audio("codex.exe", self.root, "Observe together", self.settings, self.audio, str(self.image), frames=frames)
        turn = next(call.args[1] for call in self.client.rpc.call_args_list if call.args[0] == "turn/start")
        self.assertEqual(sum(item["type"] == "localAudio" for item in turn["input"]), 1)
        self.assertEqual(sum(item["type"] == "localImage" for item in turn["input"]), 2)
        self.assertIn("2026-10-09T08:00:00Z", json.dumps(turn["input"]))
        self.assertEqual(Path(turn["input"][-1]["path"]).read_bytes(), b"earlier chart")

    def test_unsupported_cli_closes_process_without_another_provider(self):
        self.client.rpc.side_effect = RuntimeError("Method not found")
        with self.assertRaisesRegex(RuntimeError, "Method not found"):
            self.run_audio()
        self.client.close.assert_called_once()

    def test_gateway_auth_failure_stops_before_media_turn(self):
        self.client.rpc.side_effect = [{}, {"required": True, "status": "pending"}]
        with self.assertRaisesRegex(RuntimeError, "login is required"):
            self.run_audio()
        self.assertEqual(self.client.rpc.call_count, 2)
        self.client.close.assert_called_once()

    def test_empty_audio_never_starts_cli(self):
        self.audio.write_bytes(b"")
        with patch("engine.codex_audio.AudioRpc") as rpc:
            with self.assertRaises(ValueError):
                run_codex_audio("codex.exe", self.root, "Observe", self.settings, self.audio)
            rpc.assert_not_called()

    def test_client_refuses_tool_or_account_requests(self):
        client = AudioRpc.__new__(AudioRpc)
        client.messages = queue.Queue()
        client.deadline = time.monotonic() + 5
        client.send = Mock()
        client.messages.put({"id": 88, "method": "item/tool/call", "params": {}})
        with self.assertRaisesRegex(RuntimeError, "outside evidence analysis"):
            client.receive()
        self.assertEqual(client.send.call_args.args[0]["error"]["code"], -32601)

    def test_both_providers_observe_audio_without_strategy_and_return_transcripts(self):
        for provider in ("CODEX", "AGY"):
            with self.subTest(provider=provider):
                analyzer = CliLearningAnalyzer({"provider": provider})
                analyzer.connection = {"connected": True}
                response = {"observation": "Evidence", "question": "", "strategy_difference": True, "evidence_limitations": "", "transcript": "Tôi đang chờ", "trade_observations": []}
                with patch.object(analyzer, "_run", return_value=json.dumps(response)) as run:
                    result = analyzer.analyze_event(None, str(self.audio), {"strategy": {"enabled": False}})
                self.assertEqual(result["ai_transcript"], "Tôi đang chờ")
                self.assertFalse(result["ai_strategy_difference"])
                self.assertEqual(run.call_args.kwargs["audio"], str(self.audio))
                self.assertIn("Never infer an execution from speech alone", run.call_args.args[0])

    def test_codex_audio_routes_to_app_server_not_text_exec(self):
        analyzer = CliLearningAnalyzer(self.settings)
        with patch("engine.cli_analyzer.find_cli", return_value="codex.exe"), patch("engine.cli_analyzer.run_codex_audio", return_value="response") as audio, patch("engine.cli_analyzer.run_cli") as text:
            self.assertEqual(analyzer._run("Observe", self.settings, audio=self.audio), "response")
        audio.assert_called_once()
        text.assert_not_called()

    def test_audio_retry_does_not_recycle_previous_transcript(self):
        prompt = build_learning_prompt({"ai_transcript": "OLD_TRANSCRIPT"}, audio=True)
        self.assertNotIn("OLD_TRANSCRIPT", prompt)
        self.assertNotIn("text only", prompt)
        self.assertIn("No screenshot is supplied", prompt)

    def test_account_change_during_audio_discards_result(self):
        analyzer = CliLearningAnalyzer(self.settings)
        analyzer.connection = {"connected": True}
        def changed(*args, **kwargs):
            analyzer.invalidate()
            return "{}"
        with patch.object(analyzer, "_run", side_effect=changed):
            result = analyzer.analyze_event(None, str(self.audio), {})
        self.assertIn("account changed during analysis", result["ai_error"])
        self.assertNotIn("ai_transcript", result)

    def test_connection_lock_does_not_fail_a_valid_observation_as_busy(self):
        analyzer = CliLearningAnalyzer(self.settings)
        analyzer.connection = {"connected": True}
        analyzer._lock = Mock()
        response = json.dumps({"observation": "Recorded evidence", "question": "", "strategy_difference": False, "evidence_limitations": "", "transcript": "Đang chờ xác nhận", "trade_observations": []})
        with patch.object(analyzer, "_run", return_value=response) as run:
            result = analyzer.analyze_event(None, str(self.audio), {})
        run.assert_called_once()
        self.assertEqual(result["ai_error"], "")
        analyzer._lock.acquire.assert_called_once_with()
        analyzer._lock.release.assert_called_once()

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import Depends, FastAPI
from pydantic import ValidationError
from engine.cli_process import cli_environment
from engine.request_security import StrictRequest, empty_body, install_request_security
from engine import server
from engine.observed_trades import FillReviewPayload
from engine.backtest_bridge import BacktestFrame


class PayloadTests(unittest.TestCase):
    def test_every_input_model_forbids_unknown_fields(self):
        models = [value for value in vars(server).values() if isinstance(value, type) and issubclass(value, StrictRequest)]
        models += [FillReviewPayload, BacktestFrame]
        for model in models:
            with self.subTest(model=model.__name__):
                self.assertFalse(model.model_json_schema()["additionalProperties"])
                with self.assertRaises(ValidationError) as error:
                    model.model_validate({"ai_pending": True, "frame_path": "private/file", "strategy": {"enabled": True}})
                self.assertTrue(any(item["type"] == "extra_forbidden" for item in error.exception.errors()))

    def test_nested_drawing_fields_and_server_owned_title_are_rejected(self):
        with self.assertRaises(ValidationError):
            server.DrawingEventPayload(type="DRAWING", source_id="source", drawing_data={"tool": "TrendLine", "points": [{"timestamp": 1, "price": 1900, "strategy": {}}]})
        with self.assertRaises(ValidationError):
            server.ModePayload(mode="IN_APP", target_window_title="forged")

    def test_boolean_and_numeric_inputs_do_not_coerce_strings(self):
        for model, payload in [(server.StrategyModePayload, {"enabled": "false"}), (server.RecordingPayload, {"action": "start", "capture_generation": "1"}), (server.TradeEventPayload, {"action": "BUY", "price": "1900"})]:
            with self.subTest(model=model.__name__), self.assertRaises(ValidationError):
                model.model_validate(payload)

    def test_cli_receives_provider_credentials_but_not_application_secrets(self):
        with patch.dict("os.environ", {"QUANT_ENGINE_TOKEN": "private", "MARKET_DATA_API_TOKEN": "private", "OPENAI_API_KEY": "provider", "PATH": "system"}, clear=True):
            self.assertEqual(cli_environment(), {"OPENAI_API_KEY": "provider", "PATH": "system"})


class BoundaryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        with patch.dict("os.environ", {"QUANT_ENGINE_TOKEN": "a" * 64}):
            self.app = FastAPI()
            install_request_security(self.app)
        self.calls = 0

        @self.app.post("/api/strategy")
        def strategy(payload: server.StrategyModePayload):
            self.calls += 1
            return payload.model_dump()

        @self.app.post("/api/empty", dependencies=[Depends(empty_body)])
        def empty():
            self.calls += 1
            return {"ok": True}

    async def request(self, path, data, token="a" * 64, origin="http://localhost:3000", content_type="application/json"):
        messages = []
        finished = asyncio.Event()
        consumed = False
        scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1", "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "server": ("127.0.0.1", 8765), "client": ("127.0.0.1", 1234), "headers": [(b"host", b"127.0.0.1:8765"), (b"origin", origin.encode()), (b"x-quant-engine-token", token.encode()), (b"content-type", content_type.encode())]}
        async def receive():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": data, "more_body": False}
            await finished.wait()
            return {"type": "http.disconnect"}
        async def send(message):
            messages.append(message)
            if message["type"] == "http.response.body" and not message.get("more_body"):
                finished.set()
        await asyncio.wait_for(self.app(scope, receive, send), timeout=3)
        status = next(message["status"] for message in messages if message["type"] == "http.response.start")
        body = b"".join(message.get("body", b"") for message in messages)
        return status, body

    async def test_valid_body_reaches_handler(self):
        status, body = await self.request("/api/strategy", b'{"enabled":false}')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"enabled": False})
        self.assertEqual(self.calls, 1)

    async def test_unknown_fields_fail_before_side_effects_and_are_not_echoed(self):
        status, body = await self.request("/api/strategy", b'{"enabled":true,"secret":"PRIVATE_VALUE"}')
        self.assertEqual(status, 422)
        self.assertNotIn(b"PRIVATE_VALUE", body)
        self.assertEqual(self.calls, 0)

    async def test_authentication_origin_and_content_type_reject_before_handlers(self):
        for kwargs, expected in [({"token": "wrong"}, 403), ({"origin": "https://attacker.invalid"}, 403), ({"content_type": "text/plain"}, 415)]:
            with self.subTest(kwargs=kwargs):
                status, _ = await self.request("/api/strategy", b'{"enabled":true}', **kwargs)
                self.assertEqual(status, expected)
        self.assertEqual(self.calls, 0)

    async def test_empty_routes_reject_injection_null_and_malformed_json(self):
        for data in [b'{"provider":"CODEX"}', b'null', b'[]', b'{']:
            with self.subTest(data=data):
                status, _ = await self.request("/api/empty", data)
                self.assertEqual(status, 422)
        for data in [b'', b'{}']:
            status, _ = await self.request("/api/empty", data)
            self.assertEqual(status, 200)
        self.assertEqual(self.calls, 2)

    async def test_oversized_stream_is_rejected(self):
        with patch("engine.request_security.MAX_BODY_BYTES", 8):
            status, _ = await self.request("/api/strategy", b'{"enabled":true}')
        self.assertEqual(status, 413)
        self.assertEqual(self.calls, 0)

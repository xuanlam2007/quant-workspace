"""Request-scoped native chart tools, reachable only through a local capability."""
import hmac
import hashlib
import base64
import json
import secrets
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pydantic import Field, ValidationError
from .request_security import StrictRequest
from .backtest_timing import REQUEST_LIFETIME, COMMAND_ACK_TIMEOUT


class Empty(StrictRequest):
    pass


class ReadChart(StrictRequest):
    after_time: int = Field(default=-1, ge=-1)
    limit: int = Field(default=60, ge=1, le=2000)
    compact: bool = False


class ReadCatalog(StrictRequest):
    indicator_name: str = Field(default="", max_length=100)


class ToolCall(StrictRequest):
    name: str = Field(max_length=80)
    arguments: dict


class QuantOperationError(ValueError):
    codes = frozenset(("ack_timeout", "chart_apply_failed", "chart_frame_changed", "order_rejected", "capture_failed", "chart_rejected"))

    def __init__(self, code):
        self.code = code if code in self.codes else "chart_rejected"
        super().__init__(self.code)


class QuantSessionError(ValueError):
    messages = {
        "session_closed": "Replay session was closed or reset",
        "request_expired": "Replay request expired",
        "configuration_changed": "Replay configuration changed",
        "chart_not_read": "AI must read the chart through Quant MCP before completing analysis",
        "command_pending": "A chart command is still awaiting acknowledgement",
        "unacknowledged_actions": "Chart changes and paper orders must use acknowledged Quant tools",
        "setup_drawing_missing": "Use apply_chart to establish a drawing before finishing or trading",
        "setup_indicator_unready": "Use apply_chart to establish an indicator before finishing or trading",
    }

    def __init__(self, code):
        self.code = code
        super().__init__(self.messages[code])


def inline_tool_schema(model):
    schema = model.model_json_schema()
    definitions = schema.get("$defs", {})

    def expand(value, resolving=()):
        if isinstance(value, list):
            return [expand(item, resolving) for item in value]
        if not isinstance(value, dict):
            return value
        reference = value.get("$ref")
        if reference:
            name = reference.removeprefix("#/$defs/")
            if reference != "#/$defs/" + name or name not in definitions or name in resolving:
                raise ValueError("Unsupported Quant schema reference")
            return {**expand(definitions[name], (*resolving, name)), **{key: expand(item, resolving) for key, item in value.items() if key != "$ref"}}
        return {key: expand(item, resolving) for key, item in value.items() if key != "$defs"}

    # Client MCP nhận trực tiếp field lồng nhau, không cần đọc file để tra $defs.
    return expand(schema)


class QuantTools:
    def __init__(self, frame, is_current, on_tool=None):
        from .backtest_bridge import BacktestDecision, ReplayDrawing, ReplayIndicator, CHART_TOOLS

        class ApplyChart(StrictRequest):
            drawings: list[ReplayDrawing] = Field(default_factory=list, max_length=30)
            indicators: list[ReplayIndicator] = Field(default_factory=list, max_length=10)

        class SubmitOrder(StrictRequest):
            action: str
            order_type: str
            stop_price: float | None = Field(gt=0, allow_inf_nan=False)
            limit_price: float | None = Field(gt=0, allow_inf_nan=False)
            reason: str = Field(max_length=6000)

        self.models = {"get_chart_state": ReadChart, "get_account_state": Empty,
                       "get_chart_catalog": ReadCatalog, "capture_chart": Empty,
                       "apply_chart": ApplyChart, "submit_order": SubmitOrder}
        self.decision_model = BacktestDecision
        self.catalog = CHART_TOOLS
        self.frame = frame
        self.owner = frame.client_id
        self.is_current = is_current
        self.condition = threading.Condition()
        self.pending = None
        self.response = None
        self.closed = False
        self.calls = 0
        self.started = time.monotonic()
        # Session sống qua deadline của CLI để nhận kết quả và dọn tiến trình.
        self.deadline = self.started + REQUEST_LIFETIME
        self.order_applied = False
        self.order_attempted = False
        self.chart_read = False
        self.on_tool = on_tool
        self.activity = None
        self.acknowledgements = {}

    def check(self):
        if self.closed:
            raise QuantSessionError("session_closed")
        if time.monotonic() >= self.deadline:
            raise QuantSessionError("request_expired")
        if not self.is_current():
            raise QuantSessionError("configuration_changed")

    def complete(self, output):
        with self.condition:
            self.check()
            if not self.chart_read:
                raise QuantSessionError("chart_not_read")
            if self.pending:
                raise QuantSessionError("command_pending")
            if self.order_attempted:
                output = {**output, "action": "HOLD", "drawings": [], "indicators": []}
            result = self.decision_model.model_validate(output)
            if result.action != "HOLD" or result.drawings or result.indicators:
                raise QuantSessionError("unacknowledged_actions")
            self.check_chart_setup()
            return result.model_dump()

    def check_chart_setup(self):
        if not self.frame.drawings:
            raise QuantSessionError("setup_drawing_missing")
        if not any(indicator.visible and indicator.operation == "upsert" and indicator.name != "Volume" and indicator.status not in ("loading", "error") for indicator in self.frame.indicators):
            raise QuantSessionError("setup_indicator_unready")

    def chart_setup_example(self):
        if not self.frame.bars:
            return None
        drawings = [] if self.frame.drawings else [next(item for item in self.drawing_examples() if item["tool"] == "PriceNote")]
        indicators = [] if any(item.visible and item.operation == "upsert" and item.name != "Volume" and item.status not in ("loading", "error") for item in self.frame.indicators) else [{"id": "ai_trend_ma", "name": "Moving Average", "inputs": [], "visible": True, "operation": "upsert"}]
        if not drawings and not indicators:
            return None
        # Example giữ đủ field bắt buộc và được kiểm tra bằng schema thực thi.
        return self.models["apply_chart"].model_validate({"drawings": drawings, "indicators": indicators}).model_dump()

    def drawing_examples(self):
        bar = self.frame.bars[-1]
        first = self.frame.bars[0]
        anchors = [{"timestamp": first.time, "price": first.close}, {"timestamp": bar.time, "price": bar.close}, {"timestamp": bar.time, "price": bar.high}]
        # Mẫu chỉ mô tả schema, AI phải chọn mức giá theo bằng chứng hiện tại.
        return [{"id": "ai_" + name.lower(), "tool": name, "points": [anchors[1]] if count == 1 else anchors[:count], "label": "Thay bằng ghi chú theo bằng chứng"} for name, count in self.catalog["drawings"].items()]

    def definitions(self):
        descriptions = {
            "get_chart_state": "Read revealed M1 candles, drawings and calculated indicator values once per analysis. Use returned setup examples and acknowledgments instead of repeated reads. compact=true returns exact OHLCV rows with bar_columns. after_time is exclusive. No future data.",
            "get_account_state": "Read the current paper position and orders. No real account access.",
            "get_chart_catalog": "List drawing tools and indicator names, or exact inputs for one indicator_name.",
            "capture_chart": "Capture the current chart canvas only. No toolbar, desktop or browser chrome.",
            "apply_chart": "Apply native drawings and AI-owned indicators. Each drawing has exactly id, tool, points and label; tool is the catalog drawing name, not a type field. Points have timestamp and price. Returns actual calculated values after application. Anchors must precede current cutoff.",
            "submit_order": "Submit a simulated order at receipt replay time. CLOSE closes position; CANCEL cancels pending orders. Respect user order toggle. Never resend an acknowledged order. Return final HOLD after using this tool.",
        }
        tools = []
        for name, model in self.models.items():
            schema = inline_tool_schema(model)
            if name == "submit_order":
                schema["properties"]["action"]["enum"] = ["OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL"]
                schema["properties"]["order_type"]["enum"] = ["MARKET", "LIMIT", "STOP_LIMIT"]
            readonly = name in ("get_chart_state", "get_account_state", "get_chart_catalog", "capture_chart")
            tools.append({"name": name, "description": descriptions[name], "inputSchema": schema, "annotations": {"readOnlyHint": readonly, "destructiveHint": False, "idempotentHint": readonly, "openWorldHint": False}})
        return tools

    def reuse_indicators(self, indicators):
        def signature(item):
            definition = next(entry for entry in self.catalog["indicators"] if entry["name"] == item["name"])
            inputs = {entry["id"]: entry["default"] for entry in definition["inputs"] if "default" in entry}
            inputs.update({entry["id"]: entry["value"] for entry in item["inputs"]})
            return item["name"], inputs, item["visible"]

        existing = [item.model_dump() for item in self.frame.indicators]
        result = []
        for item in indicators:
            if item["operation"] == "remove":
                result.append(item)
                existing = [entry for entry in existing if entry["id"] not in (item["id"], "ai-" + item["id"])]
                continue
            # Bỏ upsert trùng cấu hình, giữ chỉ báo khác chu kỳ và chỉ báo của người dùng.
            if any(entry["operation"] == "upsert" and entry.get("status", "ready") not in ("error", "loading") and signature(entry) == signature(item) for entry in existing):
                continue
            result.append(item)
            existing = [entry for entry in existing if entry["id"] not in (item["id"], "ai-" + item["id"])]
            existing.append(item)
        return result

    def update(self, frame):
        self.check()
        if frame.replay_id != self.frame.replay_id or frame.client_id != self.owner or frame.symbol != self.frame.symbol or frame.granularity != self.frame.granularity or frame.cutoff < self.frame.cutoff:
            raise ValueError("Replay ownership or timeline changed")
        self.frame = frame

    def sync(self, frame, wait=0):
        with self.condition:
            self.update(frame)
            if not self.pending and wait:
                self.condition.wait_for(lambda: self.pending is not None or self.closed, timeout=min(max(wait, 0), .4))
                self.check()
            return {"command": self.pending, "activity": self.activity, "acknowledged": list(self.acknowledgements)}

    def ack(self, command_id, frame, error):
        with self.condition:
            self.check()
            signature = hashlib.sha256(json.dumps({"frame": frame.model_dump(), "error": error}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            if command_id in self.acknowledgements:
                if self.acknowledgements[command_id] != signature:
                    raise ValueError("Acknowledgement payload changed")
                return {"ok": True}
            if not self.pending or self.pending["id"] != command_id:
                raise ValueError("Unknown or already acknowledged command")
            if self.pending["name"] == "capture_chart" and not error:
                parts = frame.image.split(",", 1)
                if len(parts) != 2 or parts[0] != "data:image/png;base64":
                    raise ValueError("Invalid chart image")
                image = base64.b64decode(parts[1], validate=True)
                if len(image) < 24 or len(image) > 8 * 1024 * 1024 or not image.startswith(b"\x89PNG\r\n\x1a\n") or not all(1 <= int.from_bytes(image[offset:offset + 4], "big") <= 8192 for offset in (16, 20)):
                    raise ValueError("Invalid chart image")
            if frame.replay_id != self.frame.replay_id or frame.client_id != self.owner or frame.symbol != self.frame.symbol or frame.granularity != self.frame.granularity or frame.cutoff < self.pending["cutoff"]:
                raise ValueError("Acknowledgement ownership or timeline changed")
            # ACK trễ giữ nguyên kết quả thao tác, không ghi đè frame replay mới hơn.
            if frame.cutoff >= self.frame.cutoff:
                self.update(frame)
            self.response = {"error": error, "frame": frame}
            self.acknowledgements[command_id] = signature
            if self.pending["name"] == "submit_order" and not error:
                self.order_applied = True
            self.pending = None
            self.condition.notify_all()
            return {"ok": True}

    def close(self):
        with self.condition:
            self.closed = True
            self.pending = None
            self.condition.notify_all()

    def call(self, name, arguments):
        return self.call_request({"name": name, "arguments": arguments})

    def call_request(self, payload):
        with self.condition:
            self.check()
            # Mọi attempt có capability hợp lệ đều dùng budget, kể cả payload sai schema.
            self.calls += 1
            if self.calls > 20:
                raise ValueError("Quant tool budget exceeded")
            request = ToolCall.model_validate_json(payload) if isinstance(payload, (str, bytes)) else ToolCall.model_validate(payload)
            name, arguments = request.name, request.arguments
            if name not in self.models:
                raise ValueError("Unknown Quant tool")
            args = self.models[name].model_validate(arguments).model_dump()
            if self.on_tool:
                self.on_tool(name)
            sequence = self.calls
            self.activity = {"sequence": sequence, "tool": name, "state": "ACTIVE"}
            try:
                result = self._execute(name, args)
            except Exception:
                self.activity = {"sequence": sequence, "tool": name, "state": "ERROR"}
                raise
            self.activity = {"sequence": sequence, "tool": name, "state": "DONE"}
            return result

    def _execute(self, name, args):
        with self.condition:
            if name == "get_chart_catalog":
                if args["indicator_name"]:
                    definition = next((item for item in self.catalog["indicators"] if item["name"] == args["indicator_name"]), None)
                    if definition is None:
                        raise ValueError("Unknown indicator")
                    return definition
                result = {"drawings": self.catalog["drawings"], "indicators": [item["name"] for item in self.catalog["indicators"]]}
                result["drawing_examples"] = self.drawing_examples()
                if self.frame.bars:
                    bar = self.frame.model_dump()["bars"][-1]
                    result["drawing_example"] = {"id": "reference_level", "tool": "HorizontalLine", "points": [{"timestamp": bar["time"], "price": bar["close"]}], "label": "Reference level"}
                return result
            if name == "get_chart_state":
                data = self.frame.model_dump(exclude={"client_id", "replay_id", "image", "history", "teaching", "orders", "position"})
                data["drawing_tools"] = self.catalog["drawings"]
                if not any(item.tool in ("PriceNote", "PriceLabel", "Callout") and item.label.strip() for item in self.frame.drawings):
                    data["price_note_example"] = next(item for item in self.drawing_examples() if item["tool"] == "PriceNote")
                data["bars"] = [bar for bar in data["bars"] if bar["time"] > args["after_time"]][-args["limit"]:]
                if args["compact"]:
                    columns = ["time", "open", "high", "low", "close", "volume"]
                    data["bars"] = [[bar[key] for key in columns] for bar in data["bars"]]
                    data["bar_columns"] = columns
                example = self.chart_setup_example()
                if example:
                    data["apply_chart_example"] = example
                self.chart_read = True
                return data
            if name == "get_account_state":
                state = self.frame.model_dump()
                actions = ["CANCEL"] if any(item["status"] in ("waiting", "triggered") for item in state["orders"]) else ["CLOSE"] if state["position"] else ["OPEN_LONG", "OPEN_SHORT"]
                examples = [{"action": action, "order_type": "MARKET", "stop_price": None, "limit_price": None, "reason": "Thay bằng căn cứ giao dịch hiện tại"} for action in actions]
                return {"cutoff": self.frame.cutoff, "position": state["position"], "orders": state["orders"], "submit_order_examples": examples, "examples_are_signals": False}
            if self.pending:
                raise ValueError("Another chart command is awaiting acknowledgement")
            if name == "apply_chart" and any(point["timestamp"] >= self.frame.cutoff for drawing in args["drawings"] for point in drawing["points"]):
                raise ValueError("Drawing anchor is outside the replay cutoff")
            if name == "apply_chart":
                had_indicators = bool(args["indicators"])
                args["indicators"] = self.reuse_indicators(args["indicators"])
                if had_indicators and not args["drawings"] and not args["indicators"]:
                    state = self.frame.model_dump()
                    return {"cutoff": self.frame.cutoff, "indicators": state["indicators"], "position": state["position"], "orders": state["orders"], "unchanged": True}
            if name == "submit_order":
                self.check_chart_setup()
                if self.order_attempted:
                    raise ValueError("Only one order attempt per analysis; read account state and wait for the next analysis")
                if args["action"] == "HOLD":
                    raise ValueError("submit_order requires a trading action")
                args = self.decision_model.model_validate({**args, "question": "", "drawings": [], "indicators": []}).model_dump()
                self.order_attempted = True
            state = self.frame.model_dump()
            self.pending = {"id": str(uuid.uuid4()), "name": name, "arguments": args,
                            "cutoff": self.frame.cutoff, "position": state["position"], "orders": state["orders"]}
            self.response = None
            self.condition.notify_all()
            deadline = min(self.deadline, time.monotonic() + COMMAND_ACK_TIMEOUT)
            while self.response is None:
                self.check()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.close()
                    raise QuantOperationError("ack_timeout")
                self.condition.wait(min(remaining, .5))
            response = self.response
            if response["error"]:
                raise QuantOperationError(response["error"])
            frame = response["frame"]
            if name == "capture_chart":
                if not frame.image.startswith("data:image/png;base64,"):
                    raise ValueError("Chart capture is not available")
                return {"image": frame.image.split(",", 1)[1], "cutoff": frame.cutoff}
            return {"cutoff": frame.cutoff, "indicators": frame.model_dump()["indicators"], "position": frame.model_dump()["position"], "orders": frame.model_dump()["orders"]}


@contextmanager
def serve_tools(tools):
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            self.connection.settimeout(30)
            valid = self.path in ("/tools", "/call") and not self.headers.get("Origin") and self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}" and hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 256000:
                    self.send_error(403)
                    return
                # Đọc body giới hạn trước khi trả 403 để tránh TCP reset trên Windows.
                raw = self.rfile.read(length)
                if not valid:
                    self.send_error(403)
                    return
                if self.path == "/tools":
                    Empty.model_validate_json(raw)
                    tools.check()
                    result = {"tools": tools.definitions()}
                else:
                    result = {"data": tools.call_request(raw)}
                output = json.dumps(result, ensure_ascii=False, allow_nan=False).encode()
                self.send_response(200)
            except ValidationError as error:
                known = {"name", "arguments", "after_time", "limit", "compact", "indicator_name", "drawings", "indicators", "id", "tool", "points", "timestamp", "price", "label", "inputs", "visible", "operation", "value", "action", "order_type", "stop_price", "limit_price", "reason"}
                errors = error.errors(include_url=False, include_context=False, include_input=False)[:6]
                fields = [".".join(str(part) if isinstance(part, int) or part in known else "redacted" for part in item["loc"]) for item in errors]
                allowed_codes = {"missing", "extra_forbidden", "list_type", "dict_type", "bool_type", "int_type", "float_type", "string_type", "literal_error", "string_pattern_mismatch", "value_error"}
                issues = [{"field": field, "code": item["type"] if item["type"] in allowed_codes else "invalid_value"} for field, item in zip(fields, errors)]
                # Chỉ trả tên field schema, không trả input hoặc thông báo chứa giá trị riêng.
                output = json.dumps({"error": "invalid_arguments", "fields": fields, "issues": issues}).encode()
                self.send_response(422)
            except QuantOperationError as error:
                output = json.dumps({"error": "operation_failed", "code": error.code}).encode()
                self.send_response(422)
            except Exception:
                output = b'{"error":"Quant tool rejected, stale request or invalid arguments"}'
                self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(output)))
            self.end_headers()
            self.wfile.write(output)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield {"QUANT_MCP_PORT": str(server.server_port), "QUANT_MCP_CAPABILITY": token}
    finally:
        tools.close()
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)

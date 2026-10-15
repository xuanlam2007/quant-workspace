import asyncio
import base64
import binascii
import importlib.util
import json
import math
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Literal
from fastapi import HTTPException
from pydantic import Field, model_validator
from .request_security import StrictRequest
from .backtest_strategy import load_backtest_documents
from .cli_diagnostics import CliRequestError
from .backtest_mcp import QuantTools, QuantOperationError, QuantSessionError, serve_tools
from .backtest_timing import ANALYSIS_TIMEOUT

CHART_TOOLS = json.loads((Path(__file__).resolve().parents[3] / "lib" / "backtest-chart-tools.json").read_text(encoding="utf-8"))


class StrictModel(StrictRequest):
    pass


class ReplayBar(StrictModel):
    time: int = Field(ge=0)
    open: float = Field(gt=0, allow_inf_nan=False)
    high: float = Field(gt=0, allow_inf_nan=False)
    low: float = Field(gt=0, allow_inf_nan=False)
    close: float = Field(gt=0, allow_inf_nan=False)
    volume: float = Field(ge=0, allow_inf_nan=False)


class DrawingPoint(StrictModel):
    timestamp: int = Field(ge=0)
    price: float = Field(gt=0, allow_inf_nan=False)


class ReplayDrawing(StrictModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    tool: Literal["TrendLine", "Arrow", "Ray", "ExtendedLine", "HorizontalLine", "HorizontalRay", "VerticalLine", "CrossLine", "Rectangle", "FibRetracement", "Text", "Callout", "PriceLabel", "PriceNote", "PriceRange", "LongShortPosition"]
    points: list[DrawingPoint] = Field(min_length=1, max_length=3)
    label: str = Field(max_length=160)

    @model_validator(mode="after")
    def point_count(self):
        if len(self.points) != CHART_TOOLS["drawings"][self.tool]:
            raise ValueError("Drawing point count does not match its tool")
        return self


class IndicatorInput(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    value: str | float | bool = Field(union_mode="smart")


class ReplayIndicator(StrictModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=100, json_schema_extra={"enum": [entry["name"] for entry in CHART_TOOLS["indicators"]]})
    inputs: list[IndicatorInput] = Field(max_length=30)
    visible: bool
    operation: Literal["upsert", "remove"]

    @model_validator(mode="after")
    def registered_inputs(self):
        definition = next((entry for entry in CHART_TOOLS["indicators"] if entry["name"] == self.name), None)
        if definition is None:
            raise ValueError("Unknown replay indicator")
        seen = set()
        for item in self.inputs:
            spec = next((entry for entry in definition["inputs"] if entry["id"] == item.id), None)
            if spec is None or item.id in seen:
                raise ValueError("Unknown or duplicate indicator input")
            seen.add(item.id)
            value = item.value
            kind = spec["type"]
            if kind in ("integer", "float", "time"):
                if type(value) not in (int, float) or not math.isfinite(value) or kind != "float" and value != int(value) or "min" in spec and value < spec["min"] or "max" in spec and value > spec["max"]:
                    raise ValueError("Invalid numeric indicator input")
            elif kind == "bool":
                if type(value) is not bool:
                    raise ValueError("Invalid boolean indicator input")
            elif not isinstance(value, str) or len(value) > 160:
                raise ValueError("Invalid text indicator input")
            if "options" in spec and value not in spec["options"]:
                raise ValueError("Invalid indicator input option")
        return self


class ReplayIndicatorState(ReplayIndicator):
    status: Literal["ready", "loading", "error"] | None = None
    error: str = Field(default="", max_length=200)
    values: list["IndicatorValues"] = Field(default_factory=list, max_length=30)


class IndicatorValues(StrictModel):
    time: int = Field(ge=0)
    values: dict[str, float] = Field(max_length=100)

    @model_validator(mode="after")
    def finite_values(self):
        if any(len(key) > 80 or not math.isfinite(value) for key, value in self.values.items()):
            raise ValueError("Invalid indicator values")
        return self


class BacktestDecision(StrictModel):
    action: Literal["HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL"]
    order_type: Literal["MARKET", "LIMIT", "STOP_LIMIT"]
    stop_price: float | None = Field(gt=0, allow_inf_nan=False)
    limit_price: float | None = Field(gt=0, allow_inf_nan=False)
    reason: str = Field(max_length=6000)
    question: str = Field(max_length=2000)
    drawings: list[ReplayDrawing] = Field(max_length=30)
    indicators: list[ReplayIndicator] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def order_prices(self):
        if self.action not in ("HOLD", "CANCEL"):
            if self.order_type != "MARKET" and self.limit_price is None:
                raise ValueError("Limit price is required")
            if self.order_type == "STOP_LIMIT" and self.stop_price is None:
                raise ValueError("Stop trigger is required")
        return self


class ReplayPosition(StrictModel):
    side: Literal["LONG", "SHORT"]
    price: float = Field(gt=0, allow_inf_nan=False)
    time: int = Field(ge=0)
    quantity: int | None = Field(default=None, ge=1, le=1000)


class ReplayTrailing(StrictModel):
    amount: float = Field(gt=0, allow_inf_nan=False)
    spread: float = Field(ge=0, allow_inf_nan=False)
    anchor: float = Field(gt=0, allow_inf_nan=False)


class ReplayBracket(StrictModel):
    stopTrigger: float = Field(gt=0, allow_inf_nan=False)
    stopLimit: float = Field(gt=0, allow_inf_nan=False)
    takeTrigger: float = Field(gt=0, allow_inf_nan=False)
    takeLimit: float = Field(gt=0, allow_inf_nan=False)


class ReplayOrder(StrictModel):
    id: str = Field(max_length=80)
    side: Literal["BUY", "SELL"]
    purpose: Literal["OPEN", "CLOSE"]
    type: Literal["MARKET", "LIMIT", "STOP_LIMIT"]
    stop: float | None = Field(gt=0, allow_inf_nan=False)
    limit: float | None = Field(gt=0, allow_inf_nan=False)
    submitted: int = Field(ge=0)
    triggered: int | None = Field(ge=0)
    status: Literal["waiting", "triggered", "filled", "cancelled"]
    filled: int | None = Field(ge=0)
    price: float | None = Field(gt=0, allow_inf_nan=False)
    quantity: int | None = Field(default=None, ge=1, le=1000)
    strategy: Literal["normal", "stop", "trailing", "oco"] | None = None
    relation: Literal["gte", "lte"] | None = None
    expires: int | None = Field(default=None, ge=0)
    trailing: ReplayTrailing | None = None
    bracket: ReplayBracket | None = None
    parent: str | None = Field(default=None, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    group: str | None = Field(default=None, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")


class ReplayHistory(StrictModel):
    cutoff: int = Field(ge=0)
    action: Literal["HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL"]
    reason: str = Field(max_length=6000)


class BacktestFrame(StrictModel):
    client_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    replay_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    symbol: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_.-]+$")
    cutoff: int = Field(ge=0)
    granularity: Literal["1s", "1m"]
    bars: list[ReplayBar] = Field(min_length=1, max_length=2000)
    image: str = Field(max_length=12 * 1024 * 1024)
    drawings: list[ReplayDrawing] = Field(max_length=100)
    indicators: list[ReplayIndicatorState] = Field(default_factory=list, max_length=30)
    position: ReplayPosition | None
    orders: list[ReplayOrder] = Field(max_length=300)
    teaching: str = Field(max_length=6000)
    history: list[ReplayHistory] = Field(max_length=20)

    @model_validator(mode="after")
    def visible_data_only(self):
        if any(point.time >= self.cutoff for indicator in self.indicators for point in indicator.values):
            raise ValueError("Indicator values are outside the replay cutoff")
        previous = -1
        for bar in self.bars:
            if bar.time % 60 or bar.time <= previous or bar.time >= self.cutoff:
                raise ValueError("Only ordered visible M1 bars are allowed")
            if self.granularity == "1m" and bar.time + 60 > self.cutoff:
                raise ValueError("Historical M1 cannot reveal an unfinished candle")
            if bar.high < max(bar.open, bar.close) or bar.low > min(bar.open, bar.close):
                raise ValueError("Invalid candle range")
            previous = bar.time
        if any(point.timestamp >= self.cutoff for drawing in self.drawings for point in drawing.points):
            raise ValueError("Drawing anchor is outside the replay cutoff")
        if self.position and self.position.time > self.cutoff:
            raise ValueError("Position is outside the replay cutoff")
        if any(time > self.cutoff for order in self.orders for time in (order.submitted, order.triggered, order.filled) if time is not None):
            raise ValueError("Order is outside the replay cutoff")
        if any(item.cutoff > self.cutoff for item in self.history):
            raise ValueError("Prior decision is outside the replay cutoff")
        return self


class ToolOwner(StrictModel):
    client_id: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class ToolSync(ToolOwner):
    frame: BacktestFrame


class ToolAck(ToolSync):
    command_id: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    error: str = Field(max_length=200)


def register_backtest(app, analyzer, config, config_path):
    root = Path(__file__).resolve().parents[3]
    adapter = root / "private" / "backtest" / "runner.py"
    if not adapter.is_file():
        adapter = Path(__file__).with_name("backtest_agent.py")
    busy = asyncio.Lock()
    active_tools = {"session": None}
    completed_results = {}
    result_lock = threading.RLock()

    @app.post("/api/backtest/tools/sync")
    def tool_sync(payload: ToolSync):
        with result_lock:
            record = completed_results.get(payload.client_id)
            if record and (record["result"] is not None or record.get("acknowledged")):
                current, errors = strategy_documents()
                valid = not record.get("cancelled") and record["expires"] > time.monotonic() and record["revision"] == analyzer._catalog_revision and record["settings"] == analyzer.settings and analyzer.connection.get("connected") and record["hashes"] == [item["sha256"] for item in current] and record["errors"] == errors
                frame_matches = payload.frame.client_id == payload.client_id and payload.frame.replay_id == record["replay_id"] and payload.frame.symbol == record["symbol"] and payload.frame.granularity == record["granularity"] and payload.frame.cutoff >= record["cutoff"]
                if not valid:
                    completed_results.pop(payload.client_id, None)
                    raise HTTPException(409, "Kết quả AI đã hết hạn hoặc cấu hình đã thay đổi.")
                if not frame_matches:
                    raise HTTPException(409, "Kết quả AI không thuộc khung replay này.")
                return {"command": None, **({"analysis": record["result"]} if record["result"] is not None else {}), **({"acknowledged": record["acknowledged"]} if record.get("acknowledged") else {})}
        tools = active_tools["session"]
        if tools is None or tools.owner != payload.client_id:
            time.sleep(.4)
            return {"command": None}
        try:
            return tools.sync(payload.frame, wait=.4)
        except ValueError:
            tools.close()
            raise HTTPException(409, "Replay MCP request expired") from None

    @app.post("/api/backtest/tools/ack")
    def tool_ack(payload: ToolAck):
        tools = active_tools["session"]
        if tools is None or tools.owner != payload.client_id:
            raise HTTPException(409, "Replay MCP request expired")
        try:
            name = tools.pending["name"] if tools.pending and tools.pending["id"] == payload.command_id else None
            result = tools.ack(payload.command_id, payload.frame, payload.error)
            if analyzer.terminal and name:
                analyzer.terminal.write("mcp.ack", name=name, code=payload.error if payload.error in QuantOperationError.codes else "chart_rejected" if payload.error else "ok")
            return result
        except ValueError:
            raise HTTPException(409, "Replay MCP acknowledgement rejected") from None

    @app.post("/api/backtest/tools/reset")
    def tool_reset(payload: ToolOwner):
        with result_lock:
            record = completed_results.get(payload.client_id)
            if record is not None:
                record.update(cancelled=True, result=None, acknowledged=[])
        tools = active_tools["session"]
        if tools and tools.owner == payload.client_id:
            tools.close()
        analyzer.close_replay(payload.client_id)
        return {"ok": True}

    def strategy_documents():
        return load_backtest_documents(config, config_path)

    @app.get("/api/backtest/status")
    def status():
        documents, errors = strategy_documents()
        connection = analyzer.status()
        result = {"adapter_ready": adapter.is_file(), "strategy_available": bool(documents), "strategy_required": False, "system_prompt": "backtest-trader-v1", "strategy_documents": [item["name"] for item in documents], "strategy_error": "Một số tài liệu không đọc được hoặc vượt giới hạn. AI dùng các tài liệu đọc được; nếu không có, AI tự xây dựng cách giao dịch." if errors else "", "provider": connection["provider"], "connected": connection.get("connected"), "error": connection.get("error", ""), "terminal_error": connection.get("terminal_error", ""), "model": connection.get("model", ""), "effort": connection.get("effort", ""), "busy": busy.locked(), "order_mode": "sample-close-next-update"}
        if "latency_ms" in connection:
            result["latency_ms"] = connection["latency_ms"]
        return result

    @app.post("/api/backtest/analyze")
    async def analyze(payload: BacktestFrame):
        if busy.locked():
            raise HTTPException(409, "Một lượt Backtest đang xử lý. Không tạo thêm hàng đợi.")
        # Phản hồi sớm; worker vẫn phải chiếm atomic lock trước khi gọi adapter.
        if analyzer._lock.locked():
            raise HTTPException(409, "CLI đang xử lý quan sát khác. Chờ lượt đó xong.")
        if not adapter.is_file():
            raise HTTPException(503, "Chưa cài bộ kết nối AI riêng cho Backtest.")
        if not analyzer.connection.get("connected"):
            raise HTTPException(409, "Kiểm tra kết nối CLI đã chọn trong Backtest trước khi phân tích.")
        documents, errors = strategy_documents()
        revision = analyzer._catalog_revision
        settings = dict(analyzer.settings)
        hashes = [document["sha256"] for document in documents]
        try:
            image = payload.image.split(",", 1)
            if len(image) != 2 or image[0] != "data:image/png;base64":
                raise ValueError("Expected chart PNG")
            png = base64.b64decode(image[1], validate=True)
            if len(png) < 24 or not png.startswith(b"\x89PNG\r\n\x1a\n") or len(png) > 8 * 1024 * 1024:
                raise ValueError("Invalid chart PNG")
            width, height = int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")
            if not 1 <= width <= 8192 or not 1 <= height <= 8192:
                raise ValueError("Invalid chart dimensions")
        except (ValueError, binascii.Error):
            raise HTTPException(422, "Ảnh chart không hợp lệ.") from None
        async with busy:
            record = {"result": None, "revision": revision, "settings": settings, "hashes": hashes, "errors": errors, "replay_id": payload.replay_id, "symbol": payload.symbol, "granularity": payload.granularity, "cutoff": payload.cutoff, "expires": time.monotonic() + 300}
            if payload.client_id:
                with result_lock:
                    completed_results[payload.client_id] = record
                    while len(completed_results) > 8:
                        completed_results.pop(next(iter(completed_results)))

            def finalize(output):
                if record.get("cancelled"):
                    raise HTTPException(409, "Lượt phân tích này đã dừng.")
                if revision != analyzer._catalog_revision or settings != analyzer.settings or not analyzer.connection.get("connected"):
                    raise HTTPException(409, "Kết nối AI đã thay đổi. Kết quả này không được áp dụng.")
                current, current_errors = strategy_documents()
                if current_errors != errors or hashes != [document["sha256"] for document in current]:
                    raise HTTPException(409, "Chiến lược đã thay đổi. Hãy phân tích lại khung replay.")
                result = BacktestDecision.model_validate(output)
                if any(point.timestamp >= payload.cutoff for drawing in result.drawings for point in drawing.points):
                    raise HTTPException(422, "AI đề xuất điểm vẽ thuộc tương lai, kết quả bị loại bỏ.")
                response = {"decision": result.model_dump(), "cutoff": payload.cutoff, "model": settings, "strategy_versions": hashes, "terminal_error": analyzer.terminal.error if analyzer.terminal else ""}
                with result_lock:
                    if record.get("cancelled"):
                        raise HTTPException(409, "Lượt phân tích này đã dừng.")
                    if payload.client_id and completed_results.get(payload.client_id) is record:
                        record["result"] = response
                if analyzer.terminal:
                    analyzer.terminal.write("backtest.validated", cutoff=payload.cutoff, action=result.action, order_type=result.order_type)
                return response

            with tempfile.TemporaryDirectory(prefix="quant-backtest-frame-") as folder:
                image_path = Path(folder) / "chart.png"
                image_path.write_bytes(png)
                context = payload.model_dump(exclude={"image"})
                try:
                    def run_admitted():
                        if not analyzer._lock.acquire(blocking=False):
                            raise HTTPException(409, "CLI đang xử lý quan sát khác. Chờ lượt đó xong rồi thử lại.")
                        try:
                            if revision != analyzer._catalog_revision or settings != analyzer.settings or not analyzer.connection.get("connected"):
                                raise HTTPException(409, "Kết nối AI đã thay đổi. Hãy phân tích lại khung replay.")
                            latest, latest_errors = strategy_documents()
                            if latest_errors != errors or hashes != [document["sha256"] for document in latest]:
                                raise HTTPException(409, "Chiến lược đã thay đổi. Hãy phân tích lại khung replay.")
                            if revision != analyzer._catalog_revision or settings != analyzer.settings or not analyzer.connection.get("connected"):
                                raise HTTPException(409, "Kết nối AI đã thay đổi. Hãy phân tích lại khung replay.")
                            spec = importlib.util.spec_from_file_location("quant_private_backtest", adapter)
                            module = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(module)
                            # Bridge sở hữu khóa; adapter không được chiếm hoặc nhả lại khóa này.
                            if payload.client_id and settings["provider"] in ("CODEX", "AGY"):
                                def is_current():
                                    latest, current_errors = strategy_documents()
                                    return not record.get("cancelled") and revision == analyzer._catalog_revision and settings == analyzer.settings and analyzer.connection.get("connected") and current_errors == errors and hashes == [item["sha256"] for item in latest]
                                def on_tool(name):
                                    if analyzer.terminal:
                                        analyzer.terminal.write("mcp.tool", name=name)
                                tools = QuantTools(payload, is_current, on_tool)
                                active_tools["session"] = tools
                                try:
                                    with serve_tools(tools) as capability:
                                        if payload.replay_id and settings["provider"] == "AGY":
                                            capability["_replay"] = {"id": payload.replay_id, "owner": payload.client_id, "symbol": payload.symbol, "granularity": payload.granularity, "cutoff": payload.cutoff, "revision": revision, "hashes": hashes, "teaching": payload.teaching}
                                            capability["_check"] = tools.check
                                            capability["_deadline"] = tools.started + ANALYSIS_TIMEOUT
                                        analyzer._backtest_mcp = capability
                                        output = module.analyze(analyzer, context, documents, image_path, BacktestDecision.model_json_schema())
                                        try:
                                            return tools.complete(output)
                                        except QuantSessionError as error:
                                            analyzer.close_replay(payload.client_id)
                                            diagnostic = CliRequestError("mcp_" + error.code)
                                            if analyzer.terminal:
                                                analyzer.terminal.write("backtest.rejected", code=diagnostic.code, message=diagnostic.safe_message, elapsed_ms=round((time.monotonic() - tools.started) * 1000))
                                            status = 504 if error.code == "request_expired" else 409 if error.code in ("session_closed", "configuration_changed") else 502
                                            raise HTTPException(status, diagnostic.safe_message) from None
                                        except ValueError:
                                            analyzer.close_replay(payload.client_id)
                                            diagnostic = CliRequestError("mcp_final_schema")
                                            if analyzer.terminal:
                                                analyzer.terminal.write("backtest.rejected", code=diagnostic.code, message=diagnostic.safe_message, elapsed_ms=round((time.monotonic() - tools.started) * 1000))
                                            raise HTTPException(502, diagnostic.safe_message) from None
                                finally:
                                    with result_lock:
                                        record["acknowledged"] = list(tools.acknowledgements)
                                    analyzer._backtest_mcp = None
                                    tools.close()
                                    if active_tools["session"] is tools:
                                        active_tools["session"] = None
                            return module.analyze(analyzer, context, documents, image_path, BacktestDecision.model_json_schema())
                        finally:
                            analyzer._lock.release()

                    worker = asyncio.create_task(asyncio.to_thread(run_admitted))
                    try:
                        output = await asyncio.shield(worker)
                    except asyncio.CancelledError:
                        # Giữ ảnh đến khi tiến trình CLI hoàn tất và nhả khóa sở hữu.
                        try:
                            output = await worker
                            finalize(output)
                        except Exception:
                            pass
                        raise
                    return finalize(output)
                except HTTPException:
                    raise
                except CliRequestError as error:
                    raise HTTPException(502, error.safe_message) from None
                except subprocess.TimeoutExpired as error:
                    raise HTTPException(504, f"{settings['provider']} chưa trả về quyết định sau {error.timeout:g} giây. CLI đã hết thời gian chờ; thao tác đã xác nhận vẫn được giữ. Kiểm tra kết nối nhà cung cấp rồi phân tích lại chart hiện tại.") from None
                except RuntimeError as error:
                    if str(error) == "Selected CLI is processing another request":
                        raise HTTPException(409, "CLI đang xử lý quan sát khác. Chờ lượt đó xong rồi thử lại.") from None
                    raise HTTPException(502, "AI chưa trả về quyết định Backtest hợp lệ. Kiểm tra Terminal và thử lại.") from None
                except Exception:
                    raise HTTPException(502, "AI chưa trả về quyết định Backtest hợp lệ. Kiểm tra Terminal và thử lại.") from None

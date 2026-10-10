import asyncio
import base64
import binascii
import importlib.util
import tempfile
from pathlib import Path
from typing import Literal
from fastapi import HTTPException
from pydantic import Field, model_validator
from .request_security import StrictRequest
from .learning_context import load_strategy_documents


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
    tool: Literal["TrendLine", "HorizontalLine", "Ray", "ExtendedLine"]
    points: list[DrawingPoint] = Field(min_length=1, max_length=2)
    label: str = Field(max_length=160)

    @model_validator(mode="after")
    def point_count(self):
        if len(self.points) != (1 if self.tool == "HorizontalLine" else 2):
            raise ValueError("Drawing point count does not match its tool")
        return self


class BacktestDecision(StrictModel):
    action: Literal["HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL"]
    order_type: Literal["MARKET", "LIMIT", "STOP_LIMIT"]
    stop_price: float | None = Field(gt=0, allow_inf_nan=False)
    limit_price: float | None = Field(gt=0, allow_inf_nan=False)
    reason: str = Field(max_length=6000)
    question: str = Field(max_length=2000)
    drawings: list[ReplayDrawing] = Field(max_length=30)

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


class ReplayHistory(StrictModel):
    cutoff: int = Field(ge=0)
    action: Literal["HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL"]
    reason: str = Field(max_length=6000)


class BacktestFrame(StrictModel):
    symbol: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_.-]+$")
    cutoff: int = Field(ge=0)
    granularity: Literal["1s", "1m"]
    bars: list[ReplayBar] = Field(min_length=1, max_length=2000)
    image: str = Field(max_length=12 * 1024 * 1024)
    drawings: list[ReplayDrawing] = Field(max_length=100)
    position: ReplayPosition | None
    orders: list[ReplayOrder] = Field(max_length=300)
    teaching: str = Field(max_length=6000)
    history: list[ReplayHistory] = Field(max_length=20)

    @model_validator(mode="after")
    def visible_data_only(self):
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


def register_backtest(app, analyzer, config, config_path):
    root = Path(__file__).resolve().parents[3]
    adapter = root / "private" / "backtest" / "runner.py"
    busy = asyncio.Lock()

    @app.get("/api/backtest/status")
    def status():
        documents, errors = load_strategy_documents(config, config_path)
        connection = analyzer.status()
        return {"adapter_ready": adapter.is_file(), "strategy_available": bool(documents and not errors), "strategy_documents": [item["name"] for item in documents], "provider": connection["provider"], "connected": connection.get("connected"), "model": connection.get("model", ""), "effort": connection.get("effort", ""), "busy": busy.locked(), "order_mode": "sample-close-next-update"}

    @app.post("/api/backtest/analyze")
    async def analyze(payload: BacktestFrame):
        if busy.locked():
            raise HTTPException(409, "Một lượt Backtest đang xử lý. Không tạo thêm hàng đợi.")
        # Phản hồi sớm; worker vẫn phải chiếm atomic lock trước khi gọi adapter.
        if analyzer._lock.locked():
            raise HTTPException(409, "CLI đang xử lý quan sát khác. Chờ lượt đó xong.")
        if not adapter.is_file():
            raise HTTPException(503, "Chưa cài bộ kết nối AI riêng cho Backtest.")
        if analyzer.settings["provider"] != "CODEX" or not analyzer.connection.get("connected"):
            raise HTTPException(409, "Chọn Codex trong cấu hình Backtest và kiểm tra kết nối trước khi phân tích.")
        documents, errors = load_strategy_documents(config, config_path)
        if errors or not documents:
            raise HTTPException(409, "Thêm tài liệu chiến lược riêng trước khi yêu cầu AI quyết định.")
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
                            latest, latest_errors = load_strategy_documents(config, config_path)
                            if latest_errors or hashes != [document["sha256"] for document in latest]:
                                raise HTTPException(409, "Chiến lược đã thay đổi. Hãy phân tích lại khung replay.")
                            if revision != analyzer._catalog_revision or settings != analyzer.settings or not analyzer.connection.get("connected"):
                                raise HTTPException(409, "Kết nối AI đã thay đổi. Hãy phân tích lại khung replay.")
                            spec = importlib.util.spec_from_file_location("quant_private_backtest", adapter)
                            module = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(module)
                            # Bridge sở hữu khóa; adapter không được chiếm hoặc nhả lại khóa này.
                            return module.analyze(analyzer, context, documents, image_path, BacktestDecision.model_json_schema())
                        finally:
                            analyzer._lock.release()

                    worker = asyncio.create_task(asyncio.to_thread(run_admitted))
                    try:
                        output = await asyncio.shield(worker)
                    except asyncio.CancelledError:
                        # Giữ ảnh đến khi tiến trình CLI hoàn tất và nhả khóa sở hữu.
                        try:
                            await worker
                        except Exception:
                            pass
                        raise
                    if revision != analyzer._catalog_revision or settings != analyzer.settings or not analyzer.connection.get("connected"):
                        raise HTTPException(409, "Kết nối AI đã thay đổi. Kết quả này không được áp dụng.")
                    current, current_errors = load_strategy_documents(config, config_path)
                    if current_errors or hashes != [document["sha256"] for document in current]:
                        raise HTTPException(409, "Chiến lược đã thay đổi. Hãy phân tích lại khung replay.")
                    result = BacktestDecision.model_validate(output)
                    if any(point.timestamp >= payload.cutoff for drawing in result.drawings for point in drawing.points):
                        raise HTTPException(422, "AI đề xuất điểm vẽ thuộc tương lai, kết quả bị loại bỏ.")
                    return {"decision": result.model_dump(), "cutoff": payload.cutoff, "model": settings, "strategy_versions": hashes}
                except HTTPException:
                    raise
                except RuntimeError as error:
                    if str(error) == "Selected CLI is processing another request":
                        raise HTTPException(409, "CLI đang xử lý quan sát khác. Chờ lượt đó xong rồi thử lại.") from None
                    raise HTTPException(502, "AI chưa trả về quyết định Backtest hợp lệ. Kiểm tra Terminal và thử lại.") from None
                except Exception:
                    raise HTTPException(502, "AI chưa trả về quyết định Backtest hợp lệ. Kiểm tra Terminal và thử lại.") from None

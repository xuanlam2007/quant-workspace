import hashlib
import json
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field
from .request_security import StrictRequest


class TradeObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["intent", "submitted", "filled", "cancelled", "unknown"]
    action: Optional[Literal["BUY", "SELL"]]
    price: Optional[float] = Field(gt=0, allow_inf_nan=False)
    contracts: Optional[int] = Field(ge=1, le=1000, strict=True)
    timestamp: Optional[str] = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$")
    instrument: str = Field(max_length=40)
    execution_id: str = Field(max_length=120)
    incremental: bool = Field(strict=True)
    evidence: str = Field(max_length=2000)


class FillReviewPayload(StrictRequest):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    session_id: str = Field(max_length=80, pattern=r"^session_\d{6}(?:_\w+)?$")
    candidate_id: str = Field(min_length=1, max_length=120)
    decision: Literal["confirm", "exclude"]
    action: Optional[Literal["BUY", "SELL"]] = None
    price: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    contracts: Optional[int] = Field(default=None, ge=1, le=1000, strict=True)
    timestamp: Optional[str] = Field(default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$")
    instrument: str = Field(default="VN30F1M", max_length=40)
    execution_id: str = Field(default="", max_length=120)


def identify_candidates(observations, event_id):
    candidates = []
    for index, item in enumerate(observations):
        candidate = TradeObservation.model_validate(item).model_dump()
        identity = f"{event_id}:{index}:" + json.dumps(candidate, sort_keys=True)
        candidate["id"] = "fill_" + hashlib.sha256(identity.encode()).hexdigest()[:24]
        candidates.append(candidate)
    return candidates


def auto_record_candidates(candidates, events, existing):
    records = list(existing)
    # Mã khớp riêng biệt ngăn ảnh lặp và lượng khớp lũy kế bị tính hai lần.
    known = {identity for event in events for record in event.get("observed_fills", []) for identity in (record.get("execution_id"), record.get("source_execution_id")) if identity}
    known.update(record.get("execution_id") for record in records if record.get("execution_id"))
    for candidate in candidates:
        execution_id = candidate["execution_id"].strip()
        if not (candidate["status"] == "filled" and candidate["incremental"] and execution_id and candidate["instrument"].upper() == "VN30F1M" and candidate["action"] and candidate["price"] and candidate["contracts"] and candidate["timestamp"] and candidate["evidence"].strip()):
            continue
        if execution_id in known:
            continue
        records.append({**candidate, "execution_id": execution_id, "source_execution_id": execution_id, "status": "confirmed", "reviewed_by": "AI"})
        known.add(execution_id)
    return records


def recorded_trades(events):
    trades = []
    for event in events:
        if event.get("type") in ("TRADE_OPEN", "TRADE_CLOSE", "TRADE_MANUAL"):
            trades.append(event)
        trades.extend(record for record in event.get("observed_fills", []) if record.get("status") == "confirmed")
    return sorted(trades, key=lambda item: item.get("timestamp", ""))

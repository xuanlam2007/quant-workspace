import os
import json
import time
import shutil
import subprocess
import re
import threading
import copy
from html import escape
from uuid import uuid4
from datetime import datetime
from typing import Dict, Any, List, Optional
from .strategy_backend import StrategyConflictAuditor

class TradePairManager:
    # Quản lý khớp cặp hợp đồng và tính điểm sau phí theo quy ước P_đỏ - P_xanh - 0.45 * N
    def __init__(self, fee_per_pair: float = 0.45):
        self.fee_per_pair = fee_per_pair
        self.open_longs: List[Dict[str, Any]] = []
        self.open_shorts: List[Dict[str, Any]] = []
        self.closed_pairs: List[Dict[str, Any]] = []

    def reset(self):
        self.open_longs.clear()
        self.open_shorts.clear()
        self.closed_pairs.clear()

    def register_trade(self, action: str, price: float, timestamp: str, contracts: int = 1) -> Dict[str, Any]:
        result = {
            "action": action,
            "price": price,
            "contracts": contracts,
            "timestamp": timestamp,
            "closed_pairs_count": 0,
            "realized_points_gross": 0.0,
            "realized_points_net": 0.0,
        }

        # BUY: mở LONG hoặc đóng SHORT
        # SELL: mở SHORT hoặc đóng LONG
        if action.upper() == "BUY":
            remaining = contracts
            while remaining > 0 and self.open_shorts:
                short_trade = self.open_shorts[0]
                short_trade["contracts"] -= 1
                if short_trade["contracts"] == 0:
                    self.open_shorts.pop(0)
                p_red = short_trade["price"]
                p_green = price
                gross_diff = p_red - p_green
                pair = {
                    "open_time": short_trade["timestamp"],
                    "close_time": timestamp,
                    "p_red": p_red,
                    "p_green": p_green,
                    "gross_points": gross_diff,
                    "net_points": gross_diff - self.fee_per_pair
                }
                self.closed_pairs.append(pair)
                result["closed_pairs_count"] += 1
                result["realized_points_gross"] += gross_diff
                result["realized_points_net"] += (gross_diff - self.fee_per_pair)
                remaining -= 1

            if remaining > 0:
                self.open_longs.append({"price": price, "timestamp": timestamp, "contracts": remaining})

        elif action.upper() == "SELL":
            remaining = contracts
            while remaining > 0 and self.open_longs:
                long_trade = self.open_longs[0]
                long_trade["contracts"] -= 1
                if long_trade["contracts"] == 0:
                    self.open_longs.pop(0)
                p_red = price
                p_green = long_trade["price"]
                gross_diff = p_red - p_green
                pair = {
                    "open_time": long_trade["timestamp"],
                    "close_time": timestamp,
                    "p_red": p_red,
                    "p_green": p_green,
                    "gross_points": gross_diff,
                    "net_points": gross_diff - self.fee_per_pair
                }
                self.closed_pairs.append(pair)
                result["closed_pairs_count"] += 1
                result["realized_points_gross"] += gross_diff
                result["realized_points_net"] += (gross_diff - self.fee_per_pair)
                remaining -= 1

            if remaining > 0:
                self.open_shorts.append({"price": price, "timestamp": timestamp, "contracts": remaining})

        return result

    def get_summary(self) -> Dict[str, Any]:
        total_closed = len(self.closed_pairs)
        total_gross = sum(p["gross_points"] for p in self.closed_pairs)
        total_fees = total_closed * self.fee_per_pair
        total_net = total_gross - total_fees
        return {
            "total_closed_pairs": total_closed,
            "total_gross_points": round(total_gross, 2),
            "total_fees_points": round(total_fees, 2),
            "total_net_points": round(total_net, 2),
            "open_longs_count": sum(item["contracts"] for item in self.open_longs),
            "open_shorts_count": sum(item["contracts"] for item in self.open_shorts),
            "pairs": self.closed_pairs
        }


class SessionLogger:
    # Quản lý lưu trữ nhật ký phiên giao dịch theo ngày: sessions/YYYY-MM-DD/session_HHMMSS/
    def __init__(self, base_dir: str = "sessions"):
        self.base_dir = os.path.abspath(base_dir)
        self.events: List[Dict[str, Any]] = []
        self.current_date = ""
        self.session_id = ""
        self.session_folder = ""
        self.events_file = ""
        self.frames_dir = ""
        self._lock = threading.RLock()
        self.active_file = os.path.join(self.base_dir, ".active-session.json")
        self.restore_active_session()

    def session_path(self, date: str, session_id: str) -> str:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) or not re.fullmatch(r"session_\d{6}(?:_\w+)?", session_id):
            raise ValueError("Invalid session identifier")
        return os.path.join(self.base_dir, date, session_id)

    def _persist_active(self):
        os.makedirs(self.base_dir, exist_ok=True)
        temp = self.active_file + ".tmp"
        with open(temp, "w", encoding="utf-8") as f:
            json.dump({"date": self.current_date, "session_id": self.session_id}, f)
        os.replace(temp, self.active_file)

    def clear_active(self):
        self.events = []
        self.current_date = self.session_id = self.session_folder = self.events_file = self.frames_dir = ""
        self._persist_active()

    def restore_active_session(self):
        if os.path.isfile(self.active_file):
            try:
                with open(self.active_file, encoding="utf-8") as f:
                    active = json.load(f)
                if active.get("session_id") and self.load_session(active["date"], active["session_id"]):
                    return
                if not active.get("session_id"):
                    return
            except (OSError, ValueError, KeyError):
                pass
        for group in self.list_all_sessions():
            for session in group["sessions"]:
                if self.load_session(group["date"], session["id"]):
                    return

    def new_session(self) -> str:
        now = datetime.now()
        self.current_date = now.strftime("%Y-%m-%d")
        self.session_id = f"session_{now.strftime('%H%M%S')}_{uuid4().hex[:8]}"
        self.session_folder = os.path.join(self.base_dir, self.current_date, self.session_id)
        self.events_file = os.path.join(self.session_folder, "events.jsonl")
        self.frames_dir = os.path.join(self.session_folder, "frames")
        self.events = []
        os.makedirs(self.frames_dir, exist_ok=True)
        self._persist_active()
        return self.session_id

    def list_all_sessions(self) -> List[Dict[str, Any]]:
        # Quét và phân nhóm danh sách các phiên theo ngày
        if not os.path.exists(self.base_dir):
            return []

        date_groups = []
        date_folders = sorted(os.listdir(self.base_dir), reverse=True)
        for d in date_folders:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
                continue
            d_path = os.path.join(self.base_dir, d)
            if not os.path.isdir(d_path):
                continue
            sessions = []
            session_folders = sorted(os.listdir(d_path), reverse=True)
            for s in session_folders:
                if not re.fullmatch(r"session_\d{6}(?:_\w+)?", s):
                    continue
                s_path = os.path.join(d_path, s)
                if not os.path.isdir(s_path):
                    continue
                ev_file = os.path.join(s_path, "events.jsonl")
                ev_count = 0
                if os.path.exists(ev_file):
                    try:
                        with open(ev_file, "r", encoding="utf-8") as f:
                            ev_count = sum(1 for _ in f)
                    except Exception:
                        pass
                
                # Xác định nhãn sáng hay chiều
                time_part = s.replace("session_", "").split("_")[0]
                time_str = f"{time_part[:2]}:{time_part[2:4]}:{time_part[4:6]}" if len(time_part) == 6 else time_part
                period = "Sáng" if time_part < "120000" else "Chiều"
                is_active = (d == self.current_date and s == self.session_id)

                sessions.append({
                    "id": s,
                    "date": d,
                    "time": time_str,
                    "label": f"Phiên {period} ({time_str})",
                    "events_count": ev_count,
                    "is_current": is_active,
                    "has_html": os.path.exists(os.path.join(s_path, "session_review.html")),
                    "has_pdf": os.path.exists(os.path.join(s_path, "session_review.pdf"))
                })

            if sessions:
                date_groups.append({
                    "date": d,
                    "sessions": sessions
                })

        return date_groups

    def load_session(self, date: str, session_id: str) -> bool:
        target_folder = self.session_path(date, session_id)
        if not os.path.isdir(target_folder):
            return False
        self.current_date = date
        self.session_id = session_id
        self.session_folder = target_folder
        self.events_file = os.path.join(self.session_folder, "events.jsonl")
        self.frames_dir = os.path.join(self.session_folder, "frames")
        self.events = []
        if os.path.exists(self.events_file):
            try:
                with open(self.events_file, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            ev = json.loads(line)
                            ev.setdefault("id", f"legacy_{len(self.events)}")
                            self.events.append(ev)
            except Exception:
                pass
        self._persist_active()
        return True

    def delete_session(self, date: str, session_id: str) -> bool:
        target_folder = self.session_path(date, session_id)
        if os.path.exists(target_folder):
            try:
                shutil.rmtree(target_folder)
                date_folder = os.path.join(self.base_dir, date)
                if os.path.exists(date_folder) and not os.listdir(date_folder):
                    try:
                        os.rmdir(date_folder)
                    except Exception:
                        pass
                if date == self.current_date and session_id == self.session_id:
                    self.clear_active()
                    for group in self.list_all_sessions():
                        if group["sessions"]:
                            self.load_session(group["date"], group["sessions"][0]["id"])
                            break
                return True
            except Exception:
                return False
        return False

    def delete_all_sessions(self) -> bool:
        try:
            if os.path.exists(self.base_dir):
                shutil.rmtree(self.base_dir)
            os.makedirs(self.base_dir, exist_ok=True)
            self.clear_active()
            return True
        except Exception:
            return False

    def log_event(self, event: Dict[str, Any]):
        if not self.session_id:
            raise ValueError("Create a session before recording events")
        if "id" not in event:
            event["id"] = f"evt_{uuid4().hex}"
        event["date"] = self.current_date
        event["session_id"] = self.session_id
        event["logged_at"] = datetime.now().isoformat()
        with self._lock:
            with open(self.events_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
            self.events.append(event)

    def update_event(self, event_id: str, updates: Dict[str, Any], date: Optional[str] = None, session_id: Optional[str] = None):
        with self._lock:
            is_active = not session_id or (date == self.current_date and session_id == self.session_id)
            events_file = self.events_file if is_active else os.path.join(self.session_path(date, session_id), "events.jsonl")
            if not os.path.isfile(events_file):
                return False
            if is_active:
                events = copy.deepcopy(self.events)
            else:
                with open(events_file, encoding="utf-8") as f:
                    events = [json.loads(line) for line in f if line.strip()]
            for ev in events:
                if ev.get("id") == event_id:
                    ev.update(updates)
                    temp = events_file + ".tmp"
                    with open(temp, "w", encoding="utf-8") as f:
                        for item in events:
                            f.write(json.dumps(item, ensure_ascii=False) + "\n")
                    os.replace(temp, events_file)
                    if is_active:
                        for original in self.events:
                            if original.get("id") == event_id:
                                original.update(updates)
                                break
                    return True
            return False

    def append_to_session(self, event: Dict[str, Any], date: str, session_id: str):
        with self._lock:
            folder = self.session_path(date, session_id)
            if not os.path.isdir(folder):
                return False
            event.update(id=f"evt_{uuid4().hex}", date=date, session_id=session_id, logged_at=datetime.now().isoformat())
            with open(os.path.join(folder, "events.jsonl"), "a", encoding="utf-8") as file:
                file.write(json.dumps(event, ensure_ascii=False) + "\n")
            if date == self.current_date and session_id == self.session_id:
                self.events.append(event)
            return True

    def export_reports(self, summary: Dict[str, Any]) -> Dict[str, str]:
        if not self.session_id:
            raise ValueError("No active session")
        html_path = os.path.abspath(os.path.join(self.session_folder, "session_review.html"))
        pdf_path = os.path.abspath(os.path.join(self.session_folder, "session_review.pdf"))

        rows = []
        for ev in self.events:
            ev_type = escape(str(ev.get("type", "UNKNOWN")))
            action = escape(str(ev.get("action", "")))
            price = escape(str(ev.get("price", "-")))
            timestamp = escape(str(ev.get("timestamp", "")))
            transcript = escape(str(ev.get("voice_transcript", "") or ev.get("reason", "") or ev.get("ai_transcript", "")))
            thesis = escape(str(ev.get("ai_thesis", "") or ev.get("ai_error", "")))
            question = escape(str(ev.get("ai_question", "")))
            teaching_html = "".join(f"<p>Trader: {escape(str(item.get('answer', '')))}</p>" for item in ev.get("teaching", []))
            fills_html = "".join("<p>" + escape(f"{item.get('status', '')}: {item.get('action', '?')} {item.get('contracts', '?')} @ {item.get('price', '?')} ({item.get('timestamp', '')}), {item.get('execution_id', '')}") + "</p>" for item in ev.get("observed_fills", []))
            audio_rel = "audio/" + os.path.basename(ev["audio_path"]) if ev.get("audio_path") else ""
            audio_tag = f"<audio controls src='{escape(audio_rel, quote=True)}'></audio>" if audio_rel else ""
            img_rel = os.path.relpath(ev.get("frame_path", ""), self.session_folder) if ev.get("frame_path") else ""
            warnings = ev.get("warnings", [])
            warn_html = "".join([f"<span class='badge warn'>{escape(str(w['message']))}</span>" for w in warnings])
            
            badge_class = "buy" if action == "BUY" else ("sell" if action == "SELL" else "neutral")
            img_tag = f"<img src='{img_rel}' alt='Chart' class='thumb'/>" if img_rel and os.path.exists(ev.get("frame_path", "")) else "-"
            
            rows.append(f"""
            <tr>
                <td class="mono">{timestamp}</td>
                <td><span class="badge {badge_class}">{ev_type} {action}</span></td>
                <td class="mono">{price}</td>
                <td>{transcript or "<em>Không có ghi chú</em>"}{'<p>AI: ' + thesis + '</p>' if thesis else ''}{'<p>Câu hỏi: ' + question + '</p>' if question else ''}{teaching_html}{fills_html}</td>
                <td>{warn_html or "<span class='badge neutral'>Quan sát</span>"}</td>
                <td>{img_tag}{audio_tag}</td>
            </tr>
            """)

        html_content = f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<title>Quant Strategy Auditor - {self.current_date} {self.session_id}</title>
<style>
:root {{
    --bg: #080A0F;
    --surface: #0E121A;
    --border: #1F2633;
    --text: #F0F4F8;
    --text-muted: #8A96A6;
    --buy: #10B981;
    --sell: #EF4444;
    --warn: #F59E0B;
    --accent: #3B82F6;
}}
body {{ margin: 0; padding: 24px; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); -webkit-print-color-adjust: exact; }}
h1, h2, h3 {{ margin: 0 0 12px 0; font-weight: 600; }}
.mono {{ font-family: 'JetBrains Mono', Consolas, monospace; }}
.header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }}
.stats-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }}
.card {{ background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }}
.card .label {{ font-size: 12px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 4px; }}
.card .value {{ font-size: 24px; font-weight: 700; }}
table {{ width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }}
th, td {{ padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }}
th {{ background: #131822; color: var(--text-muted); font-size: 11px; text-transform: uppercase; }}
.badge {{ display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }}
.badge.buy {{ background: rgba(16,185,129,0.15); color: var(--buy); border: 1px solid var(--buy); }}
.badge.sell {{ background: rgba(239,68,68,0.15); color: var(--sell); border: 1px solid var(--sell); }}
.badge.warn {{ background: rgba(245,158,11,0.15); color: var(--warn); border: 1px solid var(--warn); margin: 2px; }}
.badge.ok {{ background: rgba(59,130,246,0.15); color: var(--accent); }}
.thumb {{ width: 70px; height: 40px; object-fit: cover; border-radius: 3px; border: 1px solid var(--border); }}
</style>
</head>
<body>
<div class="header">
    <div>
        <h1>Quant Strategy Auditor &bull; Nhật ký phiên giao dịch</h1>
        <div class="mono" style="color:var(--text-muted);">Ngày: {self.current_date} &bull; Mã phiên: {self.session_id}</div>
    </div>
</div>
<div class="stats-grid">
    <div class="card">
        <div class="label">Cặp hoàn thành (N)</div>
        <div class="value mono">{summary.get('total_closed_pairs', 0)}</div>
    </div>
    <div class="card">
        <div class="label">Điểm thô (&Sigma; P_đỏ - P_xanh)</div>
        <div class="value mono">{summary.get('total_gross_points', 0.0)} pts</div>
    </div>
    <div class="card">
        <div class="label">Tổng phí (0.45 * N)</div>
        <div class="value mono">-{summary.get('total_fees_points', 0.0)} pts</div>
    </div>
    <div class="card">
        <div class="label">Điểm ròng sau phí</div>
        <div class="value mono" style="color: {'var(--buy)' if summary.get('total_net_points', 0.0) >= 0 else 'var(--sell)'};">
            {summary.get('total_net_points', 0.0)} pts
        </div>
    </div>
</div>
<h2>Chi tiết chuỗi thao tác & Phân tích</h2>
<table>
    <thead>
        <tr>
            <th>Thời gian</th>
            <th>Hành động</th>
            <th>Giá</th>
            <th>Diễn giải Trader</th>
            <th>Kiểm tra quy tắc</th>
            <th>Ảnh</th>
        </tr>
    </thead>
    <tbody>
        {"".join(rows) if rows else "<tr><td colspan='6' style='text-align:center;'>Chưa có thao tác nào trong phiên</td></tr>"}
    </tbody>
</table>
</body>
</html>"""
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        edge_paths = [
            os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe")
        ]
        for ep in edge_paths:
            if os.path.exists(ep):
                try:
                    subprocess.run([
                        ep,
                        "--headless",
                        "--disable-gpu",
                        "--run-all-compositor-stages-before-draw",
                        f"--user-data-dir={os.path.join(self.session_folder, '.report-browser')}",
                        f"--print-to-pdf={pdf_path}",
                        "file:///" + html_path.replace("\\", "/")
                    ], timeout=10, check=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                    break
                except Exception:
                    pass

        return {
            "html": html_path,
            "pdf": pdf_path if os.path.exists(pdf_path) else ""
        }

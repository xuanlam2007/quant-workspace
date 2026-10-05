import os
import json
import time
import shutil
import subprocess
from datetime import datetime
from typing import Dict, Any, List, Optional

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
                short_trade = self.open_shorts.pop(0)
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
                long_trade = self.open_longs.pop(0)
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
            "open_longs_count": len(self.open_longs),
            "open_shorts_count": len(self.open_shorts),
            "pairs": self.closed_pairs
        }


class StrategyConflictAuditor:
    def __init__(self, guardrails, enabled=True):
        self.guardrails = guardrails
        self.enabled = enabled
        self.trade_count = 0

    def reset(self):
        self.trade_count = 0

    def audit(self, event_type, action=None, price=None, current_dt=None):
        return []


class SessionLogger:
    # Quản lý lưu trữ nhật ký phiên giao dịch theo ngày: sessions/YYYY-MM-DD/session_HHMMSS/
    def __init__(self, base_dir: str = "sessions"):
        self.base_dir = base_dir
        self.events: List[Dict[str, Any]] = []
        self.current_date = ""
        self.session_id = ""
        self.session_folder = ""
        self.events_file = ""
        self.frames_dir = ""
        self.new_session()

    def new_session(self) -> str:
        now = datetime.now()
        self.current_date = now.strftime("%Y-%m-%d")
        self.session_id = f"session_{now.strftime('%H%M%S')}"
        self.session_folder = os.path.join(self.base_dir, self.current_date, self.session_id)
        self.events_file = os.path.join(self.session_folder, "events.jsonl")
        self.frames_dir = os.path.join(self.session_folder, "frames")
        self.events = []
        os.makedirs(self.frames_dir, exist_ok=True)
        return self.session_id

    def list_all_sessions(self) -> List[Dict[str, Any]]:
        # Quét và phân nhóm danh sách các phiên theo ngày
        if not os.path.exists(self.base_dir):
            return []

        date_groups = []
        date_folders = sorted(os.listdir(self.base_dir), reverse=True)
        for d in date_folders:
            d_path = os.path.join(self.base_dir, d)
            if not os.path.isdir(d_path):
                continue
            sessions = []
            session_folders = sorted(os.listdir(d_path), reverse=True)
            for s in session_folders:
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
                time_part = s.replace("session_", "")
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
        target_folder = os.path.join(self.base_dir, date, session_id)
        if not os.path.exists(target_folder):
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
                            self.events.append(json.loads(line))
            except Exception:
                pass
        return True

    def delete_session(self, date: str, session_id: str) -> bool:
        target_folder = os.path.join(self.base_dir, date, session_id)
        if os.path.exists(target_folder):
            try:
                shutil.rmtree(target_folder, ignore_errors=True)
                date_folder = os.path.join(self.base_dir, date)
                if os.path.exists(date_folder) and not os.listdir(date_folder):
                    try:
                        os.rmdir(date_folder)
                    except Exception:
                        pass
                if date == self.current_date and session_id == self.session_id:
                    self.new_session()
                return True
            except Exception:
                return False
        return False

    def delete_all_sessions(self) -> bool:
        try:
            if os.path.exists(self.base_dir):
                shutil.rmtree(self.base_dir, ignore_errors=True)
            os.makedirs(self.base_dir, exist_ok=True)
            self.new_session()
            return True
        except Exception:
            return False

    def log_event(self, event: Dict[str, Any]):
        if "id" not in event:
            event["id"] = f"evt_{datetime.now().strftime('%H%M%S_%f')[:10]}"
        event["logged_at"] = datetime.now().isoformat()
        self.events.append(event)
        with open(self.events_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")

    def update_event(self, event_id: str, updates: Dict[str, Any]):
        updated = False
        for ev in self.events:
            if ev.get("id") == event_id:
                ev.update(updates)
                updated = True
                break
        if updated and os.path.exists(self.events_file):
            try:
                with open(self.events_file, "w", encoding="utf-8") as f:
                    for ev in self.events:
                        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
            except Exception:
                pass

    def export_reports(self, summary: Dict[str, Any]) -> Dict[str, str]:
        html_path = os.path.abspath(os.path.join(self.session_folder, "session_review.html"))
        pdf_path = os.path.abspath(os.path.join(self.session_folder, "session_review.pdf"))

        rows = []
        for ev in self.events:
            ev_type = ev.get("type", "UNKNOWN")
            action = ev.get("action", "")
            price = ev.get("price", "-")
            timestamp = ev.get("timestamp", "")
            transcript = ev.get("voice_transcript", "")
            img_rel = os.path.relpath(ev.get("frame_path", ""), self.session_folder) if ev.get("frame_path") else ""
            warnings = ev.get("warnings", [])
            warn_html = "".join([f"<span class='badge warn'>{w['message']}</span>" for w in warnings])
            
            badge_class = "buy" if action == "BUY" else ("sell" if action == "SELL" else "neutral")
            img_tag = f"<img src='{img_rel}' alt='Chart' class='thumb'/>" if img_rel and os.path.exists(ev.get("frame_path", "")) else "-"
            
            rows.append(f"""
            <tr>
                <td class="mono">{timestamp}</td>
                <td><span class="badge {badge_class}">{ev_type} {action}</span></td>
                <td class="mono">{price}</td>
                <td>{transcript or "<em>Không có ghi âm</em>"}</td>
                <td>{warn_html or "<span class='badge ok'>Hợp lệ</span>"}</td>
                <td>{img_tag}</td>
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
                        f"--print-to-pdf={pdf_path}",
                        html_path
                    ], timeout=10, check=True)
                    break
                except Exception:
                    pass

        return {
            "html": html_path,
            "pdf": pdf_path if os.path.exists(pdf_path) else ""
        }

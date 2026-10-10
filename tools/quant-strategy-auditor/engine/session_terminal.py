import sys
import os
import json
import time
import argparse
import asyncio
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

# Bật ANSI escape sequence trên Windows console
if os.name == "nt":
    os.system("")

CLR_RESET = "\033[0m"
CLR_BOLD = "\033[1m"
CLR_GREEN = "\033[92m"
CLR_RED = "\033[91m"
CLR_YELLOW = "\033[93m"
CLR_BLUE = "\033[94m"
CLR_CYAN = "\033[96m"
CLR_GRAY = "\033[90m"
CLR_WHITE = "\033[97m"

def print_banner(date_str: str, session_id: str):
    print(f"{CLR_BLUE}================================================================================{CLR_RESET}")
    print(f"{CLR_BOLD}{CLR_WHITE}  QUANT STRATEGY AUDITOR {CLR_CYAN}•{CLR_WHITE} LIVE SESSION STREAM TERMINAL{CLR_RESET}")
    print(f"  {CLR_GRAY}Session ID:{CLR_RESET} {CLR_WHITE}{session_id}{CLR_RESET}  {CLR_GRAY}Date:{CLR_RESET} {CLR_WHITE}{date_str}{CLR_RESET}")
    print(f"  {CLR_GRAY}AI Engine:{CLR_RESET}  {CLR_GREEN}Selected AGY or Codex CLI{CLR_RESET}")
    print("  Ctrl+C stops this monitor. Use the AI panel for CLI account management.")
    print(f"  {CLR_GRAY}Connected:{CLR_RESET}  {CLR_CYAN}ws://127.0.0.1:8765/ws{CLR_RESET}")
    print(f"{CLR_BLUE}================================================================================{CLR_RESET}\n")

async def monitor_session(date_str: str, session_id: str):
    import websockets

    print_banner(date_str, session_id)
    print(f"{CLR_GRAY}[{time.strftime('%H:%M:%S')}] Đang kết nối tới máy chủ Quant Strategy Auditor...{CLR_RESET}")

    while True:
        try:
            token = os.getenv("QUANT_ENGINE_TOKEN") or (Path(__file__).resolve().parents[3] / ".agents" / "engine-token").read_text(encoding="utf-8").strip()
            client_id = "terminal_" + uuid4().hex
            request = Request("http://127.0.0.1:8765/api/socket-ticket", data=json.dumps({"client_id": client_id}).encode(), headers={"Content-Type": "application/json", "x-quant-engine-token": token}, method="POST")
            def read_ticket():
                with urlopen(request, timeout=5) as response:
                    return json.load(response)["ticket"]
            ticket = await asyncio.to_thread(read_ticket)
            uri = "ws://127.0.0.1:8765/ws?" + urlencode({"client_id": client_id, "ticket": ticket})
            ui = urlsplit(os.getenv("AUDITOR_UI_URL", "http://localhost:3000"))
            async with websockets.connect(uri, origin=f"{ui.scheme}://{ui.netloc}") as ws:
                print(f"{CLR_GREEN}[{time.strftime('%H:%M:%S')}] ✓ Đã kết nối WebSocket thành công. Đang lắng nghe sự kiện phiên...{CLR_RESET}\n")
                while True:
                    msg = await ws.recv()
                    data = json.loads(msg)
                    msg_type = data.get("type")

                    if data.get("session_id") != session_id or (data.get("date") or data.get("current_date")) != date_str:
                        continue

                    if msg_type in ("EVENT_LOGGED", "TRADE_LOGGED", "REJECT_LOGGED"):
                        ev = data.get("event", {})
                        summary = data.get("summary", {})
                        ev_type = ev.get("type", "EVENT")
                        action = ev.get("action", "")
                        price = ev.get("price", "-")
                        ts = ev.get("timestamp", time.strftime("%H:%M:%S"))
                        trans = ev.get("voice_transcript", "") or ev.get("reason", "")
                        warnings = ev.get("warnings", [])
                        ai_thesis = ev.get("ai_thesis", "")

                        color = CLR_GREEN if action == "BUY" else (CLR_RED if action == "SELL" else CLR_YELLOW)
                        badge = f"{color}{CLR_BOLD}[{ev_type} {action}]{CLR_RESET}" if action else f"{CLR_YELLOW}[{ev_type}]{CLR_RESET}"

                        print(f"{CLR_GRAY}[{ts}]{CLR_RESET} {badge} {CLR_WHITE}Giá: {price}{CLR_RESET} | {CLR_CYAN}Cặp (N): {summary.get('total_closed_pairs', 0)}{CLR_RESET} | {CLR_GREEN if summary.get('total_net_points', 0) >= 0 else CLR_RED}Ròng: {summary.get('total_net_points', 0)} pts{CLR_RESET}")
                        
                        if trans:
                            print(f"  {CLR_GRAY}↳ Diễn giải Trader:{CLR_RESET} \"{trans}\"")

                        if warnings:
                            for w in warnings:
                                print(f"  {CLR_YELLOW}⚠ Quy tắc:{CLR_RESET} {w.get('message')}")

                        if ai_thesis:
                            print(f"  {CLR_CYAN}🤖 Quan sát AI:{CLR_RESET} {ai_thesis}")
                            print(f"{CLR_GRAY}────────────────────────────────────────────────────────────────────────────────{CLR_RESET}")
                        elif ev.get("ai_pending"):
                            print(f"  {CLR_GRAY}Đang chờ AI quan sát thao tác...{CLR_RESET}")

                    elif msg_type == "EVENT_UPDATED":
                        ev = data.get("event", {})
                        ts = ev.get("timestamp", time.strftime("%H:%M:%S"))
                        ai_thesis = ev.get("ai_thesis", "")
                        if ai_thesis:
                            print(f"  {CLR_CYAN}🤖 Quan sát AI [{ts}]:{CLR_RESET} {ai_thesis}")
                            print(f"{CLR_GRAY}────────────────────────────────────────────────────────────────────────────────{CLR_RESET}")
                        elif ev.get("ai_error"):
                            print(f"  {CLR_YELLOW}AI: {ev['ai_error']}{CLR_RESET}")

                    elif msg_type == "SESSION_SWITCHED":
                        new_id = data.get("session_id", "")
                        new_date = data.get("date", "")
                        print(f"\n{CLR_YELLOW}⚡ Phiên làm việc đã chuyển sang: {new_id} ({new_date}){CLR_RESET}\n")

        except Exception as e:
            print(f"{CLR_RED}[{time.strftime('%H:%M:%S')}] Mất kết nối tới server ({e}). Thử lại sau 2 giây...{CLR_RESET}")
            await asyncio.sleep(2)

def main():
    parser = argparse.ArgumentParser(description="Quant Strategy Auditor Session Terminal")
    parser.add_argument("--date", default=time.strftime("%Y-%m-%d"))
    parser.add_argument("--session", required=True)
    args = parser.parse_args()

    try:
        asyncio.run(monitor_session(args.date, args.session))
    except KeyboardInterrupt:
        print(f"\n{CLR_GRAY}Terminal session đóng.{CLR_RESET}")

if __name__ == "__main__":
    main()

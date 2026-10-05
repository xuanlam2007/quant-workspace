import os
import sys
import time
import subprocess
import threading
import asyncio
import uvicorn

# Đảm bảo đường dẫn import tương đối chính xác
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

if sys.platform == "win32":
    # Tránh lỗi WinError 64 / socket reset làm treo Proactor event loop
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from engine.server import create_app

def launch_desktop_window(url: str):
    # Khởi chạy cửa sổ ứng dụng độc lập không viền trên Windows
    time.sleep(1.2)
    edge_paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe")
    ]
    
    launched = False
    for path in edge_paths:
        if os.path.exists(path):
            try:
                subprocess.Popen([path, f"--app={url}", "--window-size=1200,780"])
                launched = True
                break
            except Exception:
                pass

    if not launched:
        import webbrowser
        webbrowser.open(url)

def main():
    config_file = os.path.join(current_dir, "config.json")
    app = create_app(config_path=config_file)
    url = "http://127.0.0.1:8765"
    
    print("=" * 60)
    print("  QUANT STRATEGY AUDITOR &bull; DISCRETIONARY EXECUTION ENGINE")
    print(f"  Server URL: {url}")
    print(f"  WebSocket:  ws://127.0.0.1:8765/ws")
    print("=" * 60)

    # Chạy luồng mở cửa sổ giao diện người dùng
    t = threading.Thread(target=launch_desktop_window, args=(url,), daemon=True)
    t.start()

    # Khởi động máy chủ uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")

if __name__ == "__main__":
    main()

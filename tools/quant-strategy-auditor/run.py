import os
import sys
import time
import subprocess
import threading
import asyncio
import argparse
from pathlib import Path
import uvicorn

# Đảm bảo đường dẫn import tương đối chính xác
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

if sys.platform == "win32":
    # Tránh lỗi WinError 64 / socket reset làm treo Proactor event loop
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

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

def serve(managed=False):
    from engine.server import create_app
    config_file = os.path.join(current_dir, "config.json")
    app = create_app(config_path=config_file)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="info"))
    if managed:
        def wait_for_parent():
            sys.stdin.readline()
            server.should_exit = True
        threading.Thread(target=wait_for_parent, daemon=True).start()
    server.run()


def watch(managed=False):
    lock = open(os.path.join(current_dir, ".engine.lock"), "a+b")
    if lock.tell() == 0:
        lock.write(b"0")
        lock.flush()
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        print("Auditor watcher is already running.", flush=True)
        return

    stopped = threading.Event()
    if managed:
        def wait_for_launcher():
            sys.stdin.readline()
            stopped.set()
        threading.Thread(target=wait_for_launcher, daemon=True).start()

    def revision():
        paths = [Path(__file__), *Path(current_dir, "engine").rglob("*.py")]
        return {str(path): path.stat().st_mtime_ns for path in paths if path.exists()}

    def launch():
        return subprocess.Popen(
            [sys.executable, __file__, "--worker"], stdin=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

    def stop(child):
        if child.poll() is None:
            try:
                child.stdin.write(b"stop\n")
                child.stdin.flush()
                child.wait(timeout=15)
            except (OSError, subprocess.TimeoutExpired):
                child.terminate()
                child.wait()
        child.stdin.close()

    child = None
    try:
        previous = revision()
        child = launch()
        print("Auditor auto-reload enabled. Watching engine Python files.", flush=True)
        while not stopped.wait(0.75):
            current = revision()
            if current != previous:
                previous = current
                print("Reloading auditor after a Python code change...", flush=True)
                stop(child)
                child = launch()
            elif child.poll() is not None:
                # Chờ lần sửa tiếp theo để tránh lặp khởi động khi mã bị lỗi.
                if managed and child.returncode == 0:
                    break
    except KeyboardInterrupt:
        pass
    finally:
        if child:
            stop(child)
        lock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    options = parser.parse_args()
    if options.worker:
        serve(managed=True)
        return
    url = os.getenv("AUDITOR_UI_URL", "http://localhost:3000/auditor")
    
    print("=" * 60)
    print("  QUANT STRATEGY AUDITOR | DISCRETIONARY EXECUTION ENGINE")
    print(f"  Workspace: {url}")
    print("  Start Next.js separately with npm run dev.")
    print(f"  WebSocket:  ws://127.0.0.1:8765/ws")
    print("=" * 60)

    # Chạy luồng mở cửa sổ giao diện người dùng
    if os.getenv("AUDITOR_OPEN_BROWSER", "1") != "0":
        t = threading.Thread(target=launch_desktop_window, args=(url,), daemon=True)
        t.start()

    # Khởi động máy chủ uvicorn
    if options.watch:
        watch(managed=options.managed)
    else:
        serve(managed=options.managed)

if __name__ == "__main__":
    main()

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

def serve(managed=False, engine="auditor"):
    if engine == "backtest":
        from engine.backtest_server import create_app
    else:
        from engine.server import create_app
    config_file = os.path.join(current_dir, "config.json")
    app = create_app(config_path=config_file)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8766 if engine == "backtest" else 8765, log_level="info"))
    if managed:
        def wait_for_parent():
            sys.stdin.readline()
            server.should_exit = True
        threading.Thread(target=wait_for_parent, daemon=True).start()
    server.run()


def watch(managed=False, engine="auditor"):
    lock = open(os.path.join(current_dir, ".backtest-engine.lock" if engine == "backtest" else ".engine.lock"), "a+b")
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
        print(f"{engine} watcher is already running.", flush=True)
        return

    stopped = threading.Event()
    retry_requested = threading.Event()
    if managed:
        def wait_for_launcher():
            for line in sys.stdin:
                if line.strip() == "retry":
                    retry_requested.set()
                else:
                    break
            stopped.set()
        threading.Thread(target=wait_for_launcher, daemon=True).start()

    def revision():
        paths = [Path(__file__), *Path(current_dir, "engine").rglob("*.py")]
        return {str(path): path.stat().st_mtime_ns for path in paths if path.exists()}

    def launch():
        return subprocess.Popen(
            [sys.executable, __file__, "--worker", "--engine", engine], stdin=subprocess.PIPE,
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
        print(f"{engine} auto-reload enabled. Watching engine Python files.", flush=True)
        while not stopped.wait(0.75):
            current = revision()
            if current != previous or retry_requested.is_set():
                retry_requested.clear()
                previous = current
                print(f"Reloading {engine} after a source change or retry request...", flush=True)
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
    parser.add_argument("--engine", choices=["auditor", "backtest"], default="auditor")
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    options = parser.parse_args()
    if options.worker:
        serve(managed=True, engine=options.engine)
        return
    url = os.getenv("BACKTEST_UI_URL" if options.engine == "backtest" else "AUDITOR_UI_URL", f"http://localhost:3000/{options.engine}")
    
    print("=" * 60)
    print(f"  QUANT | {options.engine.upper()} ENGINE")
    print(f"  Workspace: {url}")
    print("  Start Next.js separately with npm run dev.")
    print(f"  API: http://127.0.0.1:{8766 if options.engine == 'backtest' else 8765}")
    print("=" * 60)

    # Chạy luồng mở cửa sổ giao diện người dùng
    if os.getenv("AUDITOR_OPEN_BROWSER", "1") != "0":
        t = threading.Thread(target=launch_desktop_window, args=(url,), daemon=True)
        t.start()

    # Khởi động máy chủ uvicorn
    if options.watch:
        watch(managed=options.managed, engine=options.engine)
    else:
        serve(managed=options.managed, engine=options.engine)

if __name__ == "__main__":
    main()

import ctypes
import json
import logging
import os
import queue
import signal
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager


def cli_environment():
    # CLI giữ credentials của provider, không kế thừa secrets của web và engine.
    return {key: value for key, value in os.environ.items() if not key.startswith(("QUANT_ENGINE_", "MARKET_DATA_", "NEXT_PUBLIC_", "AUDITOR_", "BACKTEST_"))}


class WindowsJob:
    def __init__(self):
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64), ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t), ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD), ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]

        class IoCounters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t), ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]

        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.SetInformationJobObject.restype = wintypes.BOOL
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.restype = wintypes.BOOL
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        # Đóng Job chỉ dừng cây tiến trình do lượt quan sát này tạo ra.
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def attach(self, process):
        if not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class CliProcess:
    def __init__(self, command, **kwargs):
        self.job = WindowsJob() if os.name == "nt" else None
        self.closed = False
        if self.job is None:
            kwargs["start_new_session"] = True
        try:
            self.process = subprocess.Popen(command, **kwargs)
            if self.job:
                self.job.attach(self.process)
        except Exception:
            if hasattr(self, "process"):
                self.process.kill()
                self.process.wait(timeout=3)
                for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
                    if pipe:
                        pipe.close()
            if self.job:
                self.job.close()
            raise

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.job:
            self.job.close()
        else:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=3)


def run_cli(command, *, input, timeout, terminal_event=None, **kwargs):
    owner = CliProcess(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    process = owner.process
    readers = []
    try:
        if terminal_event:
            messages = queue.Queue(maxsize=256)
            stopped = threading.Event()

            def read(pipe, kind):
                try:
                    while not stopped.is_set():
                        line = pipe.readline(1024 * 1024 + 1)
                        if not line:
                            break
                        if len(line) > 1024 * 1024:
                            raise ValueError("CLI stream message exceeded its size limit")
                        while not stopped.is_set():
                            try:
                                messages.put((kind, line), timeout=.1)
                                break
                            except queue.Full:
                                continue
                except (OSError, ValueError) as error:
                    if not stopped.is_set():
                        try:
                            messages.put(("error", str(error)), timeout=1)
                        except queue.Full:
                            pass
                finally:
                    if not stopped.is_set():
                        try:
                            messages.put((kind, None), timeout=1)
                        except queue.Full:
                            pass

            readers = [threading.Thread(target=read, args=(pipe, kind), daemon=True) for pipe, kind in ((process.stdout, "stdout"), (process.stderr, "stderr"))]
            for reader in readers:
                reader.start()
            deadline = time.monotonic() + timeout
            stdout, stderr, size = [], "", 0
            try:
                def write():
                    try:
                        process.stdin.write(input)
                        process.stdin.flush()
                    except (OSError, ValueError):
                        if not stopped.is_set():
                            try:
                                messages.put(("error", "CLI could not accept the observation prompt"), timeout=1)
                            except queue.Full:
                                pass
                writer = threading.Thread(target=write, daemon=True)
                readers.append(writer)
                writer.start()
                # Kết thúc lượt theo giao thức, không chờ tiến trình hoặc pipe của tiến trình con.
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise subprocess.TimeoutExpired(command, timeout)
                    try:
                        kind, line = messages.get(timeout=remaining)
                    except queue.Empty:
                        raise subprocess.TimeoutExpired(command, timeout) from None
                    if kind == "error":
                        raise RuntimeError(line)
                    if kind == "stderr":
                        if line:
                            stderr = (stderr + line)[-4000:]
                        continue
                    if line is None:
                        raise RuntimeError("CLI closed the observation stream without a final result. Evidence remains saved for retry.")
                    size += len(line)
                    if size > 16 * 1024 * 1024:
                        raise RuntimeError("CLI observation exceeded its response limit")
                    stdout.append(line)
                    event = json.loads(line)
                    step = event.get("step_update", {})
                    if step.get("state") == "ERROR" or step.get("tool_info", {}).get("error"):
                        raise RuntimeError("AGY gặp lỗi khi đọc minh chứng. Ghi âm và ảnh vẫn được lưu; kiểm tra Terminal rồi thử lại.")
                    if event.get("event") == terminal_event:
                        return subprocess.CompletedProcess(command, 0, "".join(stdout), stderr)
            finally:
                stopped.set()
        stdout, stderr = process.communicate(input=input, timeout=timeout)
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
    finally:
        # communicate có thể hết thời gian khi tiến trình con còn giữ pipe hoặc cwd.
        owner.close()
        for reader in readers:
            reader.join(timeout=1)
        for pipe in (process.stdin, process.stdout, process.stderr):
            if pipe:
                pipe.close()


@contextmanager
def observer_workspace():
    workspace = tempfile.TemporaryDirectory(prefix="quant-observer-")
    try:
        yield workspace.name
    finally:
        # Không để lỗi dọn tệp che mất phản hồi hoặc lỗi thật của CLI.
        for attempt in range(4):
            try:
                workspace.cleanup()
                break
            except OSError as error:
                if attempt == 3:
                    logging.getLogger(__name__).warning("Could not clean temporary observer workspace: %s", error)
                else:
                    time.sleep(0.1 * (attempt + 1))

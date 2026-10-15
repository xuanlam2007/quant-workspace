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
from .cli_diagnostics import CliRequestError, agy_step_error


def cli_environment():
    # CLI giữ credentials của provider, không kế thừa secrets của web và engine.
    return {key: value for key, value in os.environ.items() if not key.startswith(("QUANT_ENGINE_", "QUANT_MCP_", "QUANT_OBSERVER_", "MARKET_DATA_", "NEXT_PUBLIC_", "AUDITOR_", "BACKTEST_"))}


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


class AgyTurnGuard:
    def __init__(self, mcp_only=False):
        self.mcp_only = mcp_only
        self.finish_repairs = self.mcp_repairs = self.policy_repairs = 0

    def parse(self, line):
        try:
            event = json.loads(line)
        except ValueError:
            raise CliRequestError("stream_format") from None
        if not isinstance(event, dict):
            raise CliRequestError("stream_format")
        step = event.get("step_update", {})
        if not isinstance(step, dict) or not isinstance(step.get("tool_info") or {}, dict):
            raise CliRequestError("stream_format")
        if step.get("state") != "ERROR" and not (step.get("tool_info") or {}).get("error"):
            return event
        error = agy_step_error(step)
        if self.mcp_only and error.code == "mcp_tool_policy" and error.tool in ("view_file", "run_command", "list_dir", "grep_search", "find_by_name", "task_boundary", "notify_user") and self.policy_repairs < 1:
            self.policy_repairs += 1
            return event
        if error.tool == "finish" and error.code == "structured_output" and self.finish_repairs < 2:
            self.finish_repairs += 1
            return event
        parameters = (step.get("tool_info") or {}).get("parameters") or {}
        if error.code == "mcp_arguments" and isinstance(parameters, dict) and parameters.get("ServerName") == "quant-backtest_quant" and parameters.get("ToolName") in ("get_chart_state", "get_account_state", "get_chart_catalog", "capture_chart", "apply_chart") and self.mcp_repairs < 2:
            self.mcp_repairs += 1
            return event
        raise error


class CliConversation:
    def __init__(self, command, **kwargs):
        self.command = command
        self.owner = CliProcess(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
        self.process = self.owner.process
        self.messages = queue.Queue(maxsize=256)
        self.stopped = threading.Event()
        self.turn_lock = threading.Lock()
        self.close_lock = threading.Lock()
        self.readers = [threading.Thread(target=self._read, args=(pipe, kind), daemon=True) for pipe, kind in ((self.process.stdout, "stdout"), (self.process.stderr, "stderr"))]
        for reader in self.readers:
            reader.start()

    def _put(self, item):
        while not self.stopped.is_set():
            try:
                self.messages.put(item, timeout=.1)
                return
            except queue.Full:
                pass

    def _read(self, pipe, kind):
        try:
            while not self.stopped.is_set():
                line = pipe.readline(1024 * 1024 + 1)
                if not line:
                    break
                if len(line) > 1024 * 1024:
                    self._put(("error", "CLI stream message exceeded its size limit"))
                    return
                self._put((kind, line))
        except (OSError, ValueError):
            if not self.stopped.is_set():
                self._put(("error", "CLI observation stream failed"))
        finally:
            self._put((kind, None))

    def request(self, prompt, timeout, on_output=None):
        if not self.turn_lock.acquire(blocking=False):
            raise RuntimeError("Selected CLI is processing another request")
        writer = None
        try:
            if self.stopped.is_set() or self.process.poll() is not None:
                raise CliRequestError("stream_format")
            deadline = time.monotonic() + timeout
            guard = AgyTurnGuard(mcp_only=True)
            stdout, stderr, size = [], "", 0

            def write():
                try:
                    self.process.stdin.write(json.dumps({"event": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n")
                    self.process.stdin.flush()
                except (OSError, ValueError):
                    self._put(("error", "CLI could not accept the observation prompt"))

            writer = threading.Thread(target=write, daemon=True)
            writer.start()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(self.command, timeout)
                try:
                    kind, line = self.messages.get(timeout=remaining)
                except queue.Empty:
                    raise subprocess.TimeoutExpired(self.command, timeout) from None
                if self.stopped.is_set() or kind == "error":
                    raise CliRequestError("stream_format")
                if on_output and line:
                    on_output(kind, line)
                if kind == "stderr":
                    stderr = (stderr + (line or ""))[-4000:]
                    continue
                if line is None:
                    raise CliRequestError("final_result")
                size += len(line)
                if size > 16 * 1024 * 1024:
                    raise CliRequestError("stream_format")
                stdout.append(line)
                event = guard.parse(line)
                if event.get("event") == "result":
                    return subprocess.CompletedProcess(self.command, 0, "".join(stdout), stderr)
        except BaseException:
            self.close()
            raise
        finally:
            if writer:
                writer.join(timeout=1)
            self.turn_lock.release()

    def close(self):
        with self.close_lock:
            if self.stopped.is_set():
                return
            self.stopped.set()
            # Đánh thức lượt đang chờ trước khi dọn cây tiến trình riêng.
            try:
                self.messages.put_nowait(("error", None))
            except queue.Full:
                pass
            self.owner.close()
            for reader in self.readers:
                reader.join(timeout=1)
            for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
                if pipe:
                    pipe.close()


def run_cli(command, *, input, timeout, terminal_event=None, on_output=None, mcp_only=False, **kwargs):
    owner = CliProcess(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    process = owner.process
    readers = []
    try:
        if terminal_event or on_output:
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
            finished = set()
            guard = AgyTurnGuard(mcp_only)
            try:
                def write():
                    try:
                        process.stdin.write(input)
                        process.stdin.flush()
                        if not terminal_event:
                            process.stdin.close()
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
                    if on_output and line:
                        on_output(kind, line)
                    if line is None and not terminal_event:
                        finished.add(kind)
                        if len(finished) == 2:
                            code = process.wait(timeout=max(.001, deadline - time.monotonic()))
                            return subprocess.CompletedProcess(command, code, "".join(stdout), stderr)
                        continue
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
                    if not terminal_event:
                        continue
                    event = guard.parse(line)
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

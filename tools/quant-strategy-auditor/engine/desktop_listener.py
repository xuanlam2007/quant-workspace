import ctypes
import os
import threading
from ctypes import wintypes
from datetime import datetime
from typing import Callable, Optional, Dict, Any


def window_api():
    if os.name != "nt":
        raise RuntimeError("Desktop window capture requires Windows")
    api = ctypes.WinDLL("user32", use_last_error=True)
    api.GetForegroundWindow.restype = wintypes.HWND
    api.IsWindow.argtypes = [wintypes.HWND]
    api.IsWindowVisible.argtypes = [wintypes.HWND]
    api.IsIconic.argtypes = [wintypes.HWND]
    api.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    api.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    api.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    return api


def window_details(handle: int):
    if not handle:
        return None
    api = window_api()
    if not api.IsWindow(handle) or not api.IsWindowVisible(handle) or api.IsIconic(handle):
        return None
    title = ctypes.create_unicode_buffer(api.GetWindowTextLengthW(handle) + 1)
    api.GetWindowTextW(handle, title, len(title))
    rect = wintypes.RECT()
    if not title.value.strip() or not api.GetWindowRect(handle, ctypes.byref(rect)):
        return None
    return {"id": handle, "title": title.value, "bounds": (rect.left, rect.top, rect.right, rect.bottom)}


def list_windows():
    api = window_api()
    windows = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback_type
    def collect(handle, _):
        details = window_details(handle)
        if details:
            windows.append({"id": details["id"], "title": details["title"]})
        return True

    api.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    api.EnumWindows(collect, 0)
    return sorted(windows, key=lambda item: item["title"].casefold())


class DesktopListener:
    def __init__(self, target_window_title: str, on_event_callback: Callable[[Dict[str, Any]], None], frames_dir_provider: Callable[[], str]):
        self.target_window_title = target_window_title
        self.target_window_id = 0
        self.generation = 0
        self.on_event_callback = on_event_callback
        self.frames_dir_provider = frames_dir_provider
        self.is_running = False
        self.last_error = ""
        self._mouse_listener = None
        self._capture_lock = threading.Lock()

    def source(self):
        details = window_details(self.target_window_id)
        return details if details and self.target_window_title.strip() and details["title"] == self.target_window_title else None

    def start(self):
        if self.is_running:
            return
        if not self.source():
            raise RuntimeError("Select an available window before starting recording")
        self.last_error = ""
        self.is_running = True
        generation = self.generation
        try:
            from pynput import mouse

            def emit(event):
                if not self.is_running or generation != self.generation or window_api().GetForegroundWindow() != self.target_window_id:
                    return
                details = self.source()
                if not details:
                    return
                if event["type"] == "MOUSE_CLICK":
                    left, top, right, bottom = details["bounds"]
                    if not (left <= event["x"] < right and top <= event["y"] < bottom):
                        return
                frame = self.capture_screen()
                if not frame or not self.is_running or generation != self.generation:
                    return
                event.update(timestamp=datetime.now().strftime("%H:%M:%S"), frame_path=frame, capture_generation=generation)
                self.on_event_callback(event)

            def on_click(x, y, button, pressed):
                if pressed:
                    emit({"type": "MOUSE_CLICK", "button": str(button), "x": x, "y": y})

            self._mouse_listener = mouse.Listener(on_click=on_click)
            self._mouse_listener.daemon = True
            self._mouse_listener.start()
        except Exception as error:
            self.stop()
            self.last_error = str(error)
            raise RuntimeError(f"Could not start desktop recording: {error}") from error

    def stop(self):
        self.is_running = False
        if self._mouse_listener:
            self._mouse_listener.stop()
        self._mouse_listener = None
        # Chờ ảnh đang chụp hoàn tất trước khi xác nhận tạm dừng.
        with self._capture_lock:
            pass

    def capture_screen(self) -> Optional[str]:
        with self._capture_lock:
            details = self.source()
            frames_dir = self.frames_dir_provider()
            if not self.is_running or not details or not frames_dir or not os.path.isdir(frames_dir):
                return None
            try:
                from PIL import ImageGrab
                image = ImageGrab.grab(window=self.target_window_id)
                if not self.is_running:
                    image.close()
                    return None
                path = os.path.join(frames_dir, f"frame_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.png")
                image.save(path)
                image.close()
                return path
            except Exception as error:
                self.last_error = f"Window capture failed: {error}"
                return None

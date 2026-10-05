import os
import time
import threading
from datetime import datetime
from typing import Callable, Optional, Dict, Any

class DesktopListener:
    # Lắng nghe sự kiện chuột và phím tắt toàn cục (Global Hotkeys) trên Windows
    def __init__(self, target_window_title: str, on_event_callback: Callable[[Dict[str, Any]], None], frames_dir_provider: Callable[[], str]):
        self.target_window_title = target_window_title
        self.on_event_callback = on_event_callback
        self.frames_dir_provider = frames_dir_provider
        self.is_running = False
        self._mouse_listener = None
        self._hotkey_listener = None

    def start(self):
        self.is_running = True
        try:
            from pynput import mouse, keyboard

            def on_click(x, y, button, pressed):
                if not self.is_running or not pressed:
                    return
                frame_path = self.capture_screen()
                self.on_event_callback({
                    "type": "MOUSE_CLICK",
                    "button": str(button),
                    "x": x,
                    "y": y,
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "frame_path": frame_path
                })

            def on_global_reject():
                if not self.is_running:
                    return
                frame_path = self.capture_screen()
                self.on_event_callback({
                    "type": "REJECTED_SETUP",
                    "action": "REJECT",
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "reason": "Phím tắt toàn cục (Ctrl+Alt+S) được kích hoạt",
                    "frame_path": frame_path
                })

            self._mouse_listener = mouse.Listener(on_click=on_click)
            self._mouse_listener.daemon = True
            self._mouse_listener.start()

            # Đăng ký phím tắt toàn hệ thống Windows
            self._hotkey_listener = keyboard.GlobalHotKeys({
                '<ctrl>+<alt>+s': on_global_reject
            })
            self._hotkey_listener.daemon = True
            self._hotkey_listener.start()
        except Exception:
            pass

    def stop(self):
        self.is_running = False
        if self._mouse_listener:
            try:
                self._mouse_listener.stop()
            except Exception:
                pass
        if self._hotkey_listener:
            try:
                self._hotkey_listener.stop()
            except Exception:
                pass

    def capture_screen(self) -> Optional[str]:
        frames_dir = self.frames_dir_provider() if callable(self.frames_dir_provider) else self.frames_dir_provider
        if not frames_dir or not os.path.exists(frames_dir):
            return None
        filename = f"frame_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:19]}.png"
        filepath = os.path.join(frames_dir, filename)
        try:
            import mss
            with mss.MSS() as sct:
                monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                sct.shot(mon=monitor, output=filepath)
                return filepath
        except Exception:
            try:
                from PIL import ImageGrab
                im = ImageGrab.grab()
                im.save(filepath)
                return filepath
            except Exception:
                return None

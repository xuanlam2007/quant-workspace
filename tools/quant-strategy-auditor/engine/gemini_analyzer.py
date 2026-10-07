import os
import time
import shutil
import subprocess
from typing import Dict, Any, Optional
from .strategy_backend import build_analysis_prompt


def find_agy_path() -> Optional[str]:
    return shutil.which("agy") or next((path for path in [os.path.expandvars(r"%LocalAppData%\agy\bin\agy.exe")] if os.path.isfile(path)), None)


class GeminiMultimodalAnalyzer:
    def __init__(self):
        self.model_name = "agy-cli"

    def status(self) -> Dict[str, Any]:
        return {"available": bool(find_agy_path()), "connected": None, "model": self.model_name, "engine": "AGY_CLI"}

    def test_connection(self) -> Dict[str, Any]:
        agy = find_agy_path()
        if not agy:
            return {**self.status(), "connected": False, "error": "Không tìm thấy AGY CLI. Hãy cài đặt và đăng nhập AGY."}
        started = time.monotonic()
        try:
            result = subprocess.run([agy, "--print", "Ping. Trả lời đúng một từ: PONG"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            if result.returncode != 0 or not result.stdout.strip():
                raise RuntimeError(result.stderr.strip() or "AGY không trả về kết quả")
            return {**self.status(), "connected": True, "latency_ms": round((time.monotonic() - started) * 1000)}
        except Exception as error:
            return {**self.status(), "connected": False, "error": str(error)}

    def analyze_event(self, image_path: Optional[str], audio_path: Optional[str], context: Dict[str, Any], session_id: Optional[str] = None) -> Dict[str, Any]:
        agy = find_agy_path()
        if not agy:
            return {"ai_thesis": "", "ai_error": "AGY CLI chưa khả dụng. Dữ liệu thao tác đã được lưu.", "model_used": self.model_name}
        prompt = build_analysis_prompt(context)
        if not prompt:
            return {"ai_thesis": "", "ai_error": "Strategy analysis is not configured in this installation.", "model_used": self.model_name}
        command = [agy]
        if session_id:
            command.extend(["--conversation", f"quant_{session_id}"])
        command.extend(["--print", prompt])
        try:
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=40, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or f"AGY exit code {result.returncode}")
            text = "\n".join(line for line in result.stdout.splitlines() if line.strip() and not line.startswith("warning:")).strip()
            if not text:
                raise RuntimeError("AGY không trả về phân tích")
            return {"ai_thesis": text, "ai_error": "", "model_used": self.model_name}
        except Exception as error:
            return {"ai_thesis": "", "ai_error": str(error), "model_used": self.model_name}

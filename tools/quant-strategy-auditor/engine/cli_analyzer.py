import json
import os
import shutil
import subprocess
import threading
import time
import sys
from contextlib import contextmanager
from pathlib import Path
from .learning_context import build_learning_prompt
from .observed_trades import TradeObservation
from .cli_catalog import discover_catalog
from .codex_audio import run_codex_audio
from .cli_process import cli_environment, observer_workspace, run_cli


def observer_settings(settings):
    result = {"provider": "AGY", "model": "", "effort": "", **(settings or {}), "agent": ""}
    if result["provider"] == "AGY":
        result["effort"] = ""
    return result


def find_cli(provider):
    name = "codex" if provider == "CODEX" else "agy"
    executable = shutil.which(name)
    if not executable and provider == "AGY":
        candidate = os.path.expandvars(r"%LocalAppData%\agy\bin\agy.exe")
        executable = candidate if os.path.isfile(candidate) else None
    return executable


RESPONSE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "observation": {"type": "string"}, "question": {"type": "string"},
        "strategy_difference": {"type": "boolean"}, "evidence_limitations": {"type": "string"},
        "transcript": {"type": "string"},
        "trade_observations": {"type": "array", "maxItems": 20, "items": TradeObservation.model_json_schema()},
    },
    "required": ["observation", "question", "strategy_difference", "evidence_limitations", "transcript", "trade_observations"],
}


class CliLearningAnalyzer:
    def __init__(self, settings=None):
        self.settings = observer_settings(settings)
        self.connection = {"connected": None}
        self._lock = threading.Lock()
        self._catalog_lock = threading.Lock()
        self._catalog_revision = 0
        self._catalog_cache = {}

    def configure(self, settings):
        self.settings = observer_settings(settings)
        self.invalidate()

    def invalidate(self):
        self.connection = {"connected": None}
        self._catalog_revision += 1
        self._catalog_cache = {}

    def catalog(self, provider, refresh=False):
        with self._catalog_lock:
            cached = self._catalog_cache.get(provider)
            if not refresh and cached and time.monotonic() - cached[0] < 60:
                return cached[1]
            revision = self._catalog_revision
            result = discover_catalog(provider, find_cli(provider))
            if revision != self._catalog_revision:
                return {"provider": provider, "models": [], "agents": [], "efforts": [], "agents_supported": False, "errors": {"models": "AI settings or account changed during discovery. Refresh the catalog."}}
            self._catalog_cache[provider] = (time.monotonic(), result)
            return result

    def status(self):
        provider = self.settings["provider"]
        # Khả năng của bộ tích hợp; kết nối văn bản chưa xác nhận model hiểu âm thanh.
        return {**self.settings, **self.connection, "available": bool(find_cli(provider)), "vision": True, "audio_input": True, "transcription": True}

    @contextmanager
    def _analysis_slot(self):
        # Worker tuần tự chờ lượt kiểm tra kết nối có giới hạn thời gian, không làm lỗi bản ghi.
        self._lock.acquire()
        try:
            yield
        finally:
            self._lock.release()

    def _run(self, prompt, settings, image=None, audio=None, structured=False, timeout=120, frames=None, response_schema=None):
        executable = find_cli(settings["provider"])
        if not executable:
            raise RuntimeError(f"{settings['provider']} CLI was not found. Install it and sign in through Terminal.")
        # Tách thư mục quan sát khỏi mã nguồn và cấu hình riêng của dự án.
        with observer_workspace() as folder:
            environment = cli_environment()
            if settings["provider"] == "CODEX" and audio:
                return run_codex_audio(executable, folder, prompt, settings, audio, image, RESPONSE_SCHEMA if structured else None, timeout, frames=frames)
            if settings["provider"] == "CODEX":
                output = Path(folder) / "response.txt"
                command = [executable, "exec", "--ignore-user-config", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--color", "never", "-o", str(output), "-c", "features.shell_tool=false", "-c", 'web_search="disabled"']
                if settings.get("effort"):
                    command += ["-c", f"model_reasoning_effort={json.dumps(settings['effort'])}"]
                if settings.get("model"):
                    command += ["--model", settings["model"]]
                if image:
                    command += ["--image", str(image)]
                for frame in frames or []:
                    if frame["path"] != image:
                        command += ["--image", frame["path"]]
                if structured:
                    schema = Path(folder) / "schema.json"
                    schema.write_text(json.dumps(response_schema or RESPONSE_SCHEMA), encoding="utf-8")
                    command += ["--output-schema", str(schema)]
                command += ["-"]
                stdin = prompt
            else:
                files = []
                for source, filename in ((image, "evidence.png"), (audio, "voice" + Path(audio).suffix if audio else "voice")):
                    if source:
                        destination = Path(folder) / filename
                        shutil.copyfile(source, destination)
                        files.append(destination)
                for index, frame in enumerate(frames or []):
                    if frame["path"] == image:
                        continue
                    destination = Path(folder) / f"frame_{index:02d}.png"
                    shutil.copyfile(frame["path"], destination)
                    files.append(destination)
                    prompt += f"\n{destination.name}: captured at {frame['captured_at']}"
                if files:
                    prompt += "\nRead these evidence files with view_file before answering: " + json.dumps([str(path) for path in files])
                guard_folder = Path(folder) / ".agents"
                guard_folder.mkdir()
                guard = Path(__file__).with_name("observer_guard.py").resolve()
                shutil.copyfile(guard, guard_folder / "observer_guard.py")
                # AGY tách lệnh hook theo khoảng trắng; đường dẫn dự án không được đưa vào đối số.
                environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
                guard_command = Path(sys.executable).name + " -I observer_guard.py"
                hooks = {"observer-evidence-only": {"PreToolUse": [{"matcher": ".*", "hooks": [{"type": "command", "command": guard_command, "timeout": 5}]}]}}
                (guard_folder / "hooks.json").write_text(json.dumps(hooks), encoding="utf-8")
                environment["QUANT_OBSERVER_MEDIA_PATHS"] = json.dumps([str(path) for path in files])
                command = [executable, "--add-dir", folder, "--mode", "plan", "--sandbox", "--disable-slash-commands", "--input-format", "stream-json", "--output-format", "stream-json"]
                if settings.get("model"):
                    command += ["--model", settings["model"]]
                if structured:
                    schema = Path(folder) / "schema.json"
                    schema.write_text(json.dumps(RESPONSE_SCHEMA), encoding="utf-8")
                    command += ["--json-schema", str(schema)]
                stdin = json.dumps({"event": "user", "message": {"content": prompt}}, ensure_ascii=False) + "\n"
            result = run_cli(command, input=stdin, cwd=folder, env=environment, text=True, encoding="utf-8", errors="replace", timeout=timeout, terminal_event="result" if settings["provider"] == "AGY" else None, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            if result.returncode:
                raise RuntimeError(f"{settings['provider']} CLI exited with code {result.returncode}. Check Terminal and retry.")
            response = output.read_text(encoding="utf-8").strip() if settings["provider"] == "CODEX" and output.is_file() else result.stdout.strip()
            if settings["provider"] == "AGY":
                events = [json.loads(line) for line in response.splitlines() if line.strip()]
                results = [event["result"] for event in events if event.get("event") == "result"]
                if not results or results[-1].get("status") != "SUCCESS":
                    raise RuntimeError("AGY did not return a successful final result. Check Terminal and retry.")
                envelope = results[-1]
                response = json.dumps(envelope["structured_output"], ensure_ascii=False) if structured and "structured_output" in envelope else envelope.get("response", "").strip()
                read_files = set()
                for event in events:
                    step = event.get("step_update", {})
                    info = step.get("tool_info", {})
                    target = info.get("parameters", {}).get("AbsolutePath")
                    if step.get("tool_name") == "view_file" and step.get("state") == "DONE" and not info.get("error") and isinstance(target, str):
                        read_files.add(Path(target).resolve())
                if files and not all(path.resolve() in read_files for path in files):
                    raise RuntimeError("AGY did not read the supplied media. The evidence is saved; retry with a media-capable model.")
            if not response:
                raise RuntimeError("The CLI returned no response")
            return response

    def test_connection(self):
        settings = dict(self.settings)
        started = time.monotonic()
        with self._lock:
            try:
                response = self._run("Do not use any tools. Reply with exactly PONG.", settings, timeout=45)
                if response.strip() != "PONG":
                    raise RuntimeError("The CLI did not confirm the connection with PONG")
                connection = {"connected": True, "latency_ms": round((time.monotonic() - started) * 1000)}
            except subprocess.TimeoutExpired:
                connection = {"connected": False, "error": "CLI connection check timed out. Check the selected provider in Terminal and retry."}
            except Exception as error:
                connection = {"connected": False, "error": str(error)}
            if settings == self.settings:
                self.connection = connection
        return self.status()

    def analyze_event(self, image_path, audio_path, context, session_id=None, reference_is_current=None):
        settings = dict(context.get("ai_settings") or self.settings)
        connection_revision = self._catalog_revision
        vision = bool(image_path)
        audio = bool(audio_path)
        prompt_context = {key: value for key, value in context.items() if key not in ("ai_settings", "ai_connection_revision", "ai_strategy_revision", "ai_status", "ai_requested_at", "ai_started_at")}
        try:
            with self._analysis_slot():
                if settings != self.settings or not self.connection.get("connected"):
                    raise RuntimeError("AI settings or account changed. Check the selected connection and retry this observation.")
                strategy = context.get("ai_strategy_context", context.get("strategy", {}))
                if (strategy.get("enabled") and not strategy.get("documents")) or (reference_is_current is not None and not reference_is_current()):
                    raise RuntimeError("Observation mode or strategy reference changed. Evidence remains saved locally.")
                frames = context.get("observation_frames") or []
                response = self._run(build_learning_prompt(prompt_context, vision or bool(frames), audio, settings["provider"] == "AGY" and (vision or audio or frames)), settings, image=image_path if vision else None, audio=audio_path if audio else None, structured=True, **({"frames": frames} if frames else {}))
                if settings != self.settings or connection_revision != self._catalog_revision or not self.connection.get("connected"):
                    raise RuntimeError("AI settings or account changed during analysis. The recording is saved; retry with the selected provider.")
            if response.startswith("```"):
                response = "\n".join(response.splitlines()[1:-1])
            data = json.loads(response)
            if isinstance(data, dict) and isinstance(data.get("structured_output"), dict):
                data = data["structured_output"]
            if not isinstance(data, dict) or any(not isinstance(data.get(key), str) for key in ("observation", "question", "evidence_limitations", "transcript")) or not isinstance(data.get("strategy_difference"), bool):
                raise ValueError("The AI response does not match the observation format")
            strategy = context.get("ai_strategy_context", context.get("strategy", {}))
            trades = data.get("trade_observations")
            if not isinstance(trades, list) or len(trades) > 20:
                raise ValueError("Expected at most 20 observed executions")
            trades = [TradeObservation.model_validate(item).model_dump() for item in trades]
            difference = bool(strategy.get("enabled") and data["strategy_difference"])
            question = data["question"] or ("Tôi chưa hiểu điểm khác với tài liệu chiến lược. Bạn giải thích lý do được không?" if difference else "")
            return {"ai_thesis": data["observation"], "ai_question": question, "ai_strategy_difference": difference, "ai_evidence_limitations": data["evidence_limitations"], "ai_transcript": data.get("transcript", "") if audio else "", "ai_trade_observations": trades, "ai_error": "", "model_used": settings}
        except subprocess.TimeoutExpired as error:
            return {"ai_thesis": "", "ai_error": f"{settings['provider']} chưa trả về kết quả sau {error.timeout:g} giây. Ghi âm và ảnh đã được lưu; kiểm tra Terminal rồi thử phân tích lại.", "model_used": settings}
        except Exception as error:
            return {"ai_thesis": "", "ai_error": str(error), "model_used": settings}

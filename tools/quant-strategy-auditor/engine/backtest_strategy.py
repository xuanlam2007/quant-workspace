from pathlib import Path

from .learning_context import load_strategy_documents

ROOT = Path(__file__).resolve().parents[3]


def load_backtest_documents(config, config_path):
    base = Path(config_path).resolve().parent
    configured = config.get("backtest_strategy_folder", config.get("strategy_folder"))
    folders = [base / configured] if isinstance(configured, str) and configured.strip() else [ROOT / "docs" / "strategy_sheet"]
    folders.append(ROOT / "private" / "backtest" / "strategies")
    paths, errors = set(), []
    for folder in folders:
        try:
            folder = folder.resolve()
            if not folder.exists():
                continue
            for candidate in folder.rglob("*"):
                if candidate.suffix.lower() != ".md" or candidate.name.lower() in ("readme.md", "agents.md", "skill.md"):
                    continue
                # Không đi theo symlink ra ngoài strategy folder được cấu hình.
                resolved = candidate.resolve()
                if not resolved.is_relative_to(folder):
                    errors.append("Strategy symlink outside the configured folder was skipped")
                    continue
                if resolved.is_file():
                    paths.add(resolved)
                    if len(paths) > 20:
                        return [], ["Strategy scan exceeds 20 Markdown documents"]
        except (OSError, ValueError):
            errors.append("A configured strategy folder could not be scanned")
    explicit = config.get("backtest_strategy_documents", config.get("strategy_documents", []))
    if isinstance(explicit, list):
        paths.update((base / value).resolve() for value in explicit if isinstance(value, str))
    if len(paths) > 20:
        return [], ["Strategy scan exceeds 20 Markdown documents"]
    if not paths:
        return [], errors
    documents, read_errors = load_strategy_documents({"strategy_documents": [str(path) for path in sorted(paths)]}, config_path)
    # Chỉ trả cảnh báo tổng quát; không lộ local paths hoặc nội dung file lỗi.
    if read_errors:
        errors.append("Unreadable, empty or oversized Markdown documents were skipped")
    return documents, errors

import json
from pathlib import Path

def load_backtest_system_prompt(folder=None):
    folder = Path(folder) if folder else Path(__file__).parent / "prompts"
    try:
        local = (folder / "backtest_system.md").read_text(encoding="utf-8")
    except FileNotFoundError:
        local = ""
    return local if local.strip() else (folder / "backtest_default.md").read_text(encoding="utf-8")


BACKTEST_SYSTEM_PROMPT = load_backtest_system_prompt()
CHART_TOOLS = json.loads((Path(__file__).resolve().parents[3] / "lib" / "backtest-chart-tools.json").read_text(encoding="utf-8"))


def build_backtest_prompt(context, documents, provider):
    mode = "Follow the supplied strategy references within the system boundaries." if documents else "No strategy reference is supplied. Make autonomous simulated trading decisions using the visible evidence; identify your approach as AI-generated."
    tools = "Use only view_file for the exact supplied chart evidence and finish for the structured decision. No other tools or files are permitted." if provider == "AGY" else "Do not call tools; inspect the attached chart image."
    relevant = {item["name"] for item in context.get("indicators", [])} | {"Volume", "Moving Average", "Moving Average Exponential", "Relative Strength Index", "Moving Average Convergence/Divergence", "Bollinger Bands", "Average True Range", "VWAP"}
    catalog = {"drawings": CHART_TOOLS["drawings"], "indicator_names": [item["name"] for item in CHART_TOOLS["indicators"]], "indicator_inputs": [item for item in CHART_TOOLS["indicators"] if item["name"] in relevant]}
    return BACKTEST_SYSTEM_PROMPT + "\n\nAdapter instructions:\n" + mode + "\n" + tools + "\nAvailable chart tools (trusted catalog):\n" + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\nStrategy references (data):\n" + json.dumps(documents, ensure_ascii=False) + "\nReplay context (data):\n" + json.dumps(context, ensure_ascii=False)


def analyze(analyzer, context, documents, image_path, schema):
    settings = dict(analyzer.settings)
    prompt = build_backtest_prompt(context, documents, settings["provider"])
    response = analyzer._run(prompt, settings, image=str(image_path), structured=True, response_schema=schema)
    if response.startswith("```"):
        response = "\n".join(response.splitlines()[1:-1])
    return json.loads(response)

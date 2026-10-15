"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { advancePaperLedger, emptyLedger, paperLedgerContext, submitTimedPaperOrder, exampleReplay, parseReplayData, replayFrame, replayMinutes, submitPaperOrder, type BacktestDecision, type PaperLedger, type ReplayData, type ReplayChartPort } from "../../lib/backtest";
import { backtestRequest, engineUrl } from "../../lib/backtest-client";
import { recoverBacktestAnalysis } from "../../lib/backtest-analysis";
import { paperAccountMatches } from "../../lib/backtest-account";
import backtestTiming from "../../lib/backtest-timing.json";
import { ReplayToolDelivery, waitForReplayPaint, pollReplayTools } from "../../lib/backtest-tool-delivery";
import { activateBacktest } from "../../lib/backtest-status";
import { notify } from "../../lib/notifications";
import { Icon } from "../auditor/AuditorUi";
import AuditorConnection from "../auditor/AuditorConnection";
import GlobalNotice from "../ui/GlobalNotice";
import { LoadingIndicator } from "../ui/Loading";
import type { AiCatalog, AiSettings, AiStatus } from "../../lib/auditor-client";
import AuditorThoughtLine from "../auditor/AuditorThoughtLine";
import BacktestChart, { type BacktestChartHandle } from "./BacktestChart";
import BacktestConnectionSummary from "./BacktestConnectionSummary";
import styles from "./BacktestWorkspace.module.css";
import { SymbolSearchModal } from "../chart/layout/symbols/SymbolSearchModal";
import { GoToDateDialog, GO_TO_DATE_ICON } from "../chart/layout/navigation/GoToDateDialog";
import { HEADER_SVGS } from "../chart/layout/navigation/ChartHeader";
import { DerivativesTerminal } from "./derivatives/DerivativesTerminal";
import { cancelDerivativeOrders, replaceDerivativeOrder, submitDerivativeOrder, type DerivativeTicket } from "../../lib/derivatives-ledger";
import { ChartSelect } from "../chart/ui/ChartSelect";

type Status = AiSettings & { adapter_ready: boolean; strategy_available: boolean; strategy_documents: string[]; strategy_error?: string; error?: string; terminal_error?: string; latency_ms?: number; connected: boolean | null; busy: boolean };
const loadCatalog = (provider: AiSettings["provider"], refresh: boolean, signal: AbortSignal) => backtestRequest<AiCatalog>(`/ai/catalog?provider=${provider}&refresh=${refresh}`, "GET", undefined, signal);
type Entry = { cutoff: number; received: number; context: string; application: string; applied?: boolean; decision: BacktestDecision; model: { model: string; effort: string }; strategy_versions: string[]; duration: number };
type FailedAttempt = { cutoff: number; message: string; actions: string[]; duration: number };
type AnalysisResult = { decision: BacktestDecision; cutoff: number; model: Entry["model"]; strategy_versions: string[]; terminal_error?: string };
type SavedRun = { symbol: string; granularity: string; demo: boolean; cutoff: number; ledger: PaperLedger; entries: Entry[]; failedAttempts: FailedAttempt[]; fee: number; second: number; teaching: string };
const formatTime = (time: number) => new Date(time * 1000).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
const actionLabel = { HOLD: "Chờ", OPEN_LONG: "Mở LONG", OPEN_SHORT: "Mở SHORT", CLOSE: "Đóng vị thế", CANCEL: "Hủy lệnh chờ" };
const toolLabel = { get_chart_state: "Đọc dữ liệu chart", get_account_state: "Kiểm tra tài khoản mô phỏng", get_chart_catalog: "Tra cứu công cụ chart", capture_chart: "Chụp chart", apply_chart: "Cập nhật drawing và chỉ báo", submit_order: "Gửi lệnh mô phỏng" };
const orderLabel = { waiting: "Chờ kích hoạt / khớp", triggered: "Đã kích hoạt, chưa khớp", filled: "Đã khớp mô phỏng", cancelled: "Đã hủy" };
const waitForChart = () => document.visibilityState === "hidden" ? Promise.resolve() : waitForReplayPaint();

export default function BacktestWorkspace({ active }: { active: boolean }) {
  const chart = useRef<BacktestChartHandle>(null);
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const toolOwner = useRef("");
  const replayOwner = useRef("");
  const busyRef = useRef(false);
  const [data, setData] = useState<ReplayData | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [session, setSession] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connectionPending, setConnectionPending] = useState("");
  const terminalOpening = useRef(false);
  const connectionRequest = useRef(false);
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [connectionValidating, setConnectionValidating] = useState(false);
  const updateConnectionDraft = useCallback((blocked: boolean, validating: boolean) => {
    setConnectionDirty(blocked);
    setConnectionValidating(validating);
  }, []);
  const [ledger, setLedger] = useState<PaperLedger>(emptyLedger);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [analysisActivity, setAnalysisActivity] = useState("");
  const [failedAttempts, setFailedAttempts] = useState<FailedAttempt[]>([]);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [teaching, setTeaching] = useState("");
  const [autoAi, setAutoAi] = useState(true);
  const [applyOrders, setApplyOrders] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [cadence, setCadence] = useState(1);
  const [second, setSecond] = useState(55);
  const [fee, setFee] = useState(.45);
  const [startedAt, setStartedAt] = useState("");
  const [symbol, setSymbol] = useState("VN30F1M");
  const [date, setDate] = useState(() => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10));
  const [resolution, setResolution] = useState<"1s" | "1m">("1m");
  const [sourceDialog, setSourceDialog] = useState<"symbol" | "date" | null>(null);
  const [sourceClosing, setSourceClosing] = useState(false);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const closeSourceDialog = useCallback(() => setSourceClosing(true), []);
  const openSourceDialog = (dialog: "symbol" | "date", trigger: HTMLElement) => { sourceTrigger.current = trigger; setSourceClosing(false); setSourceDialog(dialog); };
  const frame = useMemo(() => data ? replayFrame(data, cursor, second) : null, [data, cursor, second]);
  const minutes = useMemo(() => data ? replayMinutes(data) : [], [data]);
  const canAnalyze = !!status?.adapter_ready && !!status.connected && !connectionDirty && !connectionValidating && !connectionPending;
  const aiProvider = status?.provider;
  const aiBlocked = connectionDirty ? "Lưu cấu hình AI đã chọn trước khi phân tích." : connectionValidating || connectionPending ? "" : !status ? "Đang chờ trạng thái Backtest." : !status.adapter_ready ? "Chưa cài bộ kết nối AI riêng cho Backtest." : !status.connected ? "Kiểm tra kết nối CLI đã chọn trước khi phân tích." : "";
  const runtime = useRef({ data, frame, cursor, ledger, entries, autoAi, applyOrders, canAnalyze, aiBlocked, second, fee, cadence, teaching, minuteCount: minutes.length });
  const queuedAnalysis = useRef(false);
  const analyzeRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    runtime.current = { data, frame, cursor, ledger, entries, autoAi, applyOrders, canAnalyze, aiBlocked, second, fee, cadence, teaching, minuteCount: minutes.length };
  }, [data, frame, cursor, ledger, entries, autoAi, applyOrders, canAnalyze, aiBlocked, second, fee, cadence, teaching, minutes.length]);
  const commitLedger = useCallback((next: PaperLedger) => { runtime.current.ledger = next; setLedger(next); }, []);
  const gross = ledger.pairs.reduce((sum, pair) => sum + pair.gross, 0);
  const fees = ledger.pairs.reduce((sum, pair) => sum + pair.fee, 0);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try { await activateBacktest(); setStatus(await backtestRequest<Status>("/backtest/status")); }
    catch (error) { setStatus(null); setNotice(error instanceof Error ? error.message : "Không tải được kết nối Backtest."); }
    finally { setStatusLoading(false); }
  }, []);
  useEffect(() => { if (active) { void refreshStatus(); } else setPlaying(false); }, [active, refreshStatus]);
  useEffect(() => { if (!active) { setSourceDialog(null); setSourceClosing(false); } }, [active]);
  useEffect(() => {
    if (!sourceClosing) return;
    const timer = window.setTimeout(() => { setSourceDialog(null); setSourceClosing(false); sourceTrigger.current?.focus({ preventScroll: true }); }, 120);
    return () => window.clearTimeout(timer);
  }, [sourceClosing]);
  useEffect(() => () => { generation.current += 1; request.current?.abort(); if (toolOwner.current) void backtestRequest("/backtest/tools/reset", "POST", { client_id: toolOwner.current }).catch(() => {}); }, []);

  const saveAndCheckConnection = async (settings: AiSettings) => {
    if (connectionRequest.current || busyRef.current || connectionPending) return;
    connectionRequest.current = true;
    setStatusLoading(true); setConnectionPending("ai"); setPlaying(false); setNotice("");
    try {
      await activateBacktest();
      const saved = await backtestRequest<AiStatus>("/backtest/connection/config", "POST", settings);
      setStatus(previous => previous ? { ...previous, ...saved, latency_ms: saved.latency_ms } : previous);
      const result = await backtestRequest<AiStatus>("/backtest/connection/test", "POST");
      setStatus(previous => previous ? { ...previous, ...result, latency_ms: result.latency_ms } : previous);
      if (!result.connected) setNotice(result.error || "Chưa kết nối được CLI đã chọn.");
      await refreshStatus();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không kiểm tra được kết nối."); }
    finally { connectionRequest.current = false; setStatusLoading(false); setConnectionPending(""); }
  };
  const openTerminal = async (provider: AiSettings["provider"]) => {
    if (terminalOpening.current || busyRef.current || connectionPending) return;
    terminalOpening.current = true;
    setConnectionPending("ai-account"); setPlaying(false); setNotice("");
    try {
      await backtestRequest("/backtest/terminal/open", "POST", { provider });
      notify("Đã mở Terminal. Đăng nhập trong CLI, rồi kiểm tra lại kết nối AI.", "info");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không mở được Terminal để đăng nhập."); }
    finally {
      await refreshStatus();
      terminalOpening.current = false; setConnectionPending("");
    }
  };
  const reset = useCallback((next?: ReplayData) => {
    if (toolOwner.current) void backtestRequest("/backtest/tools/reset", "POST", { client_id: toolOwner.current }).catch(() => {});
    toolOwner.current = "";
    replayOwner.current = crypto.randomUUID();
    if (data && frame && (entries.length || failedAttempts.length || ledger.orders.length)) setSavedRuns(previous => [...previous, { symbol: data.symbol, granularity: data.granularity, demo: data.demo, cutoff: frame.cutoff, ledger, entries, failedAttempts, fee, second, teaching }]);
    generation.current += 1; queuedAnalysis.current = false; request.current?.abort(); request.current = null; busyRef.current = false;
    runtime.current = { ...runtime.current, data: next || data, cursor: -1, frame: (next || data) ? replayFrame((next || data)!, -1, second) : null, ledger: emptyLedger(), entries: [] };
    setBusy(false); setPlaying(false); setCursor(-1); setLedger(emptyLedger()); setEntries([]); setFailedAttempts([]); setAnalysisActivity(""); setNotice(""); setSession(value => value + 1);
    if (next) setData(next);
  }, [data, frame, entries, failedAttempts, ledger, fee, second, teaching]);

  const analyze = useCallback(async () => {
    if (busyRef.current) { queuedAnalysis.current = true; return; }
    if (!runtime.current.data) return;
    if (!runtime.current.canAnalyze) { setNotice(runtime.current.aiBlocked); return; }
    if (!runtime.current.frame?.bars.length) return;
    const version = generation.current;
    const controller = new AbortController(); request.current = controller; busyRef.current = true;
    setBusy(true); setNotice(""); setAnalysisActivity("Đang chờ CLI đọc chart."); setStartedAt(new Date().toISOString());
    const start = performance.now();
    const observedCutoff = runtime.current.frame.cutoff;
    const acknowledged: string[] = [];
    let completedAnalysis: AnalysisResult | undefined;
    let collectAcknowledgements: (() => Promise<void>) | undefined;
    const timeout = window.setTimeout(() => controller.abort(), backtestTiming.analysis_timeout_ms + backtestTiming.result_grace_ms);
    let polling = false;
    let pollDiagnostic = "";
    const toolOrders: { decision: BacktestDecision; received: number }[] = [];
    try {
      await waitForChart();
      if (version !== generation.current || controller.signal.aborted) return;
      // Snapshot đồng bộ ảnh, cutoff và ledger sau khi chart render xong.
      const snapshot = chart.current!.capture();
      const current = runtime.current;
      if (snapshot.frame.cutoff !== current.frame?.cutoff) { queuedAnalysis.current = true; return; }
      const context = paperLedgerContext(current.ledger);
      const owner = crypto.randomUUID(); toolOwner.current = owner;
      if (!replayOwner.current) replayOwner.current = crypto.randomUUID();
      const payload = (state: ReturnType<ReplayChartPort["state"]>, image = "") => {
        const current = runtime.current;
        return { client_id: owner, replay_id: replayOwner.current, symbol: current.data!.symbol, cutoff: state.frame.cutoff, granularity: current.data!.granularity, bars: state.frame.bars, image, drawings: state.drawings, indicators: state.indicators, position: current.ledger.position, orders: current.ledger.orders.slice(-100), teaching: current.teaching, history: current.entries.slice(-20).map(entry => ({ cutoff: entry.cutoff, action: entry.decision.action, reason: entry.decision.reason })) };
      };
      type Command = { id: string; name: "capture_chart" | "apply_chart" | "submit_order"; arguments: BacktestDecision; cutoff: number; position: PaperLedger["position"]; orders: PaperLedger["orders"] };
      type Acknowledgement = { client_id: string; command_id: string; frame: ReturnType<typeof payload>; error: string };
      const commandNotes = new Map<string, string>();
      const delivery = new ReplayToolDelivery<Acknowledgement>(ack => {
        const note = commandNotes.get(ack.command_id);
        if (!ack.error && note) acknowledged.push(note);
      });
      const valid = () => polling && version === generation.current && !controller.signal.aborted && toolOwner.current === owner;
      let auditFrame = payload(snapshot);
      collectAcknowledgements = async () => {
        const result = await backtestRequest<{ acknowledged?: string[] }>("/backtest/tools/sync", "POST", { client_id: owner, frame: auditFrame }, AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]));
        if (valid()) await delivery.confirm(result.acknowledged || []);
      };
      const poll = async () => {
        let stage = "chart_state";
        const diagnose = (code: string) => {
          if (pollDiagnostic !== code) console.warn("Backtest tool delivery", { code, visibility: document.visibilityState });
          pollDiagnostic = code;
        };
        try {
          if (!valid() || !chart.current) { diagnose("chart_unavailable"); return false; }
          const state = chart.current.state();
          if (state.frame.cutoff !== runtime.current.frame?.cutoff) { diagnose("chart_frame_pending"); return false; }
          stage = "sync_request";
          const result = await backtestRequest<{ command: Command | null; analysis?: AnalysisResult; acknowledged?: string[]; activity?: { sequence: number; tool: keyof typeof toolLabel; state: "ACTIVE" | "DONE" | "ERROR" } | null }>("/backtest/tools/sync", "POST", { client_id: owner, frame: payload(state) }, AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]));
          const command = result.command;
          if (valid()) await delivery.confirm(result.acknowledged || []);
          if (valid() && result.analysis?.cutoff === snapshot.frame.cutoff) { completedAnalysis = result.analysis; return false; }
          if (valid() && result.activity && Object.hasOwn(toolLabel, result.activity.tool)) {
            setAnalysisActivity(`${toolLabel[result.activity.tool]}: ${result.activity.state === "DONE" ? "đã hoàn tất, đang chờ quyết định" : result.activity.state === "ERROR" ? "thất bại" : "đang thực hiện"}.`);
          }
          if (!valid() || !command) { pollDiagnostic = ""; return true; }
          stage = "command_prepare";
          await delivery.deliver(command.id, async () => {
            let error = "";
            try {
              if (command.name === "apply_chart") await chart.current!.apply(command.arguments.drawings, command.arguments.indicators);
              else if (command.name === "submit_order") {
                const current = runtime.current;
                if (!current.applyOrders) throw new Error("Tự áp dụng lệnh đang tắt.");
                if (!paperAccountMatches(command, { position: current.ledger.position, orders: current.ledger.orders.slice(-100) })) throw new Error("Ledger đã thay đổi, hãy đọc lại tài khoản mô phỏng.");
                const received = current.frame!.cutoff;
                const next = submitTimedPaperOrder(current.ledger, command.arguments, paperLedgerContext(current.ledger), command.cutoff, received);
                if (next !== current.ledger) toolOrders.push({ decision: command.arguments, received });
                commitLedger(next);
              } else if (command.name !== "capture_chart") throw new Error("MCP tool không được hỗ trợ.");
              await waitForChart();
            } catch { error = command.name === "apply_chart" ? "chart_apply_failed" : command.name === "submit_order" ? "order_rejected" : "capture_failed"; }
            if (!valid() || !chart.current) throw new DOMException("Replay changed", "AbortError");
            let next = state;
            try { next = chart.current.state(); }
            catch { error = "chart_frame_changed"; }
            if (next.frame.cutoff !== runtime.current.frame?.cutoff) { error = "chart_frame_changed"; }
            let image = "";
            if (command.name === "capture_chart" && !error) {
              try { image = chart.current.screenshot(); }
              catch { error = "capture_failed"; }
            }
            commandNotes.set(command.id, `${toolLabel[command.name]} lúc ${formatTime(next.frame.cutoff)}`);
            auditFrame = payload(next, image);
            return { client_id: owner, command_id: command.id, frame: auditFrame, error };
          }, ack => {
            stage = "ack_request";
            return backtestRequest("/backtest/tools/ack", "POST", ack, AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]));
          });
          pollDiagnostic = "";
          return true;
        } catch {
          diagnose(stage);
          return false;
        }
      };
      if (aiProvider === "CODEX" || aiProvider === "AGY") {
        polling = true;
        void pollReplayTools(() => valid() && !completedAnalysis, poll);
      }
      const result = await recoverBacktestAnalysis(async (): Promise<AnalysisResult> => {
        const response = await fetch(`${engineUrl}/backtest/analyze`, {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify(payload(snapshot, snapshot.image)),
        });
        if (response.headers.get("X-Quant-Transport-Error") === "1") throw new TypeError("Analysis response transport failed");
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "AI không trả về quyết định hợp lệ.");
        return result;
      }, () => completedAnalysis, controller.signal);
      if (version !== generation.current || controller.signal.aborted || result.cutoff !== snapshot.frame.cutoff) return;
      if (result.terminal_error) setStatus(previous => previous ? { ...previous, terminal_error: result.terminal_error } : previous);
      const decision = result.decision as BacktestDecision;
      await chart.current!.apply(decision.drawings, decision.indicators);
      if (version !== generation.current || controller.signal.aborted) return;
      const toolOrder = toolOrders.at(-1);
      const received = toolOrder?.received ?? runtime.current.frame!.cutoff;
      let application = toolOrder ? "Đã gửi lệnh mô phỏng qua MCP" : "Chưa áp dụng lệnh";
      if (decision.question) setNotice(decision.question);
      else if (!toolOrder && runtime.current.applyOrders) {
        try {
          const next = submitTimedPaperOrder(runtime.current.ledger, decision, context, snapshot.frame.cutoff, received);
          application = next === runtime.current.ledger ? "Không phát sinh lệnh" : "Đã áp dụng tại thời điểm nhận";
          commitLedger(next);
        } catch (error) { application = error instanceof Error ? error.message : "Không thể áp dụng lệnh."; setNotice(application); }
      }
      const recordedDecision = toolOrder ? { ...decision, action: toolOrder.decision.action, order_type: toolOrder.decision.order_type, stop_price: toolOrder.decision.stop_price, limit_price: toolOrder.decision.limit_price } : decision;
      setEntries(previous => [...previous, { cutoff: snapshot.frame.cutoff, received, context, application, applied: !!toolOrder, decision: recordedDecision, model: result.model, strategy_versions: result.strategy_versions, duration: Math.round((performance.now() - start) / 1000) }]);
    } catch (error) {
      if (version === generation.current && !controller.signal.aborted) await collectAcknowledgements?.().catch(() => {});
      if (version === generation.current) {
        queuedAnalysis.current = false;
        runtime.current.autoAi = false;
        setAutoAi(false);
        const message = error instanceof DOMException && error.name === "AbortError" ? "Đã dừng chờ quyết định AI. Thao tác đã xác nhận trước đó vẫn được giữ." : error instanceof Error ? error.message : "Không thể phân tích Backtest.";
        setNotice(message);
        setFailedAttempts(previous => [...previous.slice(-19), { cutoff: observedCutoff, message, actions: [...acknowledged, ...toolOrders.map(item => `${actionLabel[item.decision.action]} đã gửi vào sổ lệnh mô phỏng lúc ${formatTime(item.received)}`)], duration: Math.round((performance.now() - start) / 1000) }]);
      }
    } finally {
      polling = false;
      window.clearTimeout(timeout);
      if (version === generation.current) {
        request.current = null; busyRef.current = false; setBusy(false);
        const next = queuedAnalysis.current && runtime.current.autoAi && runtime.current.canAnalyze && !controller.signal.aborted;
        queuedAnalysis.current = false;
        // Coalesce về frame mới nhất, không tích lũy request theo từng phút.
        if (next) window.setTimeout(() => { if (version === generation.current) void analyzeRef.current(); }, 0);
      }
    }
  }, [commitLedger, aiProvider]);
  useEffect(() => { analyzeRef.current = analyze; }, [analyze]);

  const step = useCallback(() => {
    const current = runtime.current;
    if (!current.data || !current.frame || current.cursor >= current.minuteCount - 1) { setPlaying(false); return; }
    const index = current.cursor + 1;
    const next = replayFrame(current.data, index, current.second);
    commitLedger(advancePaperLedger(current.ledger, current.data, current.frame.cutoff, next.cutoff, current.fee));
    runtime.current.cursor = index; runtime.current.frame = next;
    setCursor(index);
    if (current.autoAi && current.canAnalyze && (index + 1) % current.cadence === 0) void analyzeRef.current();
    if (index >= current.minuteCount - 1) setPlaying(false);
  }, [commitLedger]);
  useEffect(() => {
    if (!playing || !active) return;
    const timer = window.setInterval(step, 1000 / speed);
    return () => window.clearInterval(timer);
  }, [playing, active, speed, step]);

  const trade = (action: BacktestDecision["action"]) => {
    const current = runtime.current;
    if (!current.frame?.bars.length) return;
    try { commitLedger(submitPaperOrder(current.ledger, { action, order_type: "MARKET", stop_price: null, limit_price: null, reason: "Lệnh mô phỏng trên chart", question: "", drawings: [] }, current.frame.cutoff)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Không thể gửi lệnh mô phỏng."); }
  };

  const placeDerivative = (ticket: DerivativeTicket, replacing?: string) => {
    const current = runtime.current;
    if (!current.frame?.bars.length) { setNotice("Nạp dữ liệu và mở nến trước khi đặt lệnh."); return false; }
    try {
      commitLedger(replacing ? replaceDerivativeOrder(current.ledger, replacing, ticket, current.frame.cutoff) : submitDerivativeOrder(current.ledger, ticket, current.frame.cutoff));
      setNotice(`Đã gửi ${ticket.side === "BUY" ? "LONG" : "SHORT"} ${ticket.quantity} hợp đồng mô phỏng. Xét khớp từ mẫu tiếp theo.`);
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không thể gửi lệnh mô phỏng."); return false; }
  };
  const positionAction = (reverse: boolean) => {
    const current = runtime.current, position = current.ledger.position;
    const last = current.frame?.bars.at(-1)?.close;
    if (!position || last === undefined || !current.frame) return;
    const side = position.side === "LONG" ? "SELL" : "BUY", quantity = position.quantity ?? 1;
    try {
      const cancelled = cancelDerivativeOrders(current.ledger, current.ledger.orders.map(order => order.id));
      let next = submitDerivativeOrder(cancelled, { side, kind: "normal", quantity, price: Math.round(last * 10) / 10, market: true, reduceOnly: true }, current.frame.cutoff);
      if (reverse) next = submitDerivativeOrder(next, { side, kind: "normal", quantity, price: Math.round(last * 10) / 10, market: true }, current.frame.cutoff);
      commitLedger(next);
      setNotice(`${reverse ? "Đảo" : "Đóng"} vị thế mô phỏng từ mẫu giá tiếp theo; lệnh chờ cũ đã hủy.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không thể xử lý vị thế."); }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setLoading(true); setPlaying(false);
    try { if (file.size > 32 * 1024 * 1024) throw new Error("File vượt giới hạn 32 MB."); reset(parseReplayData(JSON.parse(await file.text()))); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Không đọc được file lịch sử."); }
    finally { setLoading(false); if (upload.current) upload.current.value = ""; }
  };
  const loadHistory = async () => {
    setLoading(true); setPlaying(false); setNotice("");
    try {
      const from = Date.parse(`${date}T00:00:00+07:00`) / 1000;
      if (!Number.isFinite(from)) throw new Error("Ngày giao dịch không hợp lệ.");
      const params = new URLSearchParams({ symbol: symbol.trim(), granularity: resolution, from: String(from), to: String(from + 86400 - 1) });
      const response = await fetch(`/api/backtest/history?${params}`, { cache: "no-store" });
      const history = await response.json();
      if (!response.ok) throw new Error(history.error || "Không nạp được lịch sử.");
      reset(parseReplayData(history));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không tải được lịch sử từ nguồn dữ liệu riêng."); }
    finally { setLoading(false); }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify({ symbol: data?.symbol, granularity: data?.granularity, demo: data?.demo, mode: "offline-learning", fill_model: "sample-close-next-update", cutoff: frame?.cutoff, ledger, entries, failed_attempts: failedAttempts, fee, second, teaching, previous_runs: savedRuns }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `backtest-${data?.symbol || "session"}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const applyLatest = () => {
    const entry = entries.at(-1);
    if (!entry || !frame || entry.decision.question || entry.applied) return;
    try { commitLedger(submitTimedPaperOrder(runtime.current.ledger, entry.decision, entry.context, entry.cutoff, frame.cutoff)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Không thể áp dụng lệnh."); }
  };

  return <main className={styles.workspace} lang="vi" aria-label="Không gian Backtest">
    <div className={styles.container}>
      <header className={styles.heading}><div><h1>Backtest trực quan</h1><p>Chart M1, chiến lược của bạn và lệnh mô phỏng.</p></div><span className={styles.badge}>Chế độ học · chưa đánh giá tốc độ live</span></header>
      <section className={styles.source} aria-label="Nguồn dữ liệu Backtest">
        <div className={styles.sourceRow}>
          <div className={styles.sourceField}><label htmlFor="backtest-symbol">Mã giao dịch</label><button id="backtest-symbol" type="button" tabIndex={-1} className={styles.sourcePicker} disabled={busy || loading} aria-haspopup="dialog" onClick={event => openSourceDialog("symbol", event.currentTarget)}>{HEADER_SVGS.search}<span>{symbol}</span></button></div>
          <div className={styles.sourceField}><label htmlFor="backtest-date">Ngày lịch sử</label><button id="backtest-date" type="button" tabIndex={-1} className={styles.sourcePicker} disabled={busy || loading} aria-haspopup="dialog" onClick={event => openSourceDialog("date", event.currentTarget)}><span>{date.split("-").reverse().join("/")}</span>{GO_TO_DATE_ICON}</button></div>
          <div className={styles.sourceField}><label htmlFor="backtest-granularity">Độ chi tiết dữ liệu</label><ChartSelect<"1s" | "1m"> id="backtest-granularity" label="Độ chi tiết dữ liệu" value={resolution} disabled={busy || loading} onChange={setResolution} options={[{ value: "1m", label: "Nến M1" }, { value: "1s", label: "Dữ liệu giây (nhập JSON)", disabled: true }]} /></div>
          <button type="button" tabIndex={-1} disabled={busy || loading} onClick={() => void loadHistory()}><Icon name="history" />{loading ? "Đang nạp..." : "Nạp lịch sử"}</button>
          <button type="button" tabIndex={-1} disabled={busy || loading} onClick={() => upload.current?.click()}>Nhập JSON riêng</button>
          <button type="button" tabIndex={-1} disabled={busy || loading} onClick={() => reset(exampleReplay())}>Dữ liệu minh họa</button>
          <input ref={upload} className={styles.hidden} type="file" accept=".json,application/json" onChange={event => void loadFile(event.target.files?.[0])} />
        </div>
        <p className={styles.help}>Nạp lịch sử từ kết nối chart dùng nến M1. Dữ liệu giây thật: nhập JSON với symbol, granularity: 1s và bars gồm time (Unix giây bắt đầu mẫu), open, high, low, close, volume. Mỗi file là một ngày, một mã; volume là lượng của từng mẫu. Timestamp theo giây không chứng minh độ chi tiết mỗi giây.</p>
      </section>
      {notice && <GlobalNotice message={notice} onDismiss={() => setNotice(previous => previous === notice ? "" : previous)} />}
      <div className={styles.toolbar}>
        <button type="button" tabIndex={-1} className={`${styles.primary} ${styles.replayToggle}`} disabled={!data || loading || cursor >= minutes.length - 1 || !!connectionPending} onClick={() => setPlaying(value => !value)}><Icon name={playing ? "pause" : "play"} />{playing ? "Tạm dừng" : "Chạy replay"}</button>
        <button type="button" tabIndex={-1} disabled={!data || loading || !!connectionPending || cursor >= minutes.length - 1} onClick={() => { setPlaying(false); void step(); }}>Phút tiếp theo</button>
        <button type="button" tabIndex={-1} disabled={!data || loading} onClick={() => reset()}><Icon name="refresh" />Chạy lại từ đầu</button>
        <div className={styles.inline}><label htmlFor="backtest-speed">Tốc độ</label><ChartSelect id="backtest-speed" label="Tốc độ replay (nến M1)" value={speed} onChange={setSpeed} options={[{ value: .1, label: "1 nến / 10 giây" }, { value: .2, label: "1 nến / 5 giây" }, { value: .5, label: "1 nến / 2 giây" }, { value: 1, label: "1 nến / giây" }]} /></div>
        <div className={styles.clock}><span>Thời điểm replay (UTC+7)</span><strong>{frame ? formatTime(frame.cutoff) : "--:--:--"}</strong></div>
      </div>
      {data && <div className={styles.progress}><span className={`${styles.badge} ${data.demo ? styles.warning : ""}`}>{data.demo ? "Dữ liệu tổng hợp minh họa" : "Dữ liệu lịch sử đã nạp"}</span><progress value={cursor + 1} max={minutes.length} aria-label="Tiến độ replay" /><span>{cursor + 1} / {minutes.length} phút</span></div>}
      <DerivativesTerminal key={session} data={data} frame={frame} ledger={ledger} chart={<BacktestChart ref={chart} frame={frame} symbol={data?.symbol || "M1"} session={session} active={active} busy={busy} ledger={ledger} granularity={data?.granularity} />} onOrder={placeDerivative} onCancel={ids => commitLedger(cancelDerivativeOrders(runtime.current.ledger, ids))} onPosition={positionAction} />
      <div className={styles.layout}>
        <div className={styles.section}>

          <p className={styles.help}>{data?.granularity === "1s" ? `AI nhìn nến hiện tại đến giây ${second}, cùng toàn bộ nến đã xuất hiện trước đó.` : "Dữ liệu M1 chỉ mở nến sau khi đóng; không dựng tick hoặc diễn biến trong nến."} Replay chạy theo tốc độ đã chọn, không chờ AI. Lệnh nhận muộn chỉ có hiệu lực từ thời điểm nhận; thời gian xử lý được ghi riêng.</p>
          <section className={styles.panel} aria-label="Nhật ký quyết định"><div className={styles.panelHeading}><h2>Quyết định và drawing</h2><button type="button" tabIndex={-1} disabled={!entries.length && !failedAttempts.length && !ledger.orders.length && !savedRuns.length} onClick={download}><Icon name="export" />Xuất kết quả riêng</button></div>
            {busy && <AuditorThoughtLine working startedAt={startedAt} />}
            {busy && <p className={styles.help} role="status" aria-live="polite">{analysisActivity}</p>}
            {failedAttempts.slice().reverse().map((attempt, index) => <article className={styles.entry} key={`failed-${attempt.cutoff}-${index}`}><header><time>{formatTime(attempt.cutoff)}</time><span className={styles.warning}>Chưa có quyết định</span><span>{attempt.duration}s</span></header><p>{attempt.message}</p>{attempt.actions.length ? attempt.actions.map((action, actionIndex) => <p className={styles.help} key={actionIndex}>{action}</p>) : <p className={styles.help}>Chưa có thao tác chart hoặc lệnh mô phỏng được xác nhận.</p>}<p className={styles.help}>AI tự động đã dừng ở lượt này. Dùng Phân tích chart hiện tại để thử lại; bật AI giao dịch khi replay để tiếp tục tự động.</p></article>)}
            {!!savedRuns.length && <details><summary>{savedRuns.length} lượt trước được giữ riêng</summary>{savedRuns.map((run, index) => <p className={styles.help} key={index}>Lượt {index + 1} · {run.symbol} · {run.entries.length} quyết định · {run.ledger.pairs.length} cặp đóng · {run.ledger.pairs.reduce((sum, pair) => sum + pair.gross - pair.fee, 0).toFixed(2)} điểm sau phí</p>)}</details>}
            {!entries.length && !busy && <p className={styles.help}>AI nhận ảnh chart, các line, giá/volume đã replay và tài liệu chiến lược riêng.</p>}
            <div className={styles.journal}>{entries.slice().reverse().map((entry, index) => <article className={styles.entry} key={`${entry.cutoff}-${index}`}><header><time title="Thời điểm chart gửi cho AI">{formatTime(entry.cutoff)}</time><span className={styles.badge}>{actionLabel[entry.decision.action]}</span><span>{entry.duration}s · {entry.model.model || "Mặc định CLI"}</span></header><p>{entry.decision.reason}</p><p className={styles.help}>Nhận lúc {formatTime(entry.received)} · {entry.application}</p>{entry.decision.question && <p className={styles.warning}>{entry.decision.question}</p>}<p className={styles.help}>{entry.decision.drawings.length} drawing · {entry.decision.order_type}{entry.decision.stop_price !== null ? ` · Stop ${entry.decision.stop_price}` : ""}{entry.decision.limit_price !== null ? ` · Limit ${entry.decision.limit_price}` : ""}</p></article>)}</div>
          </section>
        </div>
        <aside className={styles.aside}>
          <section className={`${styles.panel} ${styles.aiPanel}`}>
            <BacktestConnectionSummary loading={statusLoading && !status} ready={canAnalyze} status={status} checking={connectionPending === "ai"} validating={connectionValidating && status?.connected === true} connectionDirty={connectionDirty && !connectionValidating} refreshing={statusLoading} refreshDisabled={busy || !!connectionPending} onRefresh={() => void refreshStatus()} />
            <AuditorConnection context="backtest" className={styles.connectionConfig} status={status} loading={statusLoading && !status} pending={connectionPending} disabled={busy || statusLoading || !!connectionPending} loadCatalog={loadCatalog} onDraftChange={updateConnectionDraft} onSaveAndCheck={settings => void saveAndCheckConnection(settings)} onOpenTerminal={provider => void openTerminal(provider)} />
            <button type="button" tabIndex={-1} disabled={busy || statusLoading || !!connectionPending} aria-busy={statusLoading} onClick={() => void refreshStatus()}>{statusLoading ? <LoadingIndicator compact label="Đang quét chiến lược" /> : <Icon name="refresh" />}Quét lại chiến lược</button>
            {!!status?.strategy_error && <GlobalNotice message={status.strategy_error} kind="warning" />}
            {!!aiBlocked && !statusLoading && <GlobalNotice message={aiBlocked} kind="info" />}
            <div className={styles.aiActions}>
              <button type="button" tabIndex={-1} className={`${styles.primary} ${styles.full}`} disabled={!frame?.bars.length || !canAnalyze || busy || loading} onClick={() => void analyze()}>Phân tích chart hiện tại</button>
              {busy && <button type="button" tabIndex={-1} onClick={() => { queuedAnalysis.current = false; if (toolOwner.current) void backtestRequest("/backtest/tools/reset", "POST", { client_id: toolOwner.current }).catch(() => {}); request.current?.abort(); }}>Dừng chờ kết quả</button>}
            </div>
            <div className={styles.aiSettings}>
              <label className={`${styles.inline} ${styles.aiToggle}`}><input type="checkbox" tabIndex={-1} checked={autoAi} disabled={busy || !canAnalyze} onChange={event => setAutoAi(event.target.checked)} />AI giao dịch khi replay</label>
              <div className={styles.sourceField}><label htmlFor="backtest-cadence">Khoảng phân tích</label><ChartSelect id="backtest-cadence" label="Khoảng phân tích" value={cadence} disabled={busy} onChange={setCadence} options={[{ value: 1, label: "Mỗi phút" }, { value: 3, label: "Mỗi 3 phút" }, { value: 5, label: "Mỗi 5 phút" }]} /></div>
              <label className={styles.aiSecond}><span>Giây trong nến<small>Dữ liệu giây</small></span><input tabIndex={-1} type="number" min={55} max={60} value={second} disabled={busy || !!entries.length || cursor >= 0 || data?.granularity === "1m"} onChange={event => setSecond(Math.max(55, Math.min(60, Number(event.target.value) || 55)))} /></label>
            </div>
            <p className={`${styles.help} ${styles.aiHint}`}>System prompt Backtest điều khiển AI như trader mô phỏng. Markdown được tự quét và không bắt buộc; không có tài liệu thì AI tự xây dựng cách giao dịch. Quyết định được gửi vào lệnh mô phỏng khi bật áp dụng tự động.</p>
          </section>
          <section className={styles.panel}><h2>Lệnh mô phỏng</h2><div className={styles.metrics}><div><span>Cặp đóng</span><strong>{ledger.pairs.length}</strong></div><div><span>Phí (điểm)</span><strong>{fees.toFixed(2)}</strong></div><div><span>Sau phí</span><strong className={gross - fees < 0 ? styles.negative : styles.positive}>{(gross - fees).toFixed(2)}</strong></div></div>
            <p>{ledger.position ? `${ledger.position.side} ${ledger.position.quantity ?? 1} @ ${ledger.position.price.toFixed(2)}` : "Chưa có vị thế"}</p>
            <label className={styles.inline}><input type="checkbox" tabIndex={-1} checked={applyOrders} disabled={busy} onChange={event => setApplyOrders(event.target.checked)} />Áp dụng lệnh AI tự động</label>
            <button type="button" tabIndex={-1} disabled={busy || !frame || !entries.length || !!entries.at(-1)?.decision.question || !!entries.at(-1)?.applied} onClick={applyLatest}>Áp dụng quyết định hiện tại</button>
            <button type="button" tabIndex={-1} disabled={!ledger.orders.some(order => ["waiting", "triggered"].includes(order.status))} onClick={() => trade("CANCEL")}>Hủy lệnh chờ</button>
            <label>Phí mỗi cặp (điểm)<input tabIndex={-1} type="number" min={0} step={.01} value={fee} disabled={busy || !!ledger.orders.length} onChange={event => setFee(Math.max(0, Number(event.target.value) || 0))} /></label>
            <p className={styles.help}>Một vị thế ròng, tối đa 1.000 hợp đồng mỗi chiều. Stop-Limit kích hoạt theo giá đóng mẫu, chỉ xét khớp Limit từ mẫu tiếp theo. Không giả lập partial fill, sổ lệnh hoặc thanh khoản. Chưa tự đóng vị thế cuối phiên.</p>
            {ledger.orders.slice(-8).reverse().map(order => <div className={styles.order} key={order.id}><strong>{order.side} · {order.type}</strong><span>{orderLabel[order.status]}</span><small>{order.stop !== null ? `Stop ${order.stop} · ` : ""}{order.limit !== null ? `Limit ${order.limit}` : ""}{order.price !== null ? `Khớp @ ${order.price.toFixed(2)}` : ""}</small></div>)}
          </section>
          <section className={styles.panel}><h2>Hướng dẫn cho lượt tiếp theo</h2><textarea tabIndex={-1} value={teaching} maxLength={6000} disabled={busy} placeholder="Giải thích cách chọn điểm, kẻ line hoặc sửa cách AI hiểu..." aria-label="Hướng dẫn cho AI" onChange={event => setTeaching(event.target.value)} /><p className={styles.help}>Không cung cấp diễn biến tương lai. Hướng dẫn không tự sửa tài liệu chiến lược. Chạy lại giữ kết quả cũ riêng trong tab, không gửi chúng cho AI. Xuất kết quả trước khi đóng hoặc tải lại trang.</p></section>
        </aside>
      </div>
    </div>
    {sourceDialog === "symbol" && createPortal(<div className="backtest-source-dialog" data-leaving={sourceClosing}><SymbolSearchModal isOpen currentSymbol={symbol} onClose={closeSourceDialog} onSelectSymbol={setSymbol} /></div>, document.body)}
    {sourceDialog === "date" && createPortal(<div className="backtest-source-dialog" data-leaving={sourceClosing}><GoToDateDialog timezone="Asia/Ho_Chi_Minh" daily dateOnly title="Ngày lịch sử" submitLabel="Chọn ngày" initialRange={{ from: Date.parse(`${date}T00:00:00Z`) / 1000, to: Date.parse(`${date}T00:00:00Z`) / 1000 }} onClose={closeSourceDialog} onNavigate={async from => { setDate(new Date(from * 1000).toISOString().slice(0, 10)); }} /></div>, document.body)}
  </main>;
}

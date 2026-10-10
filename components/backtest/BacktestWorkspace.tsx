"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { advancePaperLedger, emptyLedger, exampleReplay, parseReplayData, replayFrame, replayMinutes, submitPaperOrder, type BacktestDecision, type PaperLedger, type ReplayData } from "../../lib/backtest";
import { backtestRequest, engineUrl } from "../../lib/backtest-client";
import { activateBacktest } from "../../lib/backtest-status";
import { notify } from "../../lib/notifications";
import { Icon } from "../auditor/AuditorUi";
import AuditorConnection from "../auditor/AuditorConnection";
import GlobalNotice from "../ui/GlobalNotice";
import type { AiCatalog, AiSettings } from "../../lib/auditor-client";
import AuditorThoughtLine from "../auditor/AuditorThoughtLine";
import BacktestChart, { type BacktestChartHandle } from "./BacktestChart";
import BacktestConnectionSummary from "./BacktestConnectionSummary";
import styles from "./BacktestWorkspace.module.css";
import { SymbolSearchModal } from "../chart/layout/symbols/SymbolSearchModal";
import { GoToDateDialog, GO_TO_DATE_ICON } from "../chart/layout/navigation/GoToDateDialog";
import { HEADER_SVGS } from "../chart/layout/navigation/ChartHeader";
import { ChartSelect } from "../chart/ui/ChartSelect";

type Status = AiSettings & { adapter_ready: boolean; strategy_available: boolean; strategy_documents: string[]; strategy_error?: string; error?: string; terminal_error?: string; connected: boolean | null; busy: boolean };
const loadCatalog = (provider: AiSettings["provider"], refresh: boolean, signal: AbortSignal) => backtestRequest<AiCatalog>(`/ai/catalog?provider=${provider}&refresh=${refresh}`, "GET", undefined, signal);
type Entry = { cutoff: number; decision: BacktestDecision; model: { model: string; effort: string }; strategy_versions: string[]; duration: number };
type SavedRun = { symbol: string; granularity: string; demo: boolean; cutoff: number; ledger: PaperLedger; entries: Entry[]; fee: number; second: number; teaching: string };
const formatTime = (time: number) => new Date(time * 1000).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
const actionLabel = { HOLD: "Chờ", OPEN_LONG: "Mở LONG", OPEN_SHORT: "Mở SHORT", CLOSE: "Đóng vị thế", CANCEL: "Hủy lệnh chờ" };
const orderLabel = { waiting: "Chờ kích hoạt / khớp", triggered: "Đã kích hoạt, chưa khớp", filled: "Đã khớp mô phỏng", cancelled: "Đã hủy" };
const waitForChart = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export default function BacktestWorkspace({ active }: { active: boolean }) {
  const chart = useRef<BacktestChartHandle>(null);
  const upload = useRef<HTMLInputElement>(null);
  const strategyUpload = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
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
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [ledger, setLedger] = useState<PaperLedger>(emptyLedger);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [teaching, setTeaching] = useState("");
  const [autoAi, setAutoAi] = useState(false);
  const [applyOrders, setApplyOrders] = useState(false);
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
  const canAnalyze = !!status?.adapter_ready && !!status.strategy_available && !!status.connected && !connectionDirty && !connectionPending;
  const aiBlocked = connectionDirty ? "Lưu cấu hình AI đã chọn trước khi phân tích." : !status ? "Đang chờ trạng thái Backtest." : !status.adapter_ready ? "Chưa cài bộ kết nối AI riêng cho Backtest." : !status.strategy_available ? status.strategy_error || "Nhập tài liệu chiến lược Markdown để AI biết quy tắc Backtest." : !status.connected ? "Kiểm tra kết nối CLI đã chọn trước khi phân tích." : "";
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
  useEffect(() => () => { generation.current += 1; request.current?.abort(); }, []);

  const checkConnection = async () => {
    setStatusLoading(true); setConnectionPending("ai"); setPlaying(false); setNotice("");
    try {
      await activateBacktest();
      const result = await backtestRequest<{ connected: boolean; error?: string }>("/backtest/connection/test", "POST");
      if (!result.connected) setNotice(result.error || "Chưa kết nối được CLI đã chọn.");
      await refreshStatus();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không kiểm tra được kết nối."); }
    finally { setStatusLoading(false); setConnectionPending(""); }
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
  const saveConnection = async (settings: AiSettings) => {
    setConnectionPending("ai-config"); setPlaying(false); setNotice("");
    try { await backtestRequest("/backtest/connection/config", "POST", settings); await refreshStatus(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Không lưu được kết nối AI."); }
    finally { setConnectionPending(""); }
  };
  const importStrategy = async (file?: File) => {
    if (!file) return;
    setConnectionPending("strategy"); setPlaying(false); setNotice("");
    try {
      if (!file.name.toLowerCase().endsWith(".md") || file.size > 100000) throw new Error("Chọn tài liệu Markdown (.md) không vượt 100 KB.");
      await backtestRequest("/backtest/strategy", "POST", { content: await file.text() });
      await refreshStatus();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không nhập được chiến lược."); }
    finally { setConnectionPending(""); if (strategyUpload.current) strategyUpload.current.value = ""; }
  };

  const reset = useCallback((next?: ReplayData) => {
    if (data && frame && (entries.length || ledger.orders.length)) setSavedRuns(previous => [...previous, { symbol: data.symbol, granularity: data.granularity, demo: data.demo, cutoff: frame.cutoff, ledger, entries, fee, second, teaching }]);
    generation.current += 1; request.current?.abort(); request.current = null; busyRef.current = false;
    setBusy(false); setPlaying(false); setCursor(-1); setLedger(emptyLedger()); setEntries([]); setNotice(""); setSession(value => value + 1);
    if (next) setData(next);
  }, [data, frame, entries, ledger, fee, second, teaching]);

  const analyze = useCallback(async (index = cursor, currentLedger = ledger) => {
    if (!data || busyRef.current) return;
    if (!canAnalyze) { setNotice(aiBlocked); setPlaying(false); return; }
    const visible = replayFrame(data, index, second);
    if (!visible.bars.length) { setNotice("Chưa có mẫu giá tại mốc phân tích này."); return; }
    const version = generation.current;
    const controller = new AbortController(); request.current = controller; busyRef.current = true;
    setBusy(true); setNotice(""); setStartedAt(new Date().toISOString());
    const start = performance.now();
    const timeout = window.setTimeout(() => controller.abort(), 130000);
    try {
      await waitForChart();
      if (version !== generation.current) return;
      const response = await fetch(`${engineUrl}/backtest/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ symbol: data.symbol, cutoff: visible.cutoff, granularity: data.granularity, bars: visible.bars, image: chart.current!.screenshot(), drawings: chart.current!.drawings(), position: currentLedger.position, orders: currentLedger.orders.slice(-100), teaching, history: entries.slice(-20).map(entry => ({ cutoff: entry.cutoff, action: entry.decision.action, reason: entry.decision.reason })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "AI không trả về quyết định hợp lệ.");
      if (version !== generation.current || result.cutoff !== visible.cutoff) return;
      if (result.terminal_error) setStatus(previous => previous ? { ...previous, terminal_error: result.terminal_error } : previous);
      const decision = result.decision as BacktestDecision;
      chart.current!.apply(decision.drawings);
      setEntries(previous => [...previous, { cutoff: visible.cutoff, decision, model: result.model, strategy_versions: result.strategy_versions, duration: Math.round((performance.now() - start) / 1000) }]);
      if (decision.question) { setPlaying(false); setNotice(decision.question); }
      else if (applyOrders) setLedger(submitPaperOrder(currentLedger, decision, visible.cutoff));
    } catch (error) {
      if (version === generation.current) { setPlaying(false); setNotice(error instanceof DOMException && error.name === "AbortError" ? "Đã dừng chờ AI. Không áp dụng kết quả; khung replay được giữ nguyên." : error instanceof Error ? error.message : "Không thể phân tích Backtest."); }
    } finally {
      window.clearTimeout(timeout);
      if (version === generation.current) { request.current = null; busyRef.current = false; setBusy(false); }
    }
  }, [cursor, ledger, data, canAnalyze, aiBlocked, second, teaching, entries, applyOrders]);

  const step = useCallback(async () => {
    if (!data || !frame || busyRef.current || cursor >= minutes.length - 1) { setPlaying(false); return; }
    const index = cursor + 1;
    const next = replayFrame(data, index, second);
    const updated = advancePaperLedger(ledger, data, frame.cutoff, next.cutoff, fee);
    setLedger(updated); setCursor(index);
    if (autoAi && (index + 1) % cadence === 0) await analyze(index, updated);
  }, [data, frame, cursor, minutes.length, second, ledger, fee, autoAi, cadence, analyze]);
  useEffect(() => {
    if (!playing || !active || busy) return;
    const timer = window.setTimeout(() => void step(), 1000 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, active, busy, speed, step]);

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
    const blob = new Blob([JSON.stringify({ symbol: data?.symbol, granularity: data?.granularity, demo: data?.demo, mode: "offline-learning", fill_model: "sample-close-next-update", cutoff: frame?.cutoff, ledger, entries, fee, second, teaching, previous_runs: savedRuns }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `backtest-${data?.symbol || "session"}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const applyLatest = () => {
    const entry = entries.at(-1);
    if (!entry || !frame || entry.cutoff !== frame.cutoff || entry.decision.question) return;
    try { setLedger(submitPaperOrder(ledger, entry.decision, frame.cutoff)); }
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
        <button type="button" tabIndex={-1} className={`${styles.primary} ${styles.replayToggle}`} disabled={!data || loading || cursor >= minutes.length - 1 || busy || !!connectionPending} onClick={() => setPlaying(value => !value)}><Icon name={playing ? "pause" : "play"} />{playing ? "Tạm dừng" : "Chạy replay"}</button>
        <button type="button" tabIndex={-1} disabled={!data || busy || loading || !!connectionPending || cursor >= minutes.length - 1} onClick={() => { setPlaying(false); void step(); }}>Phút tiếp theo</button>
        <button type="button" tabIndex={-1} disabled={!data || loading} onClick={() => reset()}><Icon name="refresh" />Chạy lại từ đầu</button>
        <div className={styles.inline}><label htmlFor="backtest-speed">Tốc độ</label><ChartSelect id="backtest-speed" label="Tốc độ replay" value={speed} onChange={setSpeed} options={[{ value: 1, label: "1 phút / giây" }, { value: .5, label: "1 phút / 2 giây" }, { value: 2, label: "2 phút / giây" }]} /></div>
        <div className={styles.clock}><span>Thời điểm replay (UTC+7)</span><strong>{frame ? formatTime(frame.cutoff) : "--:--:--"}</strong></div>
      </div>
      {data && <div className={styles.progress}><span className={`${styles.badge} ${data.demo ? styles.warning : ""}`}>{data.demo ? "Dữ liệu tổng hợp minh họa" : "Dữ liệu lịch sử đã nạp"}</span><progress value={cursor + 1} max={minutes.length} aria-label="Tiến độ replay" /><span>{cursor + 1} / {minutes.length} phút</span></div>}
      <div className={styles.layout}>
        <div className={styles.section}>
          <BacktestChart ref={chart} frame={frame} symbol={data?.symbol || "M1"} session={session} active={active} busy={busy} />
          <p className={styles.help}>{data?.granularity === "1s" ? `AI nhìn nến hiện tại đến giây ${second}, cùng toàn bộ nến đã xuất hiện trước đó.` : "Dữ liệu M1 chỉ mở nến sau khi đóng; không dựng tick hoặc diễn biến trong nến."} Replay chờ lượt AI trong chế độ học, thời gian xử lý thực được ghi riêng.</p>
          <section className={styles.panel} aria-label="Nhật ký quyết định"><div className={styles.panelHeading}><h2>Quyết định và drawing</h2><button type="button" tabIndex={-1} disabled={!entries.length && !ledger.orders.length && !savedRuns.length} onClick={download}><Icon name="export" />Xuất kết quả riêng</button></div>
            {busy && <AuditorThoughtLine working startedAt={startedAt} />}
            {!!savedRuns.length && <details><summary>{savedRuns.length} lượt trước được giữ riêng</summary>{savedRuns.map((run, index) => <p className={styles.help} key={index}>Lượt {index + 1} · {run.symbol} · {run.entries.length} quyết định · {run.ledger.pairs.length} cặp đóng · {run.ledger.pairs.reduce((sum, pair) => sum + pair.gross - pair.fee, 0).toFixed(2)} điểm sau phí</p>)}</details>}
            {!entries.length && !busy && <p className={styles.help}>AI nhận ảnh chart, các line, giá/volume đã replay và tài liệu chiến lược riêng.</p>}
            <div className={styles.journal}>{entries.slice().reverse().map((entry, index) => <article className={styles.entry} key={`${entry.cutoff}-${index}`}><header><time>{formatTime(entry.cutoff)}</time><span className={styles.badge}>{actionLabel[entry.decision.action]}</span><span>{entry.duration}s · {entry.model.model || "Mặc định CLI"}</span></header><p>{entry.decision.reason}</p>{entry.decision.question && <p className={styles.warning}>{entry.decision.question}</p>}<p className={styles.help}>{entry.decision.drawings.length} drawing · {entry.decision.order_type}{entry.decision.stop_price !== null ? ` · Stop ${entry.decision.stop_price}` : ""}{entry.decision.limit_price !== null ? ` · Limit ${entry.decision.limit_price}` : ""}</p></article>)}</div>
          </section>
        </div>
        <aside className={styles.aside}>
          <section className={`${styles.panel} ${styles.aiPanel}`}>
            <BacktestConnectionSummary loading={statusLoading && !status} ready={canAnalyze} status={status} refreshing={statusLoading} refreshDisabled={busy || !!connectionPending} onRefresh={() => void refreshStatus()} />
            <AuditorConnection context="backtest" className={styles.connectionConfig} status={status} loading={statusLoading && !status} pending={connectionPending} disabled={busy || statusLoading || !!connectionPending} loadCatalog={loadCatalog} onDraftChange={setConnectionDirty} onSave={settings => void saveConnection(settings)} onCheck={() => void checkConnection()} onOpenTerminal={provider => void openTerminal(provider)} />
            <button type="button" tabIndex={-1} disabled={busy || statusLoading || !!connectionPending} onClick={() => strategyUpload.current?.click()}>{connectionPending === "strategy" ? "Đang nhập chiến lược..." : status?.strategy_available ? "Thay chiến lược Markdown" : "Nhập chiến lược Markdown"}</button>
            <input ref={strategyUpload} className={styles.hidden} type="file" accept=".md,text/markdown" onChange={event => void importStrategy(event.target.files?.[0])} />
            {!!aiBlocked && !statusLoading && <GlobalNotice message={aiBlocked} kind="info" />}
            <div className={styles.aiActions}>
              <button type="button" tabIndex={-1} disabled={busy || statusLoading || connectionDirty || !!connectionPending} aria-busy={connectionPending === "ai"} onClick={() => void checkConnection()}>Kiểm tra kết nối AI</button>
              <button type="button" tabIndex={-1} className={`${styles.primary} ${styles.full}`} disabled={!frame?.bars.length || !canAnalyze || busy || loading} onClick={() => { setPlaying(false); void analyze(); }}>Phân tích chart hiện tại</button>
              {busy && <button type="button" tabIndex={-1} onClick={() => { request.current?.abort(); setPlaying(false); }}>Dừng chờ kết quả</button>}
            </div>
            <div className={styles.aiSettings}>
              <label className={`${styles.inline} ${styles.aiToggle}`}><input type="checkbox" tabIndex={-1} checked={autoAi} disabled={busy || !canAnalyze} onChange={event => setAutoAi(event.target.checked)} />AI phân tích khi replay</label>
              <div className={styles.sourceField}><label htmlFor="backtest-cadence">Khoảng phân tích</label><ChartSelect id="backtest-cadence" label="Khoảng phân tích" value={cadence} disabled={busy} onChange={setCadence} options={[{ value: 1, label: "Mỗi phút" }, { value: 3, label: "Mỗi 3 phút" }, { value: 5, label: "Mỗi 5 phút" }]} /></div>
              <label className={styles.aiSecond}><span>Giây trong nến<small>Dữ liệu giây</small></span><input tabIndex={-1} type="number" min={55} max={60} value={second} disabled={busy || !!entries.length || cursor >= 0 || data?.granularity === "1m"} onChange={event => setSecond(Math.max(55, Math.min(60, Number(event.target.value) || 55)))} /></label>
            </div>
            <p className={`${styles.help} ${styles.aiHint}`}>Backtest dùng kết nối AI riêng, không cần khởi động Auditor. Khoảng phân tích là cấu hình thử nghiệm, không tự thay quy tắc chiến lược.</p>
          </section>
          <section className={styles.panel}><h2>Lệnh mô phỏng</h2><div className={styles.metrics}><div><span>Cặp đóng</span><strong>{ledger.pairs.length}</strong></div><div><span>Phí (điểm)</span><strong>{fees.toFixed(2)}</strong></div><div><span>Sau phí</span><strong className={gross - fees < 0 ? styles.negative : styles.positive}>{(gross - fees).toFixed(2)}</strong></div></div>
            <p>{ledger.position ? `${ledger.position.side} 1 @ ${ledger.position.price.toFixed(2)}` : "Chưa có vị thế"}</p>
            <label className={styles.inline}><input type="checkbox" tabIndex={-1} checked={applyOrders} disabled={busy} onChange={event => setApplyOrders(event.target.checked)} />Áp dụng lệnh AI tự động</label>
            <button type="button" tabIndex={-1} disabled={busy || !frame || !entries.length || entries.at(-1)?.cutoff !== frame.cutoff || !!entries.at(-1)?.decision.question} onClick={applyLatest}>Áp dụng quyết định hiện tại</button>
            <button type="button" tabIndex={-1} disabled={busy || !ledger.orders.some(order => ["waiting", "triggered"].includes(order.status))} onClick={() => setLedger(previous => submitPaperOrder(previous, { action: "CANCEL" } as BacktestDecision, frame?.cutoff || 0))}>Hủy lệnh chờ</button>
            <label>Phí mỗi cặp (điểm)<input tabIndex={-1} type="number" min={0} step={.01} value={fee} disabled={busy || !!ledger.orders.length} onChange={event => setFee(Math.max(0, Number(event.target.value) || 0))} /></label>
            <p className={styles.help}>Một vị thế, một hợp đồng. Stop-Limit kích hoạt theo giá đóng mẫu, chỉ xét khớp Limit từ mẫu tiếp theo. Không giả lập partial fill, sổ lệnh hoặc thanh khoản. Chưa tự đóng vị thế cuối phiên.</p>
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

"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { auditEventLabel, auditorRequest, engineUrl, reportUrl, type AiStatus, type AuditEvent, type CaptureMode, type CaptureWindow, type DecisionPreview, type RecordingState, type SessionGroup, type Snapshot, type StrategyState, type TerminalHost } from "../../lib/auditor-client";
import AuditorFeed from "./AuditorFeed";
import AuditorFormula from "./AuditorFormula";
import AuditorToggleGroup from "./AuditorToggleGroup";
import AuditorStrategy from "./AuditorStrategy";
import AuditorDeleteDialog from "./AuditorDeleteDialog";
import AuditorNotifications, { type AuditorNotification } from "./AuditorNotifications";
import { AuditorSelect, Icon, TerminalSelect, points } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const captureModes: readonly { value: CaptureMode; label: string }[] = [
  { value: "DESKTOP", label: "Desktop" },
  { value: "IN_APP", label: "Trình duyệt" },
];

export default function AuditorWorkspace({ active: isActive = true }: { active?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [reconnectKey, setReconnectKey] = useState(0);
  const [pending, setPending] = useState("");
  const busy = useRef(false);
  const [terminalPending, setTerminalPending] = useState(false);
  const terminalBusy = useRef(false);
  const [notifications, setNotifications] = useState<AuditorNotification[]>([]);
  const notificationSequence = useRef(0);
  const notify = useCallback((notice: Omit<AuditorNotification, "id">) => {
    const id = ++notificationSequence.current;
    setNotifications(previous => [...previous, { ...notice, id }].slice(-3));
  }, []);
  const dismissNotification = useCallback((id: number) => {
    setNotifications(previous => previous.filter(notice => notice.id !== id));
  }, []);
  const [host, setHost] = useState<TerminalHost>("ORCA");
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [target, setTarget] = useState(0);
  const [windows, setWindows] = useState<CaptureWindow[]>([]);
  const clientId = useRef("");
  const [decisionPreview, setDecisionPreview] = useState<DecisionPreview | null>(null);
  const [price, setPrice] = useState("");
  const [contracts, setContracts] = useState("1");
  const [rationale, setRationale] = useState("");
  const [validation, setValidation] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const [sessionError, setSessionError] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ date: string; id: string } | "all" | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [reports, setReports] = useState<{ date: string; id: string; pdf: boolean } | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [capturePending, setCapturePending] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const mounted = useRef(true);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  const applySnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setEvents(next.recent_events || []);
    setHost(next.config?.terminal_type || "ORCA");
    setTarget(next.target_window_id || 0);
    setAi(next.gemini_status || null);
    setReports(null);
    setDecisionPreview(null);
  }, []);
  const upsertEvent = useCallback((event: AuditEvent) => {
    const current = snapshotRef.current;
    if (!current || (event.session_id && (event.session_id !== current.session_id || event.date !== current.current_date))) return;
    setEvents(previous => previous.some(item => item.id === event.id)
      ? previous.map(item => item.id === event.id ? { ...item, ...event } : item)
      : [...previous, event].slice(-200));
  }, []);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const connect = () => {
      if (stopped) return;
      setConnection("connecting");
      const address = new URL(engineUrl);
      if (!clientId.current) clientId.current = crypto.randomUUID();
      address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
      address.pathname = "/ws";
      address.searchParams.set("client_id", clientId.current);
      socket = new WebSocket(address);
      socket.onopen = () => { if (!stopped) { delay = 1000; setConnection("connected"); } };
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "INIT_STATE" || message.type === "SESSION_SWITCHED") {
            applySnapshot({ ...snapshotRef.current, ...message, current_date: message.current_date || message.date || "" });
          } else if (message.event) {
            if (message.session_id && message.session_id !== snapshotRef.current?.session_id) return;
            upsertEvent(message.event);
            if (message.summary) setSnapshot(previous => previous ? { ...previous, summary: message.summary } : previous);
          } else if (message.type === "MODE_CHANGED" || message.type === "RECORDING_CHANGED") {
            setSnapshot(previous => previous ? { ...previous, ...message } : previous);
            setTarget(message.target_window_id || 0);
          } else if (message.type === "STRATEGY_MODE_CHANGED") {
            setSnapshot(previous => previous ? { ...previous, strategy_mode: message.enabled } : previous);
            setDecisionPreview(null);
          } else if (message.type === "STRATEGY_CHANGED") {
            setSnapshot(previous => previous ? { ...previous, strategy_mode: message.strategy_mode, config: message.config } : previous);
            setDecisionPreview(null);
          } else if (message.type === "ERROR") notify({ kind: "error", text: message.message });
        } catch { notify({ kind: "error", text: "Không đọc được dữ liệu từ bộ máy phân tích. Hãy kết nối lại để tải dữ liệu phiên." }); }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnection("disconnected");
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(timer); socket?.close(); };
  }, [applySnapshot, upsertEvent, reconnectKey, notify]);

  useEffect(() => {
    if (connection !== "connected" || snapshot?.protocol_version !== 3 || snapshot.mode !== "DESKTOP") return;
    const controller = new AbortController();
    void auditorRequest<{ windows: CaptureWindow[] }>("/windows", undefined, "GET", controller.signal)
      .then(result => setWindows(result.windows))
      .catch(error => { if (!controller.signal.aborted) setCaptureError(errorText(error)); });
    return () => controller.abort();
  }, [connection, snapshot?.protocol_version, snapshot?.mode]);

  const perform = async (key: string, action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(key);
    try { await action(); }
    catch (error) { notify({ kind: "error", text: errorText(error) }); }
    finally { busy.current = false; setPending(""); }
  };
  const openTerminal = async () => {
    if (terminalBusy.current) return;
    terminalBusy.current = true;
    setTerminalPending(true);
    try {
      const result = await auditorRequest<{ status: string }>("/terminal/open", { terminal_type: host });
      notify({ kind: "success", text: result.status === "disabled" ? "Chức năng mở Terminal đang bị tắt." : result.status === "opened" ? "Đã mở Orca Terminal để theo dõi phiên." : "Đã mở Terminal. Hãy kiểm tra cửa sổ đã chọn để theo dõi phiên." });
    } catch (error) { notify({ kind: "error", text: errorText(error) }); }
    finally { terminalBusy.current = false; setTerminalPending(false); }
  };
  const refreshSessions = async () => {
    setSessionLoading(true);
    setSessionError("");
    try { const result = await auditorRequest<{ dates: SessionGroup[] }>("/sessions"); setSessionGroups(result.dates); }
    catch (error) { setSessionError(errorText(error)); }
    finally { setSessionLoading(false); }
  };
  useLayoutEffect(() => {
    if (drawerOpen && !drawer.current?.open) drawer.current?.showModal();
    if (!drawerOpen && drawer.current?.open) drawer.current?.close();
  }, [drawerOpen]);
  useEffect(() => {
    if (!isActive) {
      setDeleteTarget(null);
      setDrawerOpen(false);
    }
  }, [isActive]);
  const openSessions = () => { setDrawerOpen(true); setDeleteTarget(null); void refreshSessions(); };
  const requestDelete = (target: NonNullable<typeof deleteTarget>) => {
    setDeleteError("");
    setDeleteTarget(target);
  };
  const deleteSessions = () => void perform("delete", async () => {
    if (!deleteTarget) return;
    setDeleteError("");
    try {
      const path = deleteTarget === "all" ? "/sessions" : `/sessions/${encodeURIComponent(deleteTarget.date)}/${encodeURIComponent(deleteTarget.id)}`;
      const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>(path, undefined, "DELETE");
      applySnapshot(result);
      setSessionGroups(result.dates);
      setDeleteTarget(null);
      notify({ kind: "success", text: deleteTarget === "all" ? "Đã xóa tất cả phiên đã lưu." : "Đã xóa phiên và dữ liệu minh chứng." });
    } catch (error) {
      setDeleteError(errorText(error));
      throw error;
    }
  });
  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      void fetch(`${engineUrl}/api/recording`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pause", source_id: clientId.current, browser_only: true, capture_generation: snapshotRef.current?.capture_generation }), keepalive: true }).catch(() => {});
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; };
  }, []);
  useEffect(() => { if (snapshot?.mode === "DESKTOP") stopCapture(); }, [snapshot?.mode, stopCapture]);
  useEffect(() => {
    if (stream && video.current) {
      video.current.srcObject = stream;
      const enabled = snapshot?.recording_status === "recording";
      stream.getVideoTracks().forEach(track => { track.enabled = enabled; });
      if (enabled) void video.current.play().catch(error => setCaptureError(errorText(error)));
      else video.current.pause();
    }
  }, [stream, snapshot?.recording_status]);
  const startCapture = async () => {
    if (capturePending) return;
    setCapturePending(true);
    setCaptureError("");
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Chia sẻ màn hình cần trình duyệt hỗ trợ trên localhost hoặc HTTPS.");
      const next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (next.getVideoTracks()[0]?.getSettings().displaySurface === "monitor") {
        next.getTracks().forEach(track => track.stop());
        throw new Error("Hãy chọn một thẻ trình duyệt hoặc cửa sổ ứng dụng thay vì toàn bộ màn hình.");
      }
      if (!mounted.current || snapshotRef.current?.mode !== "IN_APP") { next.getTracks().forEach(track => track.stop()); return; }
      stopCapture();
      streamRef.current = next;
      next.getVideoTracks()[0]?.addEventListener("ended", () => { if (mounted.current) stopCapture(); }, { once: true });
      setStream(next);
      const result = await auditorRequest<RecordingState>("/mode", { mode: "IN_APP", browser_source_id: clientId.current });
      setSnapshot(previous => previous ? { ...previous, ...result } : previous);
    } catch (error) { if (mounted.current) { stopCapture(); setCaptureError(errorText(error)); } }
    finally { if (mounted.current) setCapturePending(false); }
  };
  const captureFrame = () => {
    const element = video.current;
    if (!streamRef.current || !element?.videoWidth) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext("2d")?.drawImage(element, 0, 0);
    return canvas.toDataURL("image/png");
  };
  const testDecision = (direction: "LONG" | "SHORT", save = false) => {
    if (!Number.isFinite(Number(price)) || Number(price) <= 0 || !Number.isInteger(Number(contracts)) || Number(contracts) < 1 || Number(contracts) > 1000) {
      setValidation("Nhập giá lớn hơn 0 và số hợp đồng nguyên từ 1 đến 1000.");
      return;
    }
    if (save && snapshot?.mode === "IN_APP" && !streamRef.current) { setCaptureError("Chọn thẻ trình duyệt hoặc cửa sổ trước khi lưu lệnh giả lập."); return; }
    setValidation("");
    void perform(save ? "save-test" : direction, async () => {
      const context = { session_id: snapshotRef.current?.session_id, session_date: snapshotRef.current?.current_date, source_id: clientId.current };
      const result = await auditorRequest<DecisionPreview>("/decision-test", { ...context, direction, price: Number(price), contracts: Number(contracts), voice_transcript: rationale, save, frame_base64: save && snapshot?.mode === "IN_APP" ? captureFrame() : undefined });
      setDecisionPreview(result);
      if (result.event) upsertEvent(result.event);
      if (save) notify({ kind: "success", text: `Đã lưu lệnh ${direction} kèm minh chứng. Vị thế và lãi/lỗ của phiên không thay đổi.` });
    });
  };
  const setMode = (mode: CaptureMode, windowId = 0) => void perform("mode", async () => {
    if (streamRef.current) stopCapture();
    const result = await auditorRequest<RecordingState>("/mode", { mode, target_window_id: windowId });
    setSnapshot(previous => previous ? { ...previous, ...result } : previous);
    setTarget(result.target_window_id);
  });
  const changeRecording = (action: "start" | "pause" | "resume" | "stop") => void perform(action === "stop" ? "recording-stop" : "recording", async () => {
    const result = await auditorRequest<RecordingState>("/recording", { action, source_id: clientId.current });
    setSnapshot(previous => previous ? { ...previous, ...result } : previous);
  });
  const newSession = () => void perform("session", async () => {
    const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>("/sessions/new", {});
    applySnapshot(result);
    setSessionGroups(result.dates);
    notify({ kind: "success", text: "Đã tạo phiên mới. Các phiên trước vẫn được giữ lại." });
  });
  const ready = connection === "connected" && snapshot?.protocol_version === 3;
  const disabled = !ready || !!pending;
  const active = !!snapshot?.session_id;
  const recording = snapshot?.recording_status === "recording";
  const hasSource = snapshot?.mode === "IN_APP" ? !!stream && snapshot.browser_source_id === clientId.current : !!snapshot?.target_window_id;
  const summary = snapshot?.summary;
  const visibleEvents = useMemo(() => events.filter(event => {
    if (filter === "warnings" && !event.warnings?.length) return false;
    if (filter === "tests" && event.type !== "DECISION_TEST") return false;
    if (filter === "rejects" && event.action !== "REJECT") return false;
    return !query || [auditEventLabel(event), event.action, event.type, event.voice_transcript, event.ai_thesis, event.reason, ...(event.warnings || []).map(item => item.message)].join(" ").toLowerCase().includes(query.toLowerCase());
  }).reverse(), [events, filter, query]);
  const aiLabel = ai?.connected === true ? "AGY đã kết nối" : ai?.connected === false ? "AGY chưa khả dụng" : ai?.available ? "AGY đã cài đặt" : "Chưa tìm thấy AGY";
  const totalSessions = sessionGroups.reduce((count, group) => count + group.sessions.length, 0);
  const captureOptions = useMemo(() => [
    { value: 0, label: "Chọn cửa sổ..." },
    ...(target > 0 && !windows.some(window => window.id === target) ? [{ value: target, label: snapshot?.target_window_title || "Cửa sổ đã chọn không khả dụng", disabled: true }] : []),
    ...windows.map(window => ({ value: window.id, label: window.title })),
  ], [windows, target, snapshot?.target_window_title]);

  return <main className={styles.workspace} lang="vi" aria-label="Không gian phân tích Quant">
    <div className={styles.container}>
      <header className={styles.sessionBar}>
        <div className={styles.sessionInfo}>
          <div className={styles.sessionIdentity}>
            <h1>Phiên hiện tại</h1>
            <strong className={styles.mono}>{active ? `${snapshot!.current_date} / ${snapshot!.session_id.replace("session_", "")}` : ready ? "Chưa có phiên hoạt động" : "Đang chờ bộ máy phân tích"}</strong>
          </div>
          <div className={styles.sessionButtons}>
            <button type="button" className={styles.button} ref={drawerTrigger} onClick={openSessions}><Icon name="history" />Các phiên</button>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={newSession}><Icon name="plus" />{pending === "session" ? "Đang tạo..." : "Tạo phiên"}</button>
          </div>
        </div>
        <div className={styles.terminalControls}>
          <TerminalSelect value={host} disabled={disabled || !isActive} onChange={value => void perform("host", async () => { const result = await auditorRequest<{ terminal_type: TerminalHost }>("/terminal/config", { terminal_type: value }); setHost(result.terminal_type); })} />
          <button type="button" className={`${styles.button} ${styles.terminalButton}`} disabled={disabled || terminalPending || !active || host === "NONE"} aria-busy={terminalPending} onClick={() => void openTerminal()}>{terminalPending ? "Đang mở..." : "Mở Terminal"}</button>
        </div>
      </header>
      {!ready && <div className={styles.connectionNotice} role="status"><Icon name="warning" /><div><strong>{connection === "connected" ? "Đang chờ cập nhật bộ máy phân tích" : connection === "connecting" ? "Đang kết nối bộ máy phân tích" : "Bộ máy phân tích chưa khả dụng"}</strong><p>Bộ máy phân tích tự khởi động khi mở Quant. Hệ thống sẽ tự kết nối lại. Nếu vẫn chưa kết nối được, hãy kiểm tra Terminal đang chạy ứng dụng. {snapshot && "Dữ liệu phiên đang hiển thị có thể chưa được cập nhật."}</p></div><button className={styles.button} type="button" onClick={() => setReconnectKey(value => value + 1)}><Icon name="refresh" />Kết nối lại</button></div>}
      {ready && !active && <div className={styles.connectionNotice}><Icon name="history" /><div><strong>Bắt đầu một phiên</strong><p>Tạo phiên mới hoặc chọn từ lịch sử. Tải lại trang vẫn giữ phiên đã chọn.</p></div><button className={styles.button} type="button" onClick={openSessions}>Xem lịch sử</button></div>}
      <section className={styles.metrics} aria-label="Kết quả phiên">
        <div><div className={styles.metricHeading}><span title="Mỗi cặp tương ứng một hợp đồng có đủ lệnh mở và đóng.">Cặp lệnh đã đóng</span>{isActive && <AuditorFormula feePerPair={snapshot?.config.strategy_guardrails?.fee_per_closed_pair} />}</div><strong>{summary?.total_closed_pairs ?? "..."}</strong><small>{summary ? `${summary.open_longs_count} LONG / ${summary.open_shorts_count} SHORT đang mở` : "Đang chờ dữ liệu phiên"}</small></div>
        <div><span>Lãi/lỗ gộp</span><strong className={styles.mono}>{points(summary?.total_gross_points, true)} <small>điểm</small></strong><small>Trước phí giao dịch</small></div>
        <div><span>Phí</span><strong className={styles.mono}>{points(summary ? -summary.total_fees_points : undefined)} <small>điểm</small></strong><small>Áp dụng cho cặp lệnh đã đóng</small></div>
        <div><span>Lãi/lỗ ròng</span><strong className={`${styles.mono} ${(summary?.total_net_points || 0) < 0 ? styles.negative : styles.positive}`}>{points(summary?.total_net_points, true)} <small>điểm</small></strong><small>Sau phí giao dịch</small></div>
      </section>
      <div className={styles.layout}>
        <aside className={styles.controls}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}><h2>Nguồn ghi hình</h2><Icon name="capture" /></div>
            <AuditorToggleGroup label="Nguồn ghi hình" variant="capture" value={snapshot?.mode} options={captureModes} disabled={disabled} onChange={mode => setMode(mode)} />
            {snapshot?.mode !== "IN_APP" ? <div className={styles.field}>
              <label htmlFor="auditor-window">Cửa sổ ghi hình</label>
              <div className={styles.inputAction}>
                <AuditorSelect id="auditor-window" label="Cửa sổ ghi hình" icon="capture" value={target} options={captureOptions} disabled={disabled || !isActive} onChange={value => setMode("DESKTOP", value)} />
                <button type="button" className={styles.iconButton} disabled={disabled} aria-label="Làm mới danh sách cửa sổ" onClick={() => void perform("windows", async () => { const result = await auditorRequest<{ windows: CaptureWindow[] }>("/windows"); setWindows(result.windows); setCaptureError(""); })}><Icon name="refresh" /></button>
              </div>
              <p className={styles.help}>Chỉ ghi hình cửa sổ đã chọn. Sự kiện được ghi tự động khi bạn tương tác với cửa sổ đó.</p>
            </div> : <div className={styles.capture}>
              <video ref={video} autoPlay muted playsInline className={stream ? styles.preview : styles.hidden} aria-label="Xem trước màn hình chia sẻ" />
              {!stream && <p className={styles.help}>Chọn thẻ biểu đồ hoặc cửa sổ ứng dụng. Không thể dùng toàn bộ màn hình làm nguồn ghi hình.</p>}
              <button type="button" className={styles.button} disabled={(!stream && disabled) || capturePending} onClick={() => stream ? stopCapture() : void startCapture()}><Icon name="capture" />{capturePending ? "Đang chọn..." : stream ? "Dừng chia sẻ" : "Chọn thẻ hoặc cửa sổ"}</button>
            </div>}
            {captureError && <p className={styles.error} role="alert">{captureError}</p>}
            <div className={styles.recordingPanel}>
              <div className={styles.sectionHeading}><strong>Ghi hình</strong><span className={recording ? styles.positive : styles.muted}>{recording ? "Ghi hình" : snapshot?.recording_status === "paused" ? "Tạm dừng" : "Đã dừng"}</span></div>
              <div className={styles.recordingActions}>
                <button type="button" tabIndex={-1} className={`${styles.button} ${recording ? styles.pauseButton : styles.primary} ${styles.fullWidth}`} disabled={disabled || (!recording && (!active || !hasSource))} onClick={() => changeRecording(recording ? "pause" : snapshot?.recording_status === "paused" ? "resume" : "start")}><Icon name={recording ? "pause" : "play"} />{pending === "recording" ? "Đang cập nhật..." : recording ? "Tạm dừng ghi" : snapshot?.recording_status === "paused" ? "Tiếp tục ghi" : "Bắt đầu ghi"}</button>
                <button type="button" tabIndex={-1} className={`${styles.button} ${styles.sellButton} ${styles.fullWidth}`} disabled={disabled || !active || !["recording", "paused"].includes(snapshot?.recording_status || "")} onClick={() => changeRecording("stop")}><Icon name="stop" />{pending === "recording-stop" ? "Đang dừng..." : "Dừng ghi"}</button>
              </div>
              <label className={styles.autoStart}><input type="checkbox" checked={snapshot?.auto_start_recording ?? true} disabled={disabled} onChange={event => { const autoStart = event.target.checked; void perform("auto-start", async () => { const result = await auditorRequest<RecordingState>("/recording/preference", { auto_start: autoStart }); setSnapshot(previous => previous ? { ...previous, ...result } : previous); }); }} /><span>Tự bắt đầu ghi khi chọn nguồn</span></label>
              {!active ? <p className={styles.help}>Tạo hoặc mở lại một phiên trước khi bắt đầu.</p> : !hasSource ? <p className={styles.help}>Chọn nguồn để bật ghi hình.</p> : !recording && <p className={styles.help}>Chưa ghi ảnh chụp và nhật ký sự kiện. Phiên và nguồn đã chọn vẫn được giữ lại.</p>}
              {snapshot?.recording_error && <p className={styles.error} role="alert">{snapshot.recording_error}</p>}
            </div>
          </section>
          <AuditorStrategy
            key={snapshot?.config?.strategy_notes || ""}
            notes={snapshot?.config?.strategy_notes || ""}
            enabled={snapshot?.strategy_mode ?? false}
            disabled={disabled}
            saving={pending === "strategy-save"}
            onSave={notes => void perform("strategy-save", async () => {
              const result = await auditorRequest<StrategyState>("/strategy", { notes });
              setSnapshot(previous => previous ? { ...previous, ...result } : previous);
              setDecisionPreview(null);
              notify({ kind: "success", text: result.strategy_mode ? "Đã lưu chiến lược. Các lệnh giả lập tiếp theo sẽ được đánh giá theo quy tắc này." : "Đã xóa chiến lược. Việc ghi hình tiếp tục mà không áp dụng quy tắc chiến lược." });
            })}
            onToggle={enabled => void perform("strategy", async () => {
              await auditorRequest("/strategy-mode", { enabled });
              setSnapshot(previous => previous ? { ...previous, strategy_mode: enabled } : previous);
              setDecisionPreview(null);
            })}
          />
          <section className={styles.panel}>
            <h2>Giả lập đặt lệnh</h2><p className={styles.help}>Xem trước lệnh LONG hoặc SHORT, rồi lưu để đánh giá theo chiến lược của bạn.</p>
            <div className={styles.formRow}>
              <div className={styles.field}><label htmlFor="auditor-price">Giá vào lệnh</label><input id="auditor-price" inputMode="decimal" type="number" min="0" step="any" value={price} aria-invalid={!!validation} disabled={disabled} placeholder="Ví dụ: 1250.5" onChange={event => { setPrice(event.target.value); setValidation(""); setDecisionPreview(null); }} /></div>
              <div className={styles.field}><label htmlFor="auditor-contracts">Số hợp đồng</label><input id="auditor-contracts" type="number" min="1" max="1000" step="1" value={contracts} aria-invalid={!!validation} disabled={disabled} onChange={event => { setContracts(event.target.value); setValidation(""); setDecisionPreview(null); }} /></div>
            </div>
            {validation && <p className={styles.error} role="alert">{validation}</p>}
            <div className={styles.field}><label htmlFor="auditor-rationale">Luận điểm vào lệnh</label><textarea id="auditor-rationale" rows={3} value={rationale} disabled={disabled} placeholder="Điều gì hỗ trợ lệnh này? Khi nào luận điểm không còn hợp lệ?" onChange={event => { setRationale(event.target.value); setDecisionPreview(null); }} /></div>
            <div className={styles.tradeActions}><button type="button" className={`${styles.button} ${styles.buyButton}`} disabled={disabled} onClick={() => testDecision("LONG")}>{pending === "LONG" ? "Đang kiểm tra..." : "LONG"}</button><button type="button" className={`${styles.button} ${styles.sellButton}`} disabled={disabled} onClick={() => testDecision("SHORT")}>{pending === "SHORT" ? "Đang kiểm tra..." : "SHORT"}</button></div>
            {decisionPreview && <div className={styles.testPreview} aria-live="polite"><strong className={decisionPreview.direction === "LONG" ? styles.positive : styles.negative}>{decisionPreview.direction} tại {decisionPreview.price.toLocaleString("en-US")}</strong><p className={styles.help}>{decisionPreview.contracts} hợp đồng · {decisionPreview.saved ? "Đã lưu lệnh giả lập" : "Chỉ xem trước"}</p>{decisionPreview.warnings.length ? decisionPreview.warnings.map((warning, index) => <p key={`${warning.type}-${index}`} className={styles.warning}>{warning.message}</p>) : <p className={styles.help}>{snapshot?.strategy_mode ? "Bản xem trước chưa đánh giá nội dung chiến lược. Lưu lệnh giả lập để AGY phân tích." : "Chưa có chiến lược. Bản xem trước chưa có kết luận đánh giá."}</p>}<button type="button" className={`${styles.button} ${styles.fullWidth}`} disabled={disabled || !active || !recording || !hasSource || decisionPreview.saved} onClick={() => testDecision(decisionPreview.direction, true)}>{pending === "save-test" ? "Đang lưu..." : decisionPreview.saved ? "Đã lưu lệnh giả lập" : "Lưu lệnh kèm minh chứng"}</button><p className={styles.help}>{!recording ? "Bắt đầu ghi để lưu lệnh giả lập này." : "Lệnh giả lập đã lưu không làm thay đổi vị thế hoặc lãi/lỗ đã thực hiện."}</p></div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}><h2>Phân tích</h2><span className={`${styles.smallStatus} ${ai?.connected === false ? styles.warning : styles.muted}`}>{aiLabel}</span></div>
            <p className={styles.help}>AGY dùng tài khoản bạn đã đăng nhập. Lệnh đã lưu sẽ được phân tích, ảnh chụp được giữ làm minh chứng.</p>
            <button type="button" className={styles.button} disabled={disabled} onClick={() => void perform("ai", async () => { const result = await auditorRequest<AiStatus>("/gemini/status"); setAi(result); })}><Icon name="refresh" />{pending === "ai" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</button>
            {ai?.error && <p className={styles.error} role="alert">{ai.error}</p>}
            {ai?.latency_ms !== undefined && <p className={styles.help}>Lần kiểm tra gần nhất: {ai.latency_ms} ms</p>}
          </section>
          <button type="button" className={`${styles.button} ${styles.fullWidth}`} disabled={disabled || !active} onClick={() => void perform("export", async () => {
            const result = await auditorRequest<{ date: string; session_id: string; reports: { pdf: string } }>("/end-session", {});
            setReports({ date: result.date, id: result.session_id, pdf: !!result.reports.pdf });
            notify({ kind: "success", text: "Đã xuất báo cáo phiên. Bạn vẫn có thể tiếp tục ghi hình." });
          })}><Icon name="export" />{pending === "export" ? "Đang xuất..." : "Xuất báo cáo phiên"}</button>
          {reports && <div className={styles.reportLinks}><a href={reportUrl(reports.date, reports.id, "html")} target="_blank" rel="noreferrer">Mở báo cáo HTML</a>{reports.pdf && <a href={reportUrl(reports.date, reports.id, "pdf")} target="_blank" rel="noreferrer">Mở báo cáo PDF</a>}</div>}
        </aside>
        <AuditorFeed snapshot={snapshot} events={visibleEvents} total={events.length} ready={ready} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} />
      </div>
    </div>
    <dialog id="auditor-history-dialog" ref={drawer} className={`${styles.workspace} ${styles.drawer}`} aria-labelledby="auditor-history-title" onCancel={() => setDrawerOpen(false)} onClose={() => { setDrawerOpen(false); drawerTrigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) setDrawerOpen(false); }}>
      <div className={styles.drawerHeading}><div><h2 id="auditor-history-title">Lịch sử phiên</h2><p className={styles.help}>Mở lại phiên đã lưu mà không cần tạo phiên mới.</p></div><button type="button" className={styles.iconButton} aria-label="Đóng lịch sử phiên" onClick={() => setDrawerOpen(false)}><Icon name="close" /></button></div>
      <div className={styles.drawerActions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={newSession}><Icon name="plus" />Tạo phiên</button>
        <button type="button" className={`${styles.button} ${styles.deleteButton}`} disabled={disabled || sessionLoading || totalSessions === 0} onClick={() => requestDelete("all")}>Xóa tất cả phiên</button>
        <button type="button" className={styles.iconButton} aria-label="Làm mới danh sách phiên" disabled={sessionLoading} onClick={() => void refreshSessions()}><Icon name="refresh" /></button>
      </div>
      {sessionError && <p className={styles.error} role="alert">{sessionError}</p>}
      {sessionLoading && <p className={styles.help} role="status">Đang tải phiên...</p>}
      {!sessionLoading && !sessionGroups.length && <div className={styles.empty}><Icon name="history" /><h3>Chưa có phiên đã lưu</h3><p>Bắt đầu một phiên khi bạn sẵn sàng ghi lệnh giả lập.</p></div>}
      {sessionGroups.map(group => <section className={styles.sessionGroup} key={group.date}><h3 className={styles.mono}>{group.date}</h3>{group.sessions.map(session => {
        const selected = session.date === snapshot?.current_date && session.id === snapshot?.session_id;
        return <div className={`${styles.sessionItem} ${selected ? styles.selected : ""}`} key={session.id}><div className={styles.sessionTitle}><strong>{session.label}</strong>{selected && <span className={styles.positive}><Icon name="check" />Hiện tại</span>}</div><p className={styles.help}>{session.events_count} sự kiện đã ghi</p><div className={styles.sessionActions}>{!selected && <button type="button" className={styles.button} disabled={disabled} onClick={() => void perform("switch", async () => { const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>("/sessions/switch", { date: session.date, session_id: session.id }); applySnapshot(result); setSessionGroups(result.dates); setDeleteTarget(null); })}>Mở lại</button>}{session.has_html && <a href={reportUrl(session.date, session.id, "html")} target="_blank" rel="noreferrer">HTML</a>}{session.has_pdf && <a href={reportUrl(session.date, session.id, "pdf")} target="_blank" rel="noreferrer">PDF</a>}<button type="button" className={`${styles.button} ${styles.deleteButton}`} disabled={disabled} onClick={() => requestDelete({ date: session.date, id: session.id })}>Xóa</button></div></div>;
      })}</section>)}
    </dialog>
    {deleteTarget && isActive && (
      <AuditorDeleteDialog
        title={deleteTarget === "all" ? "Xóa tất cả phiên?" : "Xóa phiên này?"}
        description={deleteTarget === "all" ? `Xóa ${totalSessions} phiên đã lưu, bao gồm ảnh chụp và báo cáo. Không thể hoàn tác thao tác này.` : `Xóa phiên ${deleteTarget.date} / ${deleteTarget.id} cùng ảnh chụp và báo cáo. Không thể hoàn tác thao tác này.`}
        confirmLabel={deleteTarget === "all" ? "Xóa tất cả phiên" : "Xóa phiên"}
        pending={pending === "delete"}
        disabled={disabled}
        error={deleteError}
        onConfirm={deleteSessions}
        onCancel={() => setDeleteTarget(null)}
      />
    )}
    <AuditorNotifications notices={notifications} onDismiss={dismissNotification} modalId={isActive ? deleteTarget ? "auditor-delete-dialog" : drawerOpen ? "auditor-history-dialog" : undefined : undefined} />
  </main>;
}

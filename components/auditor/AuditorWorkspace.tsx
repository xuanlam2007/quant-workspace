"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { auditEventLabel, auditorRequest, engineUrl, reportUrl, type AiStatus, type AiSettings, type AuditEvent, type RecordingState, type SessionGroup, type Snapshot, type Summary, type TerminalHost } from "../../lib/auditor-client";
import { captureBrowserTab } from "../../lib/auditor-capture";
import type { CaptureMode, CaptureWindow } from "../../lib/auditor-client";
import AuditorToggleGroup from "./AuditorToggleGroup";
import AuditorFeed from "./AuditorFeed";
import AuditorMetrics from "./AuditorMetrics";
import { SessionsLoading } from "./AuditorLoadingParts";
import AuditorCapturePreview from "./AuditorCapturePreview";
import AuditorStrategy from "./AuditorStrategy";
import AuditorConnection from "./AuditorConnection";
import { useAuditorAudio } from "./useAuditorAudio";
import AuditorAudio from "./AuditorAudio";
import AuditorDeleteDialog from "./AuditorDeleteDialog";
import AuditorNotifications, { type AuditorNotification } from "./AuditorNotifications";
import AuditorNotice from "./AuditorNotice";
import { AuditorSelect, Icon, TerminalSelect } from "./AuditorUi";
import { LoadingBlock, LoadingIndicator, LoadingNumber, LoadingText, Skeleton } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";
import { activateAuditor } from "../../lib/auditor-status";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const captureModes: { value: CaptureMode; label: string }[] = [
  { value: "DESKTOP", label: "Desktop" }, { value: "IN_APP", label: "Trình duyệt" },
];

export default function AuditorWorkspace({ active: isActive = true }: { active?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [connectionNoticeVisible, setConnectionNoticeVisible] = useState(false);
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
  const clientId = useRef("");
  const [microphone, setMicrophone] = useState(true);
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
  const [previewReady, setPreviewReady] = useState(false);
  const [windows, setWindows] = useState<CaptureWindow[]>([]);
  const [windowsLoading, setWindowsLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  const applySnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setEvents(next.recent_events || []);
    setHost(next.config?.terminal_type || "ORCA");
    setAi(next.gemini_status || null);
    setReports(null);
  }, []);
  const upsertEvent = useCallback((event: AuditEvent, summary?: Summary) => {
    const current = snapshotRef.current;
    if (!current || (event.session_id && (event.session_id !== current.session_id || event.date !== current.current_date))) return;
    if (summary) setSnapshot(previous => previous ? { ...previous, summary } : previous);
    setEvents(previous => previous.some(item => item.id === event.id)
      ? previous.map(item => item.id === event.id ? { ...item, ...event } : item)
      : [...previous, event].slice(-200));
  }, []);
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const connect = async () => {
      if (stopped) return;
      setConnection("connecting");
      if (!clientId.current) clientId.current = crypto.randomUUID();
      try {
        const result = await auditorRequest<{ url: string }>("/socket", { client_id: clientId.current });
        if (stopped) return;
        socket = new WebSocket(result.url);
      } catch {
        if (!stopped) {
          setConnection("disconnected");
          timer = setTimeout(() => void connect(), delay);
          delay = Math.min(delay * 2, 15000);
        }
        return;
      }
      socket.onopen = () => { if (!stopped) { delay = 1000; setConnection("connected"); } };
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "INIT_STATE" || message.type === "SESSION_SWITCHED") {
            applySnapshot({ ...snapshotRef.current, ...message, current_date: message.current_date || message.date || "" });
          } else if (message.event) {
            if (message.session_id && (message.session_id !== snapshotRef.current?.session_id || message.date !== snapshotRef.current?.current_date)) return;
            upsertEvent(message.event, message.summary);
          } else if (message.type === "MODE_CHANGED" || message.type === "RECORDING_CHANGED") {
            setSnapshot(previous => previous ? { ...previous, ...message } : previous);
          } else if (message.type === "STRATEGY_MODE_CHANGED") {
            setSnapshot(previous => previous ? { ...previous, strategy_mode: message.enabled, strategy_available: message.strategy_available, strategy_documents: message.strategy_documents, strategy_error: message.strategy_error } : previous);
          } else if (message.type === "AI_CONFIG_CHANGED") {
            setAi(message.ai_status);
          } else if (message.type === "ERROR") notify({ kind: "error", text: message.message });
        } catch { notify({ kind: "error", text: "Không đọc được dữ liệu từ bộ máy phân tích. Hãy kết nối lại để tải dữ liệu phiên." }); }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        setConnection("disconnected");
        timer = setTimeout(() => void connect(), delay);
        delay = Math.min(delay * 2, 15000);
      };
    };
    void connect();
    return () => { stopped = true; clearTimeout(timer); socket?.close(); };
  }, [applySnapshot, upsertEvent, reconnectKey, notify]);

  useEffect(() => {
    if (connection !== "connected" || snapshot?.protocol_version !== 3 || snapshot.mode !== "DESKTOP") return;
    const controller = new AbortController();
    setWindowsLoading(true);
    void auditorRequest<{ windows: CaptureWindow[] }>("/windows", undefined, "GET", controller.signal)
      .then(result => { if (!controller.signal.aborted) setWindows(result.windows); })
      .catch(error => { if (!controller.signal.aborted) setCaptureError(errorText(error)); })
      .finally(() => { if (!controller.signal.aborted) setWindowsLoading(false); });
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
      void fetch(`${engineUrl}/recording`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pause", source_id: clientId.current, browser_only: true, capture_generation: snapshotRef.current?.capture_generation }), keepalive: true }).catch(() => {});
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStream(null);
    setPreviewReady(false);
    if (video.current) video.current.srcObject = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null; };
  }, []);
  useEffect(() => { if (snapshot?.mode === "DESKTOP") stopCapture(); }, [snapshot?.mode, stopCapture]);
  useEffect(() => {
    if (stream && video.current) {
      if (video.current.srcObject !== stream) video.current.srcObject = stream;
      void video.current.play().catch(error => setCaptureError(errorText(error)));
    }
  }, [stream]);
  const startCapture = async () => {
    if (capturePending) return;
    setCapturePending(true);
    setCaptureError("");
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Chia sẻ màn hình cần trình duyệt hỗ trợ trên localhost hoặc HTTPS.");
      const options: DisplayMediaStreamOptions & { surfaceSwitching: "exclude"; monitorTypeSurfaces: "exclude" } = { video: true, audio: false, surfaceSwitching: "exclude", monitorTypeSurfaces: "exclude" };
      const next = await navigator.mediaDevices.getDisplayMedia(options);
      if (next.getVideoTracks()[0]?.getSettings().displaySurface !== "browser") {
        next.getTracks().forEach(track => track.stop());
        throw new Error("Chỉ chọn browser tab. Cửa sổ ứng dụng và toàn bộ màn hình không được dùng làm nguồn ghi.");
      }
      if (!mounted.current || snapshotRef.current?.mode !== "IN_APP") { next.getTracks().forEach(track => track.stop()); return; }
      stopCapture();
      streamRef.current = next;
      next.getVideoTracks()[0]?.addEventListener("ended", () => { if (mounted.current && streamRef.current === next) stopCapture(); }, { once: true });
      setStream(next);
      setPreviewReady(false);
      const result = await auditorRequest<RecordingState>("/mode", { mode: "IN_APP", browser_source_id: clientId.current });
      if (!mounted.current || streamRef.current !== next || next.getVideoTracks()[0]?.readyState !== "live") {
        void auditorRequest("/recording", { action: "pause", source_id: clientId.current, browser_only: true, capture_generation: result.capture_generation }).catch(() => {});
        return;
      }
      setSnapshot(previous => previous ? { ...previous, ...result } : previous);
    } catch (error) { if (mounted.current) { stopCapture(); setCaptureError(errorText(error)); } }
    finally { if (mounted.current) setCapturePending(false); }
  };
  const captureFrame = useCallback(() => {
    const element = video.current;
    return element && streamRef.current ? captureBrowserTab(element, streamRef.current) : undefined;
  }, []);
  const setMode = (mode: CaptureMode, windowId = 0) => void perform("mode", async () => {
    if (capturePending) return;
    stopCapture();
    setCaptureError("");
    const result = await auditorRequest<RecordingState>("/mode", { mode, target_window_id: windowId });
    setSnapshot(previous => previous ? { ...previous, ...result } : previous);
  });
  useEffect(() => {
    if (!stream || !previewReady || connection !== "connected" || snapshot?.mode !== "IN_APP" || snapshot.recording_status !== "recording" || snapshot.browser_source_id !== clientId.current) return;
    let stopped = false;
    let capturing = false;
    const save = async () => {
      if (capturing || stopped) return;
      const current = snapshotRef.current;
      const frame = captureFrame();
      if (!frame || !current?.session_id) return;
      capturing = true;
      try {
        const result = await auditorRequest<{ event: AuditEvent }>("/observation", { frame_base64: frame, session_id: current.session_id, session_date: current.current_date, source_id: clientId.current, capture_generation: current.capture_generation });
        if (!stopped) upsertEvent(result.event);
      } catch (error) { if (!stopped) setCaptureError(errorText(error)); }
      finally { capturing = false; }
    };
    const timer = window.setInterval(() => void save(), 15000);
    void save();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [stream, previewReady, connection, snapshot?.mode, snapshot?.recording_status, snapshot?.browser_source_id, snapshot?.session_id, snapshot?.capture_generation, captureFrame, upsertEvent]);
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
  useEffect(() => {
    if (ready) {
      setConnectionNoticeVisible(false);
      return;
    }
    // Chỉ hiện thông báo khi kết nối chậm kéo dài, tránh làm nhảy bố cục lúc khởi động.
    const timer = window.setTimeout(() => setConnectionNoticeVisible(true), 5000);
    return () => window.clearTimeout(timer);
  }, [ready]);
  const disabled = !ready || !!pending;
  const active = !!snapshot?.session_id;
  const recording = snapshot?.recording_status === "recording";
  const hasSource = snapshot?.mode === "DESKTOP" ? !!snapshot.target_window_id : snapshot?.mode === "IN_APP" && !!stream && previewReady && snapshot.browser_source_id === clientId.current;
  const target = snapshot?.target_window_id || 0;
  const windowsPending = windowsLoading || pending === "windows";
  const captureOptions = [
    { value: 0, label: "Chọn cửa sổ..." },
    ...(target && !windows.some(item => item.id === target) ? [{ value: target, label: snapshot?.target_window_title || "Cửa sổ không khả dụng", disabled: true }] : []),
    ...windows.map(item => ({ value: item.id, label: item.title })),
  ];
  const dataLoading = !snapshot && !connectionNoticeVisible;
  const audioError = useCallback((message: string) => notify({ kind: "error", text: message }), [notify]);
  const audio = useAuditorAudio({ enabled: microphone && ready && hasSource, recording, date: snapshot?.current_date || "", sessionId: snapshot?.session_id || "", generation: snapshot?.capture_generation || 0, sourceId: clientId.current, captureFrame, onEvent: upsertEvent, onError: audioError });
  const visibleEvents = useMemo(() => events.filter(event => {
    if (filter === "evaluations" && !event.ai_thesis && !event.ai_error && !event.ai_pending) return false;
    if (filter === "questions" && !event.ai_question) return false;
    return !query || [auditEventLabel(event), event.action, event.type, event.voice_transcript, event.ai_transcript, event.ai_thesis, event.ai_question, event.reason, ...(event.warnings || []).map(item => item.message)].join(" ").toLowerCase().includes(query.toLowerCase());
  }).reverse(), [events, filter, query]);
  const totalSessions = sessionGroups.reduce((count, group) => count + group.sessions.length, 0);

  return <main className={styles.workspace} lang="vi" aria-label="Không gian phân tích Quant">
    <div className={styles.container}>
      <header className={styles.sessionBar}>
        <div className={styles.sessionInfo}>
          <div className={styles.sessionIdentity}>
            <h1>Phiên hiện tại</h1>
            <strong className={styles.mono}><LoadingText width="22ch" loading={dataLoading} label="Đang tải phiên hiện tại">{active ? `${snapshot!.current_date} / ${snapshot!.session_id.replace("session_", "")}` : ready ? "Chưa có phiên hoạt động" : "Đang chờ bộ máy phân tích"}</LoadingText></strong>
          </div>
          <div className={styles.sessionButtons}>
            <button type="button" className={styles.button} ref={drawerTrigger} onClick={openSessions}><Icon name="history" />Các phiên</button>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={newSession}><Icon name="plus" />{pending === "session" ? <LoadingIndicator label="Đang tạo phiên" /> : "Tạo phiên"}</button>
          </div>
        </div>
        <div className={styles.terminalControls}>
          <TerminalSelect loading={dataLoading} value={host} disabled={disabled || !isActive} onChange={value => void perform("host", async () => { const result = await auditorRequest<{ terminal_type: TerminalHost }>("/terminal/config", { terminal_type: value }); setHost(result.terminal_type); })} />
          <button type="button" className={`${styles.button} ${styles.terminalButton}`} disabled={disabled || terminalPending || !active || host === "NONE"} aria-busy={terminalPending} onClick={() => void openTerminal()}>{terminalPending ? <LoadingIndicator label="Đang mở Terminal" /> : "Mở Terminal"}</button>
        </div>
      </header>
      {!ready && connectionNoticeVisible && <div className={styles.connectionNotice} role="status">{connection !== "disconnected" ? <LoadingIndicator compact label="Đang kết nối bộ máy phân tích" /> : <Icon name="warning" />}<div><strong>{connection === "connected" ? "Đang chờ cập nhật bộ máy phân tích" : connection === "connecting" ? "Đang kết nối bộ máy phân tích" : "Bộ máy phân tích chưa khả dụng"}</strong><p>Bộ máy phân tích tự khởi động khi mở Quant. Hệ thống sẽ tự kết nối lại. Nếu vẫn chưa kết nối được, hãy kiểm tra Terminal đang chạy ứng dụng. {snapshot && "Dữ liệu phiên đang hiển thị có thể chưa được cập nhật."}</p></div><button className={styles.button} type="button" onClick={() => { activateAuditor(true); setReconnectKey(value => value + 1); }}><Icon name="refresh" />Kết nối lại</button></div>}
      {ready && !active && <div className={styles.connectionNotice}><Icon name="history" /><div><strong>Bắt đầu một phiên</strong><p>Tạo phiên mới hoặc chọn từ lịch sử. Tải lại trang vẫn giữ phiên đã chọn.</p></div><button className={styles.button} type="button" onClick={openSessions}>Xem lịch sử</button></div>}
      <AuditorMetrics snapshot={snapshot} loading={dataLoading} />
      <div className={styles.layout}>
        <aside className={styles.controls}>
          <section className={`${styles.panel} ${styles.capturePanel}`}>
            <div className={styles.sectionHeading}><h2>Nguồn ghi hình</h2>{pending === "mode" ? <LoadingIndicator compact label="Đang cập nhật nguồn" /> : <Icon name="capture" />}</div>
            <AuditorToggleGroup loading={dataLoading} label="Nguồn ghi hình" variant="capture" value={snapshot?.mode} options={captureModes} disabled={disabled || capturePending} onChange={mode => setMode(mode)} />
            <div className={styles.captureSources}>
            <div className={`${styles.field} ${styles.capturePane}`} data-active={snapshot?.mode === "DESKTOP"} aria-hidden={snapshot?.mode !== "DESKTOP"}>
              <label htmlFor="auditor-window">Cửa sổ ghi hình</label>
              <div className={styles.inputAction}>
                <AuditorSelect loading={dataLoading || (windowsPending && !windows.length)} id="auditor-window" label="Cửa sổ ghi hình" icon="capture" value={target} options={captureOptions} disabled={disabled || capturePending || !isActive || snapshot?.mode !== "DESKTOP"} onChange={value => setMode("DESKTOP", value)} />
                <button type="button" tabIndex={-1} className={styles.iconButton} disabled={disabled || windowsPending || snapshot?.mode !== "DESKTOP"} aria-busy={windowsPending} aria-label="Làm mới danh sách cửa sổ" onClick={() => void perform("windows", async () => { const result = await auditorRequest<{ windows: CaptureWindow[] }>("/windows"); setWindows(result.windows); setCaptureError(""); })}>{windowsPending ? <LoadingIndicator compact label="Đang tải cửa sổ" /> : <Icon name="refresh" />}</button>
              </div>
              <p className={styles.help}>Ghi hình cửa sổ đã chọn. Thao tác được ghi khi bạn tương tác với cửa sổ đó.</p>
              <div className={styles.capturePreview}><div className={styles.capturePlaceholder}><Icon name="capture" /><span>{target ? snapshot?.target_window_title : "Chọn cửa sổ Desktop để ghi hình"}</span></div></div>
            </div>
            <div className={`${styles.field} ${styles.capturePane}`} data-active={snapshot?.mode === "IN_APP"} aria-hidden={snapshot?.mode !== "IN_APP"}>
              <label>Nguồn browser tab</label>
              <button type="button" className={styles.button} disabled={snapshot?.mode !== "IN_APP" || (!stream && disabled) || !isActive || capturePending} onClick={() => stream ? stopCapture() : void startCapture()}><Icon name="capture" />{capturePending ? <LoadingIndicator label="Đang cập nhật nguồn" /> : stream ? "Dừng chia sẻ" : "Chọn browser tab"}</button>
              <p className={styles.help}>Ghi toàn bộ nội dung browser tab đã chọn, không gồm address bar hoặc taskbar.</p>
              {stream ? <AuditorCapturePreview video={video} ready={previewReady} onReady={() => setPreviewReady(true)} onError={() => { stopCapture(); setCaptureError("Không tải được browser tab. Hãy chọn lại nguồn ghi hình."); }} /> : <>
                <div className={styles.capturePreview}><div className={styles.capturePlaceholder}><Icon name="capture" /><span>Xem trước tab đã chọn</span></div></div>
              </>}
            </div>
            </div>
            <div className={styles.recordingPanel}>
              <div className={styles.sectionHeading}><strong>Ghi hình</strong><span className={`${styles.recordingStatus} ${recording ? styles.positive : styles.muted}`}><LoadingText width="11ch" loading={dataLoading}>{recording ? "Ghi hình" : snapshot?.recording_status === "paused" ? "Tạm dừng" : "Đã dừng"}</LoadingText></span></div>
              <div className={styles.recordingActions}>
                <button type="button" tabIndex={-1} className={`${styles.button} ${recording ? styles.pauseButton : styles.primary} ${styles.fullWidth}`} disabled={disabled || (!recording && (!active || !hasSource))} onClick={() => changeRecording(recording ? "pause" : snapshot?.recording_status === "paused" ? "resume" : "start")}><Icon name={recording ? "pause" : "play"} />{pending === "recording" ? <LoadingIndicator label="Đang cập nhật" /> : recording ? "Tạm dừng ghi" : snapshot?.recording_status === "paused" ? "Tiếp tục ghi" : "Bắt đầu ghi"}</button>
                <button type="button" tabIndex={-1} className={`${styles.button} ${styles.sellButton} ${styles.fullWidth}`} disabled={disabled || !active || !["recording", "paused"].includes(snapshot?.recording_status || "")} onClick={() => changeRecording("stop")}><Icon name="stop" />{pending === "recording-stop" ? <LoadingIndicator label="Đang dừng" /> : "Dừng ghi"}</button>
              </div>
              <label className={styles.autoStart}>{dataLoading ? <Skeleton width={16} height={16} label="Đang tải tùy chọn ghi hình" /> : <input type="checkbox" checked={snapshot?.auto_start_recording ?? true} disabled={disabled} onChange={event => { const autoStart = event.target.checked; void perform("auto-start", async () => { const result = await auditorRequest<RecordingState>("/recording/preference", { auto_start: autoStart }); setSnapshot(previous => previous ? { ...previous, ...result } : previous); }); }} />}<span>Tự bắt đầu ghi khi chọn nguồn</span>{pending === "auto-start" && <LoadingIndicator compact label="Đang cập nhật tùy chọn ghi hình" />}</label>
              <p className={`${styles.help} ${styles.captureHint}`}>{dataLoading ? <LoadingText width="80%" /> : !active ? "Tạo hoặc mở lại một phiên trước khi bắt đầu." : !hasSource ? "Chọn nguồn để bật ghi hình." : recording ? "Đang ghi thao tác và ảnh chụp từ nguồn đã chọn." : "Chưa ghi hình. Phiên và nguồn đã chọn vẫn được giữ lại."}</p>
            </div>
          </section>
          {captureError && <AuditorNotice message={captureError} />}
          {snapshot?.recording_error && <AuditorNotice message={snapshot.recording_error} />}
          <AuditorAudio key={`${snapshot?.current_date}/${snapshot?.session_id}`} audio={audio} enabled={microphone} loading={dataLoading} disabled={!ready} canRecord={ready && recording && hasSource} hasSource={hasSource} canHear={!!ai?.connected && !!ai?.audio_input} onToggle={setMicrophone} />
          <AuditorStrategy
            enabled={!!snapshot?.strategy_mode}
            available={!!snapshot?.strategy_available}
            documents={snapshot?.strategy_documents || []}
            error={snapshot?.strategy_error}
            disabled={disabled}
            loading={dataLoading}
            toggling={pending === "strategy"}
            onToggle={enabled => void perform("strategy", async () => {
              const result = await auditorRequest<{ strategy_mode: boolean }>("/strategy-mode", { enabled });
              setSnapshot(previous => previous ? { ...previous, strategy_mode: result.strategy_mode } : previous);
            })}
          />
          <AuditorConnection status={ai} loading={dataLoading} pending={pending} disabled={disabled} observing={events.some(event => event.ai_pending)}
            onSave={(settings: AiSettings) => void perform("ai-config", async () => { setAi(await auditorRequest<AiStatus>("/ai/config", settings)); })}
            onCheck={() => void perform("ai", async () => { setAi(await auditorRequest<AiStatus>("/ai/connection/test", {})); })}
            onOpenTerminal={provider => void perform("ai-account", async () => {
              await auditorRequest("/terminal/open", { terminal_type: host, purpose: "account", provider });
              setAi(previous => previous ? { ...previous, connected: null, error: undefined } : previous);
              notify({ kind: "success", text: "Đã mở Terminal của CLI đã chọn. Sau khi đổi tài khoản, làm mới model và kiểm tra kết nối lại." });
            })}
          />
          <button type="button" className={`${styles.button} ${styles.fullWidth}`} disabled={disabled || !active} onClick={() => void perform("export", async () => {
            const result = await auditorRequest<{ date: string; session_id: string; reports: { pdf: string } }>("/end-session", {});
            setReports({ date: result.date, id: result.session_id, pdf: !!result.reports.pdf });
            notify({ kind: "success", text: "Đã xuất báo cáo phiên. Bạn vẫn có thể tiếp tục ghi hình." });
          })}><Icon name="export" />{pending === "export" ? <LoadingIndicator label="Đang xuất" /> : "Xuất báo cáo phiên"}</button>
          {pending === "export" ? <LoadingBlock label="Đang tạo báo cáo phiên" rows={2} /> : reports && <div className={styles.reportLinks}><a href={reportUrl(reports.date, reports.id, "html")} target="_blank" rel="noreferrer">Mở báo cáo HTML</a>{reports.pdf && <a href={reportUrl(reports.date, reports.id, "pdf")} target="_blank" rel="noreferrer">Mở báo cáo PDF</a>}</div>}
        </aside>
        <AuditorFeed snapshot={snapshot} events={visibleEvents} total={events.length} loading={dataLoading} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} onUpdate={upsertEvent} canAnalyze={ready && !!ai?.connected} canAnalyzeAudio={!!ai?.audio_input} canReview={ready} />
      </div>
    </div>
    <dialog id="auditor-history-dialog" ref={drawer} className={`${styles.workspace} ${styles.drawer}`} aria-labelledby="auditor-history-title" onCancel={() => setDrawerOpen(false)} onClose={() => { setDrawerOpen(false); drawerTrigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) setDrawerOpen(false); }}>
      <div className={styles.drawerHeading}><div><h2 id="auditor-history-title">Lịch sử phiên</h2><p className={styles.help}>Mở lại phiên đã lưu mà không cần tạo phiên mới.</p></div><button type="button" className={styles.iconButton} aria-label="Đóng lịch sử phiên" onClick={() => setDrawerOpen(false)}><Icon name="close" /></button></div>
      <div className={styles.drawerActions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={newSession}><Icon name="plus" />{pending === "session" ? <LoadingIndicator label="Đang tạo phiên" /> : "Tạo phiên"}</button>
        <button type="button" className={`${styles.button} ${styles.deleteButton}`} disabled={disabled || sessionLoading || totalSessions === 0} onClick={() => requestDelete("all")}>Xóa tất cả phiên</button>
        <button type="button" className={styles.iconButton} aria-label="Làm mới danh sách phiên" disabled={sessionLoading} onClick={() => void refreshSessions()}>{sessionLoading ? <LoadingIndicator compact label="Đang tải phiên" /> : <Icon name="refresh" />}</button>
      </div>
      {sessionError && <AuditorNotice message={sessionError} />}
      {sessionLoading && !sessionGroups.length && <SessionsLoading />}
      {!sessionLoading && !sessionError && !sessionGroups.length && <div className={styles.empty}><Icon name="history" /><h3>Chưa có phiên đã lưu</h3><p>Tạo phiên để ghi thao tác và minh chứng giao dịch.</p></div>}
      {sessionGroups.map(group => <section className={styles.sessionGroup} key={group.date}><h3 className={styles.mono}>{group.date}</h3>{group.sessions.map(session => {
        const selected = session.date === snapshot?.current_date && session.id === snapshot?.session_id;
        return <div className={`${styles.sessionItem} ${selected ? styles.selected : ""}`} key={session.id}><div className={styles.sessionTitle}><strong>{session.label}</strong>{selected && <span className={styles.positive}><Icon name="check" />Hiện tại</span>}</div><p className={styles.help}><LoadingNumber loading={false} digits={3}>{session.events_count}</LoadingNumber> sự kiện đã ghi</p><div className={styles.sessionActions}>{!selected && <button type="button" className={styles.button} disabled={disabled} onClick={() => void perform("switch", async () => { const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>("/sessions/switch", { date: session.date, session_id: session.id }); applySnapshot(result); setSessionGroups(result.dates); setDeleteTarget(null); })}>{pending === "switch" ? <LoadingIndicator label="Đang mở phiên" /> : "Mở lại"}</button>}{session.has_html && <a href={reportUrl(session.date, session.id, "html")} target="_blank" rel="noreferrer">HTML</a>}{session.has_pdf && <a href={reportUrl(session.date, session.id, "pdf")} target="_blank" rel="noreferrer">PDF</a>}<button type="button" className={`${styles.button} ${styles.deleteButton}`} disabled={disabled} onClick={() => requestDelete({ date: session.date, id: session.id })}>Xóa</button></div></div>;
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



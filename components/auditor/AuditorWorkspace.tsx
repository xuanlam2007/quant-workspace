"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { auditorRequest, engineUrl, reportUrl, type AiStatus, type AuditEvent, type CaptureMode, type CaptureWindow, type DecisionPreview, type RecordingState, type SessionGroup, type Snapshot, type TerminalHost } from "../../lib/auditor-client";
import AuditorFeed from "./AuditorFeed";
import { Icon, TerminalSelect, points } from "./AuditorUi";
import styles from "../../app/auditor/auditor.module.css";

type Feedback = { kind: "success" | "error"; text: string } | null;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function AuditorWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [reconnectKey, setReconnectKey] = useState(0);
  const [pending, setPending] = useState("");
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [terminalFeedback, setTerminalFeedback] = useState<Feedback>(null);
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
          } else if (message.type === "ERROR") setFeedback({ kind: "error", text: message.message });
        } catch { setFeedback({ kind: "error", text: "The engine sent an unreadable update. Reconnect to reload session data." }); }
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
  }, [applySnapshot, upsertEvent, reconnectKey]);

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
    setFeedback(null);
    try { await action(); }
    catch (error) { setFeedback({ kind: "error", text: errorText(error) }); }
    finally { busy.current = false; setPending(""); }
  };
  const refreshSessions = async () => {
    setSessionLoading(true);
    setSessionError("");
    try { const result = await auditorRequest<{ dates: SessionGroup[] }>("/sessions"); setSessionGroups(result.dates); }
    catch (error) { setSessionError(errorText(error)); }
    finally { setSessionLoading(false); }
  };
  useEffect(() => {
    if (drawerOpen && !drawer.current?.open) drawer.current?.showModal();
    if (!drawerOpen && drawer.current?.open) drawer.current?.close();
  }, [drawerOpen]);
  const openSessions = () => { setDrawerOpen(true); setDeleteTarget(null); void refreshSessions(); };
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
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing requires a supported browser on localhost or HTTPS.");
      const next = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (next.getVideoTracks()[0]?.getSettings().displaySurface === "monitor") {
        next.getTracks().forEach(track => track.stop());
        throw new Error("Select a browser tab or application window instead of an entire screen.");
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
      setValidation("Enter a positive price and a whole contract count between 1 and 1000.");
      return;
    }
    if (save && snapshot?.mode === "IN_APP" && !streamRef.current) { setCaptureError("Choose a browser tab or window before saving a decision."); return; }
    setValidation("");
    void perform(save ? "save-test" : direction, async () => {
      const context = { session_id: snapshotRef.current?.session_id, session_date: snapshotRef.current?.current_date, source_id: clientId.current };
      const result = await auditorRequest<DecisionPreview>("/decision-test", { ...context, direction, price: Number(price), contracts: Number(contracts), voice_transcript: rationale, save, frame_base64: save && snapshot?.mode === "IN_APP" ? captureFrame() : undefined });
      setDecisionPreview(result);
      if (result.event) upsertEvent(result.event);
      if (save) setFeedback({ kind: "success", text: `${direction} saved with its evidence. Session positions and P&L are unchanged.` });
    });
  };
  const setMode = (mode: CaptureMode, windowId = 0) => void perform("mode", async () => {
    if (streamRef.current) stopCapture();
    const result = await auditorRequest<RecordingState>("/mode", { mode, target_window_id: windowId });
    setSnapshot(previous => previous ? { ...previous, ...result } : previous);
    setTarget(result.target_window_id);
  });
  const changeRecording = (action: "start" | "pause" | "resume") => void perform("recording", async () => {
    const result = await auditorRequest<RecordingState>("/recording", { action, source_id: clientId.current });
    setSnapshot(previous => previous ? { ...previous, ...result } : previous);
  });
  const newSession = () => void perform("session", async () => {
    const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>("/sessions/new", {});
    applySnapshot(result);
    setSessionGroups(result.dates);
    setFeedback({ kind: "success", text: "New session created. Your previous sessions are preserved." });
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
    return !query || [event.action, event.type, event.voice_transcript, event.ai_thesis, event.reason, ...(event.warnings || []).map(item => item.message)].join(" ").toLowerCase().includes(query.toLowerCase());
  }).reverse(), [events, filter, query]);
  const guardrails = snapshot?.config?.strategy_guardrails;
  const aiLabel = ai?.connected === true ? "AGY connected" : ai?.connected === false ? "AGY unavailable" : ai?.available ? "AGY installed" : "AGY not found";

  return <main className={styles.workspace}>
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <Link className={styles.back} href="/" aria-label="Return to chart"><Icon name="back" /></Link>
          <div className={styles.brand}><Icon name="activity" /></div>
          <div><h1>Quant Strategy Auditor</h1><p>Trading decisions, reviewed with context.</p></div>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.status} ${connection === "connected" ? styles.positive : styles.warning}`}><span className={styles.dot} />{connection === "connected" ? "Engine connected" : connection === "connecting" ? "Connecting" : "Engine offline"}</span>
          <button type="button" className={styles.button} ref={drawerTrigger} onClick={openSessions}><Icon name="history" />Sessions</button>
          <button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={newSession}><Icon name="plus" />{pending === "session" ? "Creating..." : "New session"}</button>
        </div>
      </header>
      <div className={styles.sessionBar}>
        <div><span className={styles.eyebrow}>Current session</span><strong className={styles.mono}>{active ? `${snapshot!.current_date} / ${snapshot!.session_id.replace("session_", "")}` : ready ? "No active session" : "Waiting for engine"}</strong></div>
        <div className={styles.terminalControls}>
          <TerminalSelect value={host} disabled={disabled} onChange={value => void perform("host", async () => { const result = await auditorRequest<{ terminal_type: TerminalHost }>("/terminal/config", { terminal_type: value }); setHost(result.terminal_type); setTerminalFeedback(null); })} />
          <button type="button" className={styles.button} disabled={disabled || !active || host === "NONE"} onClick={() => void perform("terminal", async () => {
            setTerminalFeedback(null);
            try {
              const result = await auditorRequest<{ status: string }>("/terminal/open", { terminal_type: host });
              setTerminalFeedback({ kind: "success", text: result.status === "disabled" ? "Terminal opening is disabled." : result.status === "opened" ? "Orca terminal created with the session monitor command." : "Terminal process launched. Check the selected host for its session monitor." });
            } catch (error) { setTerminalFeedback({ kind: "error", text: errorText(error) }); }
          })}>{pending === "terminal" ? "Opening..." : "Open terminal"}</button>
        </div>
      </div>
      {terminalFeedback && <p role="status" className={`${styles.notice} ${terminalFeedback.kind === "error" ? styles.error : styles.positive}`}>{terminalFeedback.text}</p>}
      {!ready && <div className={styles.connectionNotice} role="status"><Icon name="warning" /><div><strong>{connection === "connected" ? "Waiting for the engine update" : connection === "connecting" ? "Connecting to the audit engine" : "The Python engine is unavailable"}</strong><p>Opening Auditor starts the engine automatically and watches Python changes. If it remains unavailable, check the development terminal for errors. An older manually started engine must be stopped once before automatic startup can take over. The workspace reconnects automatically. {snapshot && "Displayed session data may be out of date."}</p></div><button className={styles.button} type="button" onClick={() => setReconnectKey(value => value + 1)}><Icon name="refresh" />Reconnect</button></div>}
      {ready && !active && <div className={styles.connectionNotice}><Icon name="history" /><div><strong>Start with a session</strong><p>Create a new session, or select one from history. Refreshing this page will reuse it.</p></div><button className={styles.button} type="button" onClick={openSessions}>View history</button></div>}
      {feedback && <p className={`${styles.notice} ${feedback.kind === "error" ? styles.error : styles.positive}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}<button type="button" className={styles.iconButton} aria-label="Dismiss message" onClick={() => setFeedback(null)}><Icon name="close" /></button></p>}
      <section className={styles.metrics} aria-label="Session results">
        <div><span>Closed pairs</span><strong>{summary?.total_closed_pairs ?? "..."}</strong><small>{summary ? `${summary.open_longs_count} long / ${summary.open_shorts_count} short open` : "Waiting for session data"}</small></div>
        <div><span>Gross result</span><strong className={styles.mono}>{points(summary?.total_gross_points, true)} <small>pts</small></strong><small>Before transaction fees</small></div>
        <div><span>Fees</span><strong className={styles.mono}>{points(summary ? -summary.total_fees_points : undefined)} <small>pts</small></strong><small>Applied to closed pairs</small></div>
        <div><span>Net result</span><strong className={`${styles.mono} ${(summary?.total_net_points || 0) < 0 ? styles.negative : styles.positive}`}>{points(summary?.total_net_points, true)} <small>pts</small></strong><small>After transaction fees</small></div>
      </section>
      <div className={styles.layout}>
        <aside className={styles.controls}>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}><h2>Capture source</h2><Icon name="capture" /></div>
            <div className={styles.segmented} aria-label="Capture source">{(["DESKTOP", "IN_APP"] as const).map(mode => <button type="button" key={mode} aria-pressed={snapshot?.mode === mode} disabled={disabled} onClick={() => { if (snapshot?.mode !== mode) setMode(mode); }}>{mode === "DESKTOP" ? "Desktop" : "Browser tab"}</button>)}</div>
            {snapshot?.mode !== "IN_APP" ? <div className={styles.field}>
              <label htmlFor="auditor-window">Capture window</label>
              <div className={styles.inputAction}><select id="auditor-window" value={target} disabled={disabled} onChange={event => setMode("DESKTOP", Number(event.target.value))}><option value={0}>Choose a window...</option>{target > 0 && !windows.some(window => window.id === target) && <option value={target}>{snapshot?.target_window_title || "Selected window unavailable"}</option>}{windows.map(window => <option key={window.id} value={window.id}>{window.title}</option>)}</select><button type="button" className={styles.iconButton} disabled={disabled} aria-label="Refresh application windows" onClick={() => void perform("windows", async () => { const result = await auditorRequest<{ windows: CaptureWindow[] }>("/windows"); setWindows(result.windows); setCaptureError(""); })}><Icon name="refresh" /></button></div>
              <p className={styles.help}>Only the selected window is captured. Automatic events are recorded while you interact with that window.</p>
            </div> : <div className={styles.capture}>
              <video ref={video} autoPlay muted playsInline className={stream ? styles.preview : styles.hidden} aria-label="Shared screen preview" />
              {!stream && <p className={styles.help}>Choose a chart tab or application window. An entire screen cannot be used as a capture source.</p>}
              <button type="button" className={styles.button} disabled={(!stream && disabled) || capturePending} onClick={() => stream ? stopCapture() : void startCapture()}><Icon name="capture" />{capturePending ? "Choosing..." : stream ? "Stop sharing" : "Choose tab or window"}</button>
            </div>}
            {captureError && <p className={styles.error} role="alert">{captureError}</p>}
            <div className={styles.recordingPanel}>
              <div className={styles.sectionHeading}><strong>Recording</strong><span className={recording ? styles.positive : styles.muted}>{recording ? "Recording" : snapshot?.recording_status === "paused" ? "Paused" : "Stopped"}</span></div>
              <button type="button" className={`${styles.button} ${recording ? styles.pauseButton : styles.primary} ${styles.fullWidth}`} disabled={disabled || (!recording && (!active || !hasSource))} onClick={() => changeRecording(recording ? "pause" : snapshot?.recording_status === "paused" ? "resume" : "start")}><Icon name={recording ? "pause" : "play"} />{pending === "recording" ? "Updating..." : recording ? "Pause recording" : snapshot?.recording_status === "paused" ? "Resume recording" : "Start recording"}</button>
              <label className={styles.autoStart}><input type="checkbox" checked={snapshot?.auto_start_recording ?? true} disabled={disabled} onChange={event => { const autoStart = event.target.checked; void perform("auto-start", async () => { const result = await auditorRequest<RecordingState>("/recording/preference", { auto_start: autoStart }); setSnapshot(previous => previous ? { ...previous, ...result } : previous); }); }} /><span>Auto-start after selecting a source</span></label>
              {!active ? <p className={styles.help}>Create or resume a session before starting.</p> : !hasSource ? <p className={styles.help}>Choose a source to enable recording.</p> : !recording && <p className={styles.help}>Screenshots and event logging are inactive.</p>}
              {snapshot?.recording_error && <p className={styles.error} role="alert">{snapshot.recording_error}</p>}
            </div>
            <div className={styles.guardrail}>
              <label className={styles.toggle}><input type="checkbox" checked={snapshot?.strategy_mode ?? true} disabled={disabled} onChange={event => { const enabled = event.target.checked; void perform("strategy", async () => { await auditorRequest("/strategy-mode", { enabled }); setSnapshot(previous => previous ? { ...previous, strategy_mode: enabled } : previous); }); }} /><span><strong>Strategy guardrails</strong><small>Flag timing and session conflicts</small></span></label>
              <p className={styles.help}>{(guardrails?.session_start_time || "09:15:00").slice(0, 5)} to {(guardrails?.session_cutoff_time || "10:00:00").slice(0, 5)} · M1 window T-{guardrails?.optimal_window_seconds_before ?? 5}s to T+{guardrails?.optimal_window_seconds_after ?? 3}s</p>
            </div>
          </section>
          <section className={styles.panel}>
            <h2>Decision</h2><p className={styles.help}>Check a proposed LONG or SHORT against your guardrails. Preview a decision before saving it.</p>
            <div className={styles.formRow}>
              <div className={styles.field}><label htmlFor="auditor-price">Planned entry</label><input id="auditor-price" inputMode="decimal" type="number" min="0" step="any" value={price} aria-invalid={!!validation} disabled={disabled} placeholder="e.g. 1250.5" onChange={event => { setPrice(event.target.value); setValidation(""); setDecisionPreview(null); }} /></div>
              <div className={styles.field}><label htmlFor="auditor-contracts">Contracts</label><input id="auditor-contracts" type="number" min="1" max="1000" step="1" value={contracts} aria-invalid={!!validation} disabled={disabled} onChange={event => { setContracts(event.target.value); setValidation(""); setDecisionPreview(null); }} /></div>
            </div>
            {validation && <p className={styles.error} role="alert">{validation}</p>}
            <div className={styles.field}><label htmlFor="auditor-rationale">Setup thesis</label><textarea id="auditor-rationale" rows={3} value={rationale} disabled={disabled} placeholder="What supports this setup? What would invalidate it?" onChange={event => { setRationale(event.target.value); setDecisionPreview(null); }} /></div>
            <div className={styles.tradeActions}><button type="button" className={`${styles.button} ${styles.buyButton}`} disabled={disabled} onClick={() => testDecision("LONG")}>{pending === "LONG" ? "Checking..." : "LONG"}</button><button type="button" className={`${styles.button} ${styles.sellButton}`} disabled={disabled} onClick={() => testDecision("SHORT")}>{pending === "SHORT" ? "Checking..." : "SHORT"}</button></div>
            {decisionPreview && <div className={styles.testPreview} aria-live="polite"><strong className={decisionPreview.direction === "LONG" ? styles.positive : styles.negative}>{decisionPreview.direction} at {decisionPreview.price.toLocaleString("en-US")}</strong><p className={styles.help}>{decisionPreview.contracts} contracts · {decisionPreview.saved ? "Saved decision" : "Preview only"}</p>{decisionPreview.warnings.length ? decisionPreview.warnings.map((warning, index) => <p key={`${warning.type}-${index}`} className={styles.warning}>{warning.message}</p>) : <p className={styles.help}>{snapshot?.strategy_mode ? "No warnings from the current guardrail checks." : "Strategy guardrails are disabled."}</p>}<button type="button" className={`${styles.button} ${styles.fullWidth}`} disabled={disabled || !active || !recording || !hasSource || decisionPreview.saved} onClick={() => testDecision(decisionPreview.direction, true)}>{pending === "save-test" ? "Saving..." : decisionPreview.saved ? "Decision saved" : "Save decision with evidence"}</button><p className={styles.help}>{!recording ? "Start recording to save this decision." : "Saved decisions do not change positions or realized P&L."}</p></div>}
          </section>
          <section className={styles.panel}>
            <div className={styles.sectionHeading}><h2>Analysis</h2><span className={`${styles.smallStatus} ${ai?.connected === false ? styles.warning : styles.muted}`}>{aiLabel}</span></div>
            <p className={styles.help}>AGY uses your existing sign-in. Analysis follows recorded decisions; screenshots remain available as evidence.</p>
            <button type="button" className={styles.button} disabled={disabled} onClick={() => void perform("ai", async () => { const result = await auditorRequest<AiStatus>("/gemini/status"); setAi(result); })}><Icon name="refresh" />{pending === "ai" ? "Checking..." : "Check connection"}</button>
            {ai?.error && <p className={styles.error} role="alert">{ai.error}</p>}
            {ai?.latency_ms !== undefined && <p className={styles.help}>Last check: {ai.latency_ms} ms</p>}
          </section>
          <button type="button" className={`${styles.button} ${styles.fullWidth}`} disabled={disabled || !active} onClick={() => void perform("export", async () => {
            const result = await auditorRequest<{ date: string; session_id: string; reports: { pdf: string } }>("/end-session", {});
            setReports({ date: result.date, id: result.session_id, pdf: !!result.reports.pdf });
            setFeedback({ kind: "success", text: "Session report exported. Recording remains available." });
          })}><Icon name="export" />{pending === "export" ? "Exporting..." : "Export session report"}</button>
          {reports && <div className={styles.reportLinks}><a href={reportUrl(reports.date, reports.id, "html")} target="_blank" rel="noreferrer">Open HTML report</a>{reports.pdf && <a href={reportUrl(reports.date, reports.id, "pdf")} target="_blank" rel="noreferrer">Open PDF report</a>}</div>}
        </aside>
        <AuditorFeed snapshot={snapshot} events={visibleEvents} total={events.length} ready={ready} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} />
      </div>
      <footer className={styles.footer}><span>Quant Strategy Auditor · Local audit workspace</span><span>{active ? "Refresh keeps your current session" : "Sessions start only when you create one"}</span></footer>
    </div>
    <dialog ref={drawer} className={`${styles.workspace} ${styles.drawer}`} aria-labelledby="auditor-history-title" onCancel={() => setDrawerOpen(false)} onClose={() => { setDrawerOpen(false); drawerTrigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) setDrawerOpen(false); }}>
      <div className={styles.drawerHeading}><div><h2 id="auditor-history-title">Session history</h2><p className={styles.help}>Return to a session without creating another.</p></div><button type="button" className={styles.iconButton} aria-label="Close session history" onClick={() => setDrawerOpen(false)}><Icon name="close" /></button></div>
      <div className={styles.drawerActions}><button type="button" className={`${styles.button} ${styles.primary}`} disabled={disabled} onClick={newSession}><Icon name="plus" />New session</button><button type="button" className={styles.iconButton} aria-label="Refresh sessions" disabled={sessionLoading} onClick={() => void refreshSessions()}><Icon name="refresh" /></button></div>
      {sessionError && <p className={styles.error} role="alert">{sessionError}</p>}
      {feedback && drawerOpen && <p className={`${styles.notice} ${feedback.kind === "error" ? styles.error : styles.positive}`} role="status">{feedback.text}</p>}
      {sessionLoading && <p className={styles.help} role="status">Loading sessions...</p>}
      {!sessionLoading && !sessionGroups.length && <div className={styles.empty}><Icon name="history" /><h3>No saved sessions</h3><p>Start a session when you are ready to record decisions.</p></div>}
      {sessionGroups.map(group => <section className={styles.sessionGroup} key={group.date}><h3 className={styles.mono}>{group.date}</h3>{group.sessions.map(session => {
        const selected = session.date === snapshot?.current_date && session.id === snapshot?.session_id;
        return <div className={`${styles.sessionItem} ${selected ? styles.selected : ""}`} key={session.id}><div className={styles.sessionTitle}><strong>{session.label}</strong>{selected && <span className={styles.positive}><Icon name="check" />Current</span>}</div><p className={styles.help}>{session.events_count} recorded events</p><div className={styles.sessionActions}>{!selected && <button type="button" className={styles.button} disabled={disabled} onClick={() => void perform("switch", async () => { const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>("/sessions/switch", { date: session.date, session_id: session.id }); applySnapshot(result); setSessionGroups(result.dates); setDeleteTarget(null); })}>Resume</button>}{session.has_html && <a href={reportUrl(session.date, session.id, "html")} target="_blank" rel="noreferrer">HTML</a>}{session.has_pdf && <a href={reportUrl(session.date, session.id, "pdf")} target="_blank" rel="noreferrer">PDF</a>}<button type="button" className={`${styles.button} ${styles.deleteButton}`} disabled={disabled} onClick={() => setDeleteTarget({ date: session.date, id: session.id })}>Delete</button></div></div>;
      })}</section>)}
      {deleteTarget && <div className={styles.confirm} role="alert"><strong>{deleteTarget === "all" ? "Delete every saved session?" : "Delete this session and its evidence?"}</strong><p>This cannot be undone.</p><div className={styles.sessionActions}><button type="button" className={`${styles.button} ${styles.sellButton}`} disabled={disabled} onClick={() => void perform("delete", async () => { const path = deleteTarget === "all" ? "/sessions" : `/sessions/${encodeURIComponent(deleteTarget.date)}/${encodeURIComponent(deleteTarget.id)}`; const result = await auditorRequest<Snapshot & { dates: SessionGroup[] }>(path, undefined, "DELETE"); applySnapshot(result); setSessionGroups(result.dates); setDeleteTarget(null); })}>{pending === "delete" ? "Deleting..." : "Delete permanently"}</button><button type="button" className={styles.button} disabled={!!pending} onClick={() => setDeleteTarget(null)}>Cancel</button></div></div>}
      {sessionGroups.length > 0 && !deleteTarget && <button type="button" className={`${styles.button} ${styles.deleteButton} ${styles.fullWidth}`} disabled={disabled} onClick={() => setDeleteTarget("all")}>Delete all sessions</button>}
    </dialog>
  </main>;
}

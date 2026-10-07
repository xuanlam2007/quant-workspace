export const engineUrl = (process.env.NEXT_PUBLIC_AUDITOR_ENGINE_URL || "http://127.0.0.1:8765").replace(/\/$/, "");

export type TerminalHost = "ORCA" | "WINDOWS" | "WT" | "NONE";
export type CaptureMode = "DESKTOP" | "IN_APP";
export type CaptureWindow = { id: number; title: string };
export type RecordingState = {
  capture_generation: number;
  recording_status: "stopped" | "recording" | "paused";
  recording_error: string;
  auto_start_recording: boolean;
  target_window_id: number;
  target_window_title: string;
  browser_source_id: string;
  mode: CaptureMode;
};
export type DecisionPreview = { direction: "LONG" | "SHORT"; price: number; contracts: number; warnings: AuditEvent["warnings"]; saved: boolean; event?: AuditEvent };
export type StrategyState = { strategy_mode: boolean; config: Snapshot["config"] };
export type AuditEvent = {
  id: string;
  type: string;
  action?: string;
  price?: number;
  contracts?: number;
  timestamp: string;
  logged_at?: string;
  date?: string;
  session_id?: string;
  voice_transcript?: string;
  reason?: string;
  ai_thesis?: string;
  ai_pending?: boolean;
  ai_error?: string;
  frame_path?: string;
  drawing_data?: Record<string, unknown>;
  strategy?: { enabled: boolean; notes: string; rules: Record<string, unknown> };
  warnings: { type: string; severity: string; message: string }[];
};
export type TradePair = { open_time: string; close_time: string; p_red: number; p_green: number; gross_points: number; net_points: number };
export type Summary = { total_closed_pairs: number; total_gross_points: number; total_fees_points: number; total_net_points: number; open_longs_count: number; open_shorts_count: number; pairs: TradePair[] };
export type AiStatus = { available?: boolean; connected: boolean | null; error?: string; latency_ms?: number; model?: string };
export type Session = { id: string; date: string; label: string; events_count: number; is_current: boolean; has_html: boolean; has_pdf: boolean };
export type SessionGroup = { date: string; sessions: Session[] };
export type Snapshot = RecordingState & {
  protocol_version: number;
  mode: CaptureMode;
  target_window_title: string;
  strategy_mode: boolean;
  current_date: string;
  date: string;
  session_id: string;
  summary: Summary;
  recent_events: AuditEvent[];
  gemini_status: AiStatus;
  config: { terminal_type?: TerminalHost; strategy_notes?: string; strategy_configured?: boolean; strategy_guardrails?: { fee_per_closed_pair?: number; session_start_time?: string; session_cutoff_time?: string; optimal_window_seconds_before?: number; optimal_window_seconds_after?: number } };
};

export function auditEventLabel(event: Pick<AuditEvent, "type" | "action">) {
  const value = event.action || event.type;
  const labels: Record<string, string> = {
    DECISION_TEST: "Lệnh giả lập",
    MOUSE_CLICK: "Nhấp chuột",
    DRAWING: "Vẽ biểu đồ",
    REJECTED_SETUP: "Từ chối",
    REJECT: "Từ chối",
    TRADE_OPEN: "Mở lệnh",
    TRADE_CLOSE: "Đóng lệnh",
    TRADE_MANUAL: "Lệnh thủ công",
  };
  return labels[value] || value.replaceAll("_", " ");
}

export async function auditorRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST", signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 45000);
  try {
    const response = await fetch(`${engineUrl}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.status === "error") {
      const detail = typeof data.detail === "string" ? data.detail : data.message;
      throw new Error(detail || `Yêu cầu thất bại (${response.status})`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && !signal?.aborted) throw new Error("Yêu cầu đã hết thời gian chờ. Kiểm tra nhật ký trước khi lặp lại thao tác ghi.");
    if (error instanceof TypeError) throw new Error("Không thể kết nối bộ máy phân tích. Hãy thử kết nối lại hoặc kiểm tra Terminal đang chạy ứng dụng.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function reportUrl(date: string, sessionId: string, type: "html" | "pdf") {
  return `${engineUrl}/api/sessions/${encodeURIComponent(date)}/${encodeURIComponent(sessionId)}/report/${type}`;
}

export function evidenceUrl(event: AuditEvent, date: string, sessionId: string) {
  const filename = event.frame_path?.split(/[\\/]/).pop();
  return filename ? `${engineUrl}/api/sessions/${encodeURIComponent(event.date || date)}/${encodeURIComponent(event.session_id || sessionId)}/frames/${encodeURIComponent(filename)}` : "";
}

export const engineUrl = "/api/auditor";

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
export type ObservedFill = {
  id: string; status: "intent" | "submitted" | "filled" | "cancelled" | "unknown" | "confirmed" | "excluded";
  action: "BUY" | "SELL" | null; price: number | null; contracts: number | null; timestamp: string | null;
  instrument: string; execution_id: string; evidence: string; incremental: boolean; reviewed_by?: "AI" | "trader";
};
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
  ai_transcript?: string;
  ai_trade_observations?: ObservedFill[];
  observed_fills?: ObservedFill[];
  ai_question?: string;
  ai_strategy_difference?: boolean;
  ai_evidence_limitations?: string;
  teaching?: { question: string; answer: string; timestamp: string }[];
  analysis_history?: { observation: string; question: string; error?: string; timestamp?: string }[];
  ai_pending?: boolean;
  ai_requested_at?: string;
  ai_started_at?: string;
  ai_status?: "idle" | "queued" | "processing" | "complete" | "failed";
  ai_error?: string;
  frame_path?: string;
  frame_captured_at?: string;
  observation_frames?: { path: string; captured_at: string }[];
  capture_error?: string;
  audio_path?: string;
  drawing_data?: Record<string, unknown>;
  strategy?: { enabled: boolean; documents?: { name: string; content: string; sha256: string }[]; notes?: string; rules?: Record<string, unknown> };
  warnings: { type: string; severity: string; message: string }[];
};
export type TradePair = { open_time: string; close_time: string; p_red: number; p_green: number; gross_points: number; net_points: number };
export type Summary = { total_closed_pairs: number; total_gross_points: number; total_fees_points: number; total_net_points: number; open_longs_count: number; open_shorts_count: number; pairs: TradePair[] };
export type AiSettings = { provider: "AGY" | "CODEX"; model: string; effort: string };

export function auditorAnalysisError(message: string) {
  if (/AI is busy/i.test(message)) return "Minh chứng đã được lưu. Kiểm tra kết nối AI để tự xử lý lại các lượt đang chờ.";
  // Các phiên cũ có thể lưu cả dòng lệnh và đường dẫn trong lỗi timeout.
  if (/timed out after|chưa trả về kết quả sau/i.test(message)) {
    const seconds = message.match(/(?:timed out after|chưa trả về kết quả sau)\s+(\d+(?:\.\d+)?)/i)?.[1];
    return `AI chưa phản hồi${seconds ? ` sau ${seconds} giây` : ""}. Ghi âm và ảnh đã được lưu; kiểm tra Terminal rồi thử phân tích lại.`;
  }
  if (/Command\s+['\[]/i.test(message)) return "CLI không hoàn tất yêu cầu. Minh chứng đã được lưu; kiểm tra Terminal rồi thử lại.";
  return message;
}
export type AiStatus = Partial<AiSettings> & { available?: boolean; connected: boolean | null; error?: string; terminal_error?: string; latency_ms?: number; vision?: boolean; audio_input?: boolean; transcription?: boolean };
export type AiCatalogOption = { id: string; label: string; description?: string };
export type AiCatalog = {
  provider: AiSettings["provider"];
  models: (AiCatalogOption & { efforts?: AiCatalogOption[]; default_effort?: string; is_default?: boolean; preset_group?: AiCatalogOption; preset_effort?: string })[];
  agents: AiCatalogOption[];
  efforts: AiCatalogOption[];
  agents_supported: boolean;
  errors: Partial<Record<"models" | "agents" | "efforts", string>>;
};
export type Session = { id: string; date: string; label: string; events_count: number; is_current: boolean; has_html: boolean; has_pdf: boolean };
export type SessionGroup = { date: string; sessions: Session[] };
export type Snapshot = RecordingState & {
  protocol_version: number;
  mode: CaptureMode;
  target_window_title: string;
  strategy_mode: boolean;
  strategy_available?: boolean;
  strategy_documents?: string[];
  strategy_error?: string;
  current_date: string;
  date: string;
  session_id: string;
  summary: Summary;
  recent_events: AuditEvent[];
  gemini_status: AiStatus;
  config: { terminal_type?: TerminalHost; strategy_guardrails?: { fee_per_closed_pair?: number } };
};

export function auditEventLabel(event: Pick<AuditEvent, "type" | "action">) {
  const value = event.action || event.type;
  const labels: Record<string, string> = {
    DECISION_TEST: "Lệnh giả lập",
    OBSERVATION: "Quan sát",
    AUDIO_NOTE: "Ghi âm",
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
    const response = await fetch(`${engineUrl}${path}`, {
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
  return `${engineUrl}/sessions/${encodeURIComponent(date)}/${encodeURIComponent(sessionId)}/report/${type}`;
}

export function evidenceUrl(event: AuditEvent, date: string, sessionId: string) {
  const filename = event.frame_path?.split(/[\\/]/).pop();
  return filename ? `${engineUrl}/sessions/${encodeURIComponent(event.date || date)}/${encodeURIComponent(event.session_id || sessionId)}/frames/${encodeURIComponent(filename)}` : "";
}

export function audioUrl(event: AuditEvent) {
  const filename = event.audio_path?.split(/[\\/]/).pop();
  return filename && event.date && event.session_id ? `${engineUrl}/sessions/${encodeURIComponent(event.date)}/${encodeURIComponent(event.session_id)}/audio/${encodeURIComponent(filename)}` : "";
}

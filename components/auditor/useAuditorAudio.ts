import { useCallback, useEffect, useRef, useState } from "react";
import { auditorRequest, type AuditEvent } from "../../lib/auditor-client";

const microphoneError = (error: unknown) => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Microphone bị chặn. Hãy cho phép microphone trong cài đặt trang, rồi thử lại.";
    if (error.name === "NotFoundError") return "Không tìm thấy microphone. Hãy kết nối thiết bị, rồi thử lại.";
    if (error.name === "NotReadableError") return "Không mở được microphone. Kiểm tra thiết bị và ứng dụng đang sử dụng nó.";
    if (error.name === "OverconstrainedError") return "Microphone đã chọn không còn khả dụng. Hãy chọn thiết bị khác.";
  }
  return error instanceof Error ? error.message : String(error);
};

export function useAuditorAudio({ enabled, recording, date, sessionId, generation, sourceId, captureFrame, onEvent, onError }: {
  enabled: boolean; recording: boolean; date: string; sessionId: string; generation: number; sourceId: string;
  captureFrame: () => string | undefined;
  onEvent: (event: AuditEvent) => void; onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<"off" | "starting" | "recording" | "error">("off");
  const [error, setError] = useState("");
  const [savedClips, setSavedClips] = useState(0);
  const [saving, setSaving] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [unsavedClips, setUnsavedClips] = useState<{ url: string; filename: string }[]>([]);
  const recoveryUrls = useRef(new Set<string>());
  const flush = useRef<(() => void) | null>(null);
  const currentRun = useRef(0);
  const mounted = useRef(true);
  const currentSession = useRef({ date, sessionId });
  const retry = useCallback(() => setRetryKey(value => value + 1), []);
  const saveClip = useCallback(() => flush.current?.(), []);
  const dismissClip = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    recoveryUrls.current.delete(url);
    setUnsavedClips(previous => previous.filter(clip => clip.url !== url));
  }, []);

  useEffect(() => { currentSession.current = { date, sessionId }; setSavedClips(0); }, [date, sessionId]);

  useEffect(() => {
    mounted.current = true;
    const urls = recoveryUrls.current;
    return () => { mounted.current = false; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  }, []);

  useEffect(() => {
    const run = ++currentRun.current;
    flush.current = null;
    setSaving(false);
    setMediaStream(null);
    if (!enabled || !recording || !sessionId) { setStatus("off"); return; }
    let stopped = false;
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;
    let token = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frameTimer: ReturnType<typeof setInterval> | undefined;
    let frameBusy = false;
    let frameError = "";
    let uploads = Promise.resolve();
    let queued = 0;
    let awaitingStop = false;
    let failed = false;
    const isCurrent = () => mounted.current && currentRun.current === run;
    const close = () => {
      if (token) void auditorRequest(`/audio/${token}`, undefined, "DELETE").catch(() => {});
    };
    const closeWhenSaved = () => { if (stopped && !awaitingStop && queued === 0) close(); };
    const stopClip = () => {
      clearTimeout(timer);
      if (recorder?.state === "recording") recorder.stop();
    };
    const fail = (cause: unknown) => {
      const message = microphoneError(cause);
      if (isCurrent()) { setStatus("error"); setMediaStream(null); }
      if (mounted.current && !failed) { if (isCurrent()) setError(message); onError(message); }
      failed = true;
      stopped = true;
      if (isCurrent()) flush.current = null;
      clearTimeout(timer);
      clearInterval(frameTimer);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      closeWhenSaved();
      stream?.getTracks().forEach(track => track.stop());
    };
    const startClip = () => {
      if (stopped || !stream) return;
      const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(value => MediaRecorder.isTypeSupported(value));
      if (!mime) throw new Error("Trình duyệt không hỗ trợ định dạng ghi âm của ứng dụng.");
      const activeRecorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
      recorder = activeRecorder;
      const chunks: BlobPart[] = [];
      const startedAt = new Date().toISOString();
      activeRecorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      activeRecorder.onerror = () => fail(new Error("Không thể ghi âm. Kiểm tra quyền microphone."));
      activeRecorder.onstop = () => {
        awaitingStop = false;
        const endedAt = new Date().toISOString();
        // Ảnh là trạng thái cuối đoạn ghi âm, không phải bằng chứng của mọi thời điểm trong đoạn.
        let frame: string | undefined;
        if (!stopped) { try { frame = captureFrame(); } catch { /* Ghi âm vẫn được lưu nếu không chụp được ảnh. */ } }
        if (chunks.length) {
          const blob = new Blob(chunks, { type: activeRecorder.mimeType || mime });
          queued += 1;
          if (isCurrent()) setSaving(true);
          uploads = uploads.then(async () => {
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(",")[1]);
                reader.onerror = () => reject(new Error("Không thể đọc đoạn ghi âm."));
                reader.readAsDataURL(blob);
              });
              const result = await auditorRequest<{ event: AuditEvent }>(`/audio/${token}`, {
                data, mime: blob.type.split(";")[0], started_at: startedAt, ended_at: endedAt,
                frame_base64: frame, frame_captured_at: frame ? endedAt : undefined,
              });
              if (mounted.current) onEvent(result.event);
              if (mounted.current && currentSession.current.date === date && currentSession.current.sessionId === sessionId) setSavedClips(value => value + 1);
            } catch (cause) {
              if (mounted.current) {
                const url = URL.createObjectURL(blob);
                recoveryUrls.current.add(url);
                const extension = blob.type.startsWith("audio/ogg") ? "ogg" : blob.type.startsWith("audio/mp4") ? "m4a" : "webm";
                setUnsavedClips(previous => [...previous, { url, filename: `voice_${date}_${sessionId}_${startedAt.replace(/[:.]/g, "-")}.${extension}` }]);
              }
              fail(new Error(`Không lưu được đoạn ghi âm. Microphone đã dừng: ${microphoneError(cause)}`));
            } finally {
              queued -= 1;
              if (isCurrent()) setSaving(queued > 0);
              closeWhenSaved();
            }
          });
        } else if (!stopped && Date.now() - Date.parse(startedAt) > 1500) {
          fail(new Error("Microphone không tạo được đoạn ghi âm. Kiểm tra thiết bị rồi thử lại."));
        }
        if (stopped) closeWhenSaved();
        else if (queued >= 3) fail(new Error("Lưu ghi âm đang bị chậm. Microphone đã dừng; chờ các đoạn đang lưu hoàn tất rồi thử lại."));
        else { try { startClip(); } catch (cause) { fail(cause); } }
      };
      activeRecorder.start();
      awaitingStop = true;
      timer = setTimeout(stopClip, 10000);
    };
    const sampleFrame = async () => {
      if (stopped || frameBusy || !token) return;
      frameBusy = true;
      try {
        const frame = captureFrame();
        await auditorRequest(`/audio/${token}/frame`, { frame_base64: frame, captured_at: frame ? new Date().toISOString() : undefined });
        frameError = "";
      } catch (cause) {
        // Thiếu ảnh không được làm mất ghi âm; thông báo khi lỗi thay đổi.
        const message = microphoneError(cause);
        if (isCurrent() && !stopped && message !== frameError) onError(`Ghi âm tiếp tục, chưa lấy được ảnh quan sát: ${message}`);
        frameError = message;
      } finally { frameBusy = false; }
    };
    setStatus("starting");
    setError("");
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Ghi âm cần trình duyệt hỗ trợ trên localhost hoặc HTTPS.");
        // Nguồn trộn ảo đã xử lý âm thanh; tránh lọc lại hoặc ép về mono.
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState !== "live") throw new Error("Microphone không cung cấp âm thanh. Kiểm tra thiết bị rồi thử lại.");
        const result = await auditorRequest<{ token: string }>("/audio/start", { date, session_id: sessionId, source_id: sourceId, capture_generation: generation });
        token = result.token;
        if (stopped) { close(); stream.getTracks().forEach(item => item.stop()); return; }
        track.addEventListener("ended", () => { if (!stopped) fail(new Error("Microphone đã ngắt kết nối.")); }, { once: true });
        startClip();
        void sampleFrame();
        frameTimer = setInterval(() => void sampleFrame(), 3000);
        flush.current = stopClip;
        if (isCurrent()) { setMediaStream(stream); setStatus("recording"); }
      } catch (cause) { if (!stopped) fail(cause); close(); }
    })();
    return () => {
      stopped = true;
      flush.current = null;
      clearTimeout(timer);
      clearInterval(frameTimer);
      // Hoàn tất và lưu đoạn cuối vào phiên gốc trước khi đóng token.
      if (recorder && recorder.state !== "inactive") recorder.stop();
      closeWhenSaved();
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [enabled, recording, date, sessionId, generation, sourceId, captureFrame, onEvent, onError, retryKey, deviceId]);
  return { status, error, savedClips, saving, mediaStream, deviceId, setDeviceId, retry, saveClip, unsavedClips, dismissClip };
}

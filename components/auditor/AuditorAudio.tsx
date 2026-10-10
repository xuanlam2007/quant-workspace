"use client";

import { useEffect, useRef, useState } from "react";
import type { useAuditorAudio } from "./useAuditorAudio";
import { AuditorSelect, Icon } from "./AuditorUi";
import AuditorNotice from "./AuditorNotice";
import { LoadingControl, LoadingIndicator, LoadingNumber, LoadingText, Skeleton } from "../ui/Loading";
import StarBorder from "../ui/reactbits/StarBorder";
import { createMicrophoneMeter, type MicrophoneMeterStatus } from "../../lib/microphone-meter";
import styles from "../../app/auditor/auditor.module.css";

type AudioState = ReturnType<typeof useAuditorAudio>;

function AudioMeter({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const bars = useRef<HTMLDivElement>(null);
  const level = useRef<HTMLSpanElement>(null);
  const meter = useRef<ReturnType<typeof createMicrophoneMeter> | null>(null);
  const [status, setStatus] = useState<MicrophoneMeterStatus>("waiting");
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const elements = Array.from(bars.current?.children || []) as HTMLElement[];
    elements.forEach(element => { element.style.transform = "scaleY(0.08)"; });
    if (!active || !stream) return;
    const controller = createMicrophoneMeter(stream, elements, setStatus, decibels => {
      if (level.current) level.current.textContent = decibels === null ? "-- dBFS" : decibels <= -100 ? "≤ −100 dBFS" : `${Math.round(decibels)} dBFS`;
    });
    meter.current = controller;
    return () => {
      meter.current = null;
      controller.dispose();
    };
  }, [stream, active, retryKey]);
  const device = stream?.getAudioTracks()[0]?.label || "Microphone mặc định";
  const recover = active && (status === "blocked" || status === "error");
  const messages: Record<MicrophoneMeterStatus, string> = {
    waiting: "Đang mở bộ đo âm thanh…",
    running: "Microphone sẵn sàng. Hãy nói để kiểm tra.",
    signal: "Có tín hiệu âm thanh microphone",
    silent: "Chưa nhận tiếng nói. Kiểm tra microphone đã chọn.",
    muted: "Microphone đang bị ngắt tín hiệu.",
    ended: "Microphone đã ngắt kết nối.",
    blocked: "Bộ đo âm thanh đang bị trình duyệt tạm dừng.",
    error: "Chưa đo được âm thanh; bộ ghi vẫn chạy riêng.",
  };
  return <div className={styles.audioMeter}>
    <div ref={bars} className={styles.audioBars} aria-hidden="true">{Array.from({ length: 32 }, (_, index) => <i key={index} />)}</div>
    <div className={styles.audioInputReading}><span className={styles.audioDevice} title={active ? device : undefined}>{active ? device : "Chưa chọn microphone"}</span><span ref={level} className={styles.audioLevel} title="Mức tín hiệu đầu vào, càng gần 0 càng lớn">-- dBFS</span></div>
    <span className={styles.help} role="status">{active ? messages[status] : "Microphone chưa ghi âm"}</span>
    <button type="button" className={`${styles.button} ${styles.audioMeterResume}`} aria-hidden={!recover} disabled={!recover} tabIndex={recover ? 0 : -1} onClick={() => status === "error" ? setRetryKey(value => value + 1) : meter.current?.resume()}>{status === "error" ? "Thử lại bộ đo âm thanh" : "Bật hiển thị âm thanh"}</button>
  </div>;
}

export default function AuditorAudio({ audio, enabled, loading, disabled, canRecord, canHear, hasSource, onToggle }: {
  audio: AudioState; enabled: boolean; loading: boolean; disabled: boolean; canRecord: boolean;
  canHear: boolean; hasSource: boolean; onToggle: (enabled: boolean) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");
  const [refreshDevices, setRefreshDevices] = useState(0);
  const active = audio.status === "recording";
  useEffect(() => {
    if (loading) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) { setDevicesError("Trình duyệt chưa hỗ trợ chọn microphone."); return; }
    let stopped = false;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setDevicesLoading(true);
      try {
        const next = await mediaDevices.enumerateDevices();
        if (stopped || current !== request) return;
        setDevices(next.filter(device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default" && device.deviceId !== "communications"));
        setDevicesError("");
      } catch { if (!stopped && current === request) setDevicesError("Không tải được danh sách microphone. Hãy thử làm mới."); }
      finally { if (!stopped && current === request) setDevicesLoading(false); }
    };
    void refresh();
    mediaDevices.addEventListener("devicechange", refresh);
    return () => { stopped = true; mediaDevices.removeEventListener("devicechange", refresh); };
  }, [audio.mediaStream, loading, refreshDevices]);
  const deviceOptions = [{ value: "", label: "Mặc định của trình duyệt" }, ...devices.map((device, index) => ({ value: device.deviceId, label: device.label || `Microphone ${index + 1}` }))];
  if (audio.deviceId && !deviceOptions.some(device => device.value === audio.deviceId)) deviceOptions.push({ value: audio.deviceId, label: "Microphone đã chọn không khả dụng" });
  useEffect(() => {
    if (!active || !audio.mediaStream) return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active, audio.mediaStream]);
  const duration = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const status = audio.status === "starting" ? "Đang mở mic" : active ? "Đang ghi âm" : audio.status === "error" ? "Lỗi microphone" : !enabled ? "Đã tắt" : "Chờ ghi hình";

  return <section className={`${styles.panel} ${styles.audioPanel}`} aria-labelledby="auditor-audio-title">
    <div className={styles.sectionHeading}><h2 id="auditor-audio-title">Ghi âm giọng nói</h2><span className={styles.audioState} data-status={audio.status} role="status">{loading ? <LoadingText width="10ch" /> : audio.status === "starting" ? <LoadingIndicator compact label={status} /> : <><span className={styles.dot} aria-hidden="true" />{status}</>}</span></div>
    <label className={styles.audioToggle}>{loading ? <Skeleton width={16} height={16} label="Đang tải tùy chọn microphone" /> : <input type="checkbox" role="switch" checked={enabled} disabled={disabled} onChange={event => onToggle(event.target.checked)} />}<span>Sử dụng microphone</span></label>
    <div className={styles.field}><label htmlFor="auditor-microphone">Microphone</label><div className={styles.inputAction}><AuditorSelect id="auditor-microphone" label="Microphone" icon="activity" value={audio.deviceId} options={deviceOptions} disabled={disabled || audio.status === "starting" || audio.saving || devicesLoading} loading={loading} onChange={audio.setDeviceId} /><button type="button" className={styles.iconButton} disabled={disabled || devicesLoading || loading} onClick={() => setRefreshDevices(value => value + 1)} aria-label="Làm mới danh sách microphone"><Icon name="refresh" /></button></div>{devicesError && <AuditorNotice message={devicesError} />}</div>
    <StarBorder active={active} color="#fda4af" className={styles.audioVisual} contentClassName={styles.audioVisualContent}>
      <AudioMeter stream={audio.mediaStream} active={active} />
      <div className={styles.audioReadings}>
        <div><span>Thời gian lượt ghi</span><strong className={styles.mono}><LoadingNumber loading={loading} template="00:00">{duration}</LoadingNumber></strong></div>
        <div><span>Đoạn đã lưu</span><strong className={styles.mono}><LoadingNumber loading={loading} digits={3}>{audio.savedClips}</LoadingNumber></strong></div>
      </div>
    </StarBorder>
    <div className={styles.connectionActions}>
      {loading ? <LoadingControl height={38} /> : <button type="button" className={styles.button} disabled={disabled || !active || audio.saving} onClick={audio.saveClip}>{audio.saving ? <LoadingIndicator label="Đang lưu ghi âm" /> : <><Icon name="check" />Lưu đoạn ghi âm ngay</>}</button>}
      {audio.status === "error" && enabled && canRecord && <button type="button" className={styles.button} disabled={disabled || audio.saving} onClick={audio.retry}><Icon name="refresh" />Thử lại microphone</button>}
    </div>
    <p className={styles.help}>{!enabled ? "Bật microphone để ghi lại lời giải thích của trader." : !hasSource ? "Chọn nguồn ghi hình để bắt đầu ghi âm cùng nguồn đó." : !canRecord && !active ? "Microphone sẽ ghi khi bạn bắt đầu hoặc tiếp tục ghi hình." : "Lưu ghi âm mỗi 10 giây, kèm ảnh mỗi 3 giây khi có nguồn. AI đối chiếu lời nói với ảnh trong cùng đoạn ghi."}</p>
    {audio.error && <AuditorNotice message={audio.error} />}
    {audio.unsavedClips.length > 0 && <div><p className={styles.help}>Các đoạn chưa lưu vào phiên vẫn còn trong thẻ này. Tải xuống trước khi đóng hoặc tải lại trang.</p>{audio.unsavedClips.map(clip => <div key={clip.url} className={styles.reportLinks}><a href={clip.url} download={clip.filename}>Tải ghi âm chưa lưu ({clip.filename})</a><button type="button" className={styles.iconButton} aria-label={`Bỏ bản ghi âm chưa lưu ${clip.filename}`} onClick={() => audio.dismissClip(clip.url)}><Icon name="close" /></button></div>)}</div>}
    {enabled && !canHear && <p className={styles.help}>Ghi âm vẫn được lưu để nghe lại. Kiểm tra kết nối AGY hoặc Codex để tự xử lý các đoạn mới. Với đoạn đã lưu, chọn phân tích lại trong nhật ký.</p>}
  </section>;
}

"use client";

import { useEffect, useState } from "react";
import styles from "./AuditorThoughtLine.module.css";

// Điều chỉnh React Bits Thought Line cho trạng thái yêu cầu AI, không hiển thị suy luận nội bộ.
export default function AuditorThoughtLine({ working, queued = false, failed = false, audio = false, startedAt, finishedAt }: {
  working: boolean; queued?: boolean; failed?: boolean; audio?: boolean; startedAt?: string; finishedAt?: string;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const recordedStart = startedAt ? Date.parse(startedAt) : NaN;
    const start = Number.isFinite(recordedStart) ? recordedStart : Date.now();
    const recordedEnd = finishedAt ? Date.parse(finishedAt) : NaN;
    if (!working) {
      if (Number.isFinite(recordedStart) && Number.isFinite(recordedEnd)) setElapsed(Math.max(0, Math.floor((recordedEnd - start) / 1000)));
      return;
    }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [working, startedAt, finishedAt]);

  const label = working ? queued ? "Đã lưu, đang chờ lượt AI" : elapsed >= 90 ? "Vẫn đang chờ phản hồi AI" : audio ? "AI đang xử lý ghi âm và ảnh" : "AI đang quan sát" : failed ? "AI chưa xử lý được" : "AI đã phản hồi";
  const showTimer = working || !!(startedAt && finishedAt && Number.isFinite(Date.parse(startedAt)) && Number.isFinite(Date.parse(finishedAt)));
  return <div className={styles.line} data-working={working} data-failed={failed}>
    <span className={styles.glyph} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M15 2L15.5387 4.39157C15.9957 6.42015 17.5798 8.00431 19.6084 8.46127L22 9L19.6084 9.53873C17.5798 9.99569 15.9957 11.5798 15.5387 13.6084L15 16L14.4613 13.6084C14.0043 11.5798 12.4202 9.99569 10.3916 9.53873L8 9L10.3916 8.46127C12.4201 8.00431 14.0043 6.42015 14.4613 4.39158L15 2Z" /><path d="M7 12L7.38481 13.7083C7.71121 15.1572 8.84275 16.2888 10.2917 16.6152L12 17L10.2917 17.3848C8.84275 17.7112 7.71121 18.8427 7.38481 20.2917L7 22L6.61519 20.2917C6.28879 18.8427 5.15725 17.7112 3.70827 17.3848L2 17L3.70827 16.6152C5.15725 16.2888 6.28879 15.1573 6.61519 13.7083L7 12Z" /></svg></span>
    <span className={styles.label} aria-hidden="true">{label}</span>
    <time className={styles.timer} aria-hidden="true">{showTimer ? elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s` : ""}</time>
    <span className={styles.sr} role="status">{label}</span>
  </div>;
}

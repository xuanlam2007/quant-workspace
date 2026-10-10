"use client";

import type { RefObject } from "react";
import { LoadingImage } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorCapturePreview({ video, ready, onReady, onError }: {
  video: RefObject<HTMLVideoElement>; ready: boolean;
  onReady: () => void; onError: () => void;
}) {
  return <div className={styles.capturePreview} aria-label="Xem trước tab trình duyệt được ghi">
    <video ref={video} autoPlay muted playsInline className={styles.preview} aria-label="Xem trước browser tab" onLoadedData={onReady} onError={onError} />
    {!ready && <LoadingImage label="Đang tải browser tab" />}
  </div>;
}

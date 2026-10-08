"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingImage } from "../ui/Loading";
import styles from "../../app/auditor/auditor.module.css";

export default function AuditorEvidence({ src, timestamp }: { src: string; timestamp: string }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  useEffect(() => {
    if (image.current?.complete) setState(image.current.naturalWidth ? "loaded" : "error");
  }, []);

  return <div className={styles.evidenceImage} aria-busy={state === "loading"}>
    {state === "loading" && <LoadingImage label="Đang tải ảnh minh chứng" />}
    {state === "error" && <p className={styles.error} role="alert">Không tải được ảnh minh chứng. <a href={src} target="_blank" rel="noreferrer">Mở ảnh gốc</a></p>}
    <a href={src} target="_blank" rel="noreferrer" tabIndex={state === "loaded" ? 0 : -1} aria-hidden={state !== "loaded"} className={state !== "loaded" ? styles.evidenceLoading : undefined}>
      <img ref={image} src={src} alt={`Ảnh chụp biểu đồ lúc ${timestamp}`} loading="lazy"
        onLoad={() => setState("loaded")} onError={() => setState("error")} />
    </a>
  </div>;
}

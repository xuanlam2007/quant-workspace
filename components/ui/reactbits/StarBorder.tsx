"use client";

import type { CSSProperties, ReactNode } from "react";
import styles from "./StarBorder.module.css";

// Điều chỉnh StarBorder của React Bits cho trạng thái và giao diện Quant.
export default function StarBorder({ children, active = false, color = "#93c5fd", speed = "6s", className = "", contentClassName = "" }: {
  children: ReactNode; active?: boolean; color?: string; speed?: string; className?: string; contentClassName?: string;
}) {
  return <div className={`${styles.frame} ${className}`} data-active={active} style={{ "--star-color": color, "--star-speed": speed } as CSSProperties}>
    <div className={styles.bottom} aria-hidden="true" />
    <div className={styles.top} aria-hidden="true" />
    <div className={`${styles.content} ${contentClassName}`}>{children}</div>
  </div>;
}

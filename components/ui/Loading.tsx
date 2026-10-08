import type { CSSProperties, ReactNode } from "react";
import styles from "./Loading.module.css";

export function LoadingIndicator({ label = "Đang tải", compact = false }: { label?: string; compact?: boolean }) {
  return <span className={styles.indicator} role="status" aria-label={compact ? label : undefined}>
    <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
    {!compact && <span>{label}</span>}
  </span>;
}

export function Skeleton({ width = "100%", height = "1em", label = "Đang tải dữ liệu", delay = 0 }: {
  width?: CSSProperties["width"]; height?: CSSProperties["height"]; label?: string; delay?: number;
}) {
  return <span className={styles.skeleton} style={{ width, height, "--loading-delay": `${delay}ms` } as CSSProperties} role="status" aria-label={label} />;
}

export function LoadingText({ loading = true, children, width = "12ch", label = "Đang tải nội dung", delay = 0 }: {
  loading?: boolean; children?: ReactNode; width?: CSSProperties["width"]; label?: string; delay?: number;
}) {
  return <span className={styles.text} style={{ width }} title={!loading && typeof children === "string" ? children : undefined} data-loading={loading} aria-busy={loading}>
    <span className={styles.textValue} aria-hidden={loading}>{children ?? "\u00a0"}</span>
    <span className={styles.textPlaceholder} style={{ "--loading-delay": `${delay}ms` } as CSSProperties} role={loading ? "status" : undefined} aria-label={loading ? label : undefined} aria-hidden={!loading} />
  </span>;
}

export function LoadingControl({ width = "100%", height = 38, label = "Đang tải điều khiển", icon = false, children }: {
  width?: CSSProperties["width"]; height?: CSSProperties["height"]; label?: string; icon?: boolean; children?: ReactNode;
}) {
  return <span className={styles.control} style={{ width, height }} role="status" aria-label={label}>
    {children ?? (icon ? <span className={styles.iconPlaceholder} aria-hidden="true" /> : <LoadingText width="58%" label={label} />)}
  </span>;
}

export function LoadingNumber({ loading, children, digits = 5, decimal = false, template, label = "Đang tải số liệu" }: {
  loading: boolean; children?: ReactNode; digits?: number; decimal?: boolean; template?: string; label?: string;
}) {
  const format = template ?? (decimal ? `${"0".repeat(Math.max(1, digits - 3))}.00` : "0".repeat(digits));
  const value = children ?? "N/A";
  const valueText = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  const valueScale = valueText ? Math.min(1, format.length / Math.max(1, valueText.length)) : 1;
  return <span className={styles.number} style={{ width: `${format.length}ch` }} title={loading ? undefined : valueText} data-loading={loading} aria-busy={loading}>
    <span className={styles.numberSizer} aria-hidden="true">{format}</span>
    <span className={styles.numberValue} style={{ fontSize: `${valueScale}em` }} aria-hidden={loading}>{value}</span>
    <span className={styles.numberPlaceholder} role={loading ? "status" : undefined} aria-label={loading ? label : undefined} aria-hidden={!loading}>
      <span className={styles.digits} aria-hidden="true">{Array.from(format, (character, index) =>
        /\d/.test(character) ? <span key={index} className={styles.digit} /> : <span key={index} className={styles.numberSeparator}>{character}</span>
      )}</span>
    </span>
  </span>;
}

export function LoadingImage({ label = "Đang tải ảnh" }: { label?: string }) {
  return <div className={styles.image} role="status" aria-label={label} aria-busy="true"><span className={styles.imageSurface} aria-hidden="true" /></div>;
}

export function LoadingBlock({ label = "Đang tải dữ liệu", rows = 3 }: { label?: string; rows?: number }) {
  return <div className={styles.block} aria-busy="true" role="status" aria-label={label}>
    <div className={styles.rows} aria-hidden="true">{Array.from({ length: rows }, (_, index) =>
      <LoadingText key={index} width={index === rows - 1 ? "65%" : "100%"} delay={index * 40} />
    )}</div>
  </div>;
}

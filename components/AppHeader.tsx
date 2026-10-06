"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { connectionStatusLabel, getConnectionStatus, getServerConnectionStatus, subscribeConnectionStatus, type ConnStatus } from "@/lib/dchart-socket";
import { activateAuditor, getAuditorStatus, getServerAuditorStatus, subscribeAuditorStatus } from "@/lib/auditor-status";
import { useSavedState } from "./chart/config/saved-state";
import { WorkspaceClock } from "./WorkspaceClock";
import styles from "./AppHeader.module.css";

// Giữ vị trí đang hiển thị khi đổi trang hoặc tải lại bố cục.

let previousIndicator: { left: number; width: number; viewport: number } | undefined;

function SavedClock() {
  const [timezone, setTimezone] = useSavedState("chart.timezone.v1", "Asia/Bangkok");
  return <WorkspaceClock timezone={timezone} onTimezoneChange={setTimezone} />;
}

function ServiceStatus({ name, status, title }: { name: string; status: ConnStatus | "idle"; title: string }) {
  const previous = useRef(status);
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = text.current?.animate([
      { transform: "translateY(100%)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ], { duration: 220, easing: "cubic-bezier(.22, 1, .36, 1)" });
    return () => animation?.cancel();
  }, [status]);
  const label = status === "idle" ? "Not started" : status === "connected" ? "Connected" : status === "reconnecting" ? "Connecting" : "Offline";
  return <div className={`${styles.connection} ${styles[status]}`} role="status" aria-live="polite" aria-atomic="true" title={title}>
    <span className={styles.dot} aria-hidden="true" />
    <span className={styles.source}>{name}</span>
    <span className={styles.statusWindow}><span ref={text} className={styles.statusReveal} style={{ animation: "none" }}>{label}</span></span>
  </div>;
}

export function AppHeader({ timezone, exchangeTimezone, onTimezoneChange }: {
  connectionStatus?: ConnStatus;
  timezone?: string;
  exchangeTimezone?: string;
  onTimezoneChange?: (timezone: string) => void;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const status = useSyncExternalStore(subscribeConnectionStatus, getConnectionStatus, getServerConnectionStatus);
  const engine = useSyncExternalStore(subscribeAuditorStatus, getAuditorStatus, getServerAuditorStatus);
  const engineStatus = engine.status;
  const engineError = engine.error;
  useEffect(() => {
    if (pathname === "/auditor") activateAuditor();
  }, [pathname]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;
    let animation: Animation | undefined;
    const position = (animate: boolean) => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) { indicator.style.opacity = "0"; return; }
      const target = { left: active.offsetLeft + 10, width: Math.max(0, active.offsetWidth - 20) };
      const from = previousIndicator;
      animation?.cancel();
      indicator.style.opacity = "1";
      indicator.style.transform = `translateX(${target.left}px)`;
      indicator.style.width = `${target.width}px`;
      if (animate && from && from.viewport === window.innerWidth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        animation = indicator.animate([
          { transform: `translateX(${from.left}px)`, width: `${from.width}px` },
          { transform: `translateX(${target.left}px)`, width: `${target.width}px` },
        ], { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)" });
      }
      previousIndicator = { ...target, viewport: window.innerWidth };
    };
    position(true);
    let width = nav.clientWidth;
    const resize = new ResizeObserver(() => {
      if (nav.clientWidth !== width) { width = nav.clientWidth; position(false); }
    });
    resize.observe(nav);
    return () => {
      const bounds = indicator.getBoundingClientRect();
      const container = nav.getBoundingClientRect();
      if (bounds.width) previousIndicator = { left: bounds.left - container.left, width: bounds.width, viewport: window.innerWidth };
      animation?.cancel();
      resize.disconnect();
    };
  }, [pathname]);


  return <header className={styles.header} aria-label="Workspace header">
    <Link className={styles.brand} href="/" tabIndex={-1} aria-label="Quant Workspace home" draggable={false}>
      <svg className={styles.logo} width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeOpacity=".25" />
        <circle cx="15" cy="15" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="m18 18 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className={styles.wordmark}>Quant<span className={styles.brandSuffix}> Workspace</span></span>
    </Link>
    <nav ref={navRef} className={styles.nav} aria-label="Main navigation">
      {[{ href: "/", label: "Chart" }, { href: "/auditor", label: "Quant Analyzer Auditor" }].map(item => <Link
        key={item.href} href={item.href} tabIndex={-1} draggable={false}
        className={styles.navItem} aria-current={pathname === item.href ? "page" : undefined}
      >{item.label}</Link>)}
      <span ref={indicatorRef} className={styles.navIndicator} aria-hidden="true" />
    </nav>
    <div className={styles.telemetry}>
      <div className={styles.clock}>
        {onTimezoneChange ? <WorkspaceClock timezone={timezone} exchangeTimezone={exchangeTimezone} onTimezoneChange={onTimezoneChange} /> : <SavedClock />}
      </div>
      <div className={styles.services}>
        <ServiceStatus name="VNDIRECT" status={status} title={connectionStatusLabel(status)} />
        <ServiceStatus name="Auditor" status={engineStatus} title={engineError || "Quant Strategy Auditor engine"} />
      </div>
    </div>
    {engineError && pathname === "/auditor" && <p className={styles.engineError} role="alert">{engineError} <button type="button" tabIndex={-1} onClick={() => activateAuditor(true)}>Retry</button></p>}
  </header>;
}

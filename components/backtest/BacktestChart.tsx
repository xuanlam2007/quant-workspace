"use client";

import dynamic from "next/dynamic";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import type { ReplayChartPort, ReplayFrame } from "../../lib/backtest";
import { EmptySearchIcon } from "../chart/layout/symbols/SymbolSearchModal";
import styles from "./BacktestWorkspace.module.css";

const FullChart = dynamic(() => import("../Chart"), { ssr: false, loading: () => <div className={styles.fullChartLoading} aria-busy="true" aria-label="Đang tải chart đầy đủ"><div className={styles.skeleton} /><div className={styles.skeleton} /></div> });
export type BacktestChartHandle = ReplayChartPort;

const BacktestChart = forwardRef<BacktestChartHandle, { frame: ReplayFrame | null; symbol: string; session: number; active: boolean; busy: boolean }>(function BacktestChart({ frame, symbol, session, active, busy }, ref) {
  const port = useRef<ReplayChartPort | null>(null);
  const onReady = useCallback((value: ReplayChartPort | null) => { port.current = value; }, []);
  useImperativeHandle(ref, () => ({
    screenshot: () => { if (!port.current) throw new Error("Chart đầy đủ đang tải, thử lại sau khi toolbar hiện."); return port.current.screenshot(); },
    drawings: () => port.current?.drawings() || [],
    apply: drawings => { if (!port.current) throw new Error("Chart chưa sẵn sàng."); port.current.apply(drawings); },
    reset: () => port.current?.reset(),
  }), []);
  return <div className={`${styles.chartPanel} ${styles.fullChart}`} data-busy={busy}>
    {frame ? <FullChart active={active} replay={{ frame, symbol, session, busy, onReady }} /> : <div className={styles.chartEmpty} role="status"><EmptySearchIcon /><span>Chưa nạp dữ liệu</span></div>}
  </div>;
});

export default BacktestChart;

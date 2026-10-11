"use client";

import dynamic from "next/dynamic";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import type { BacktestDecision, PaperLedger, ReplayChartPort, ReplayData, ReplayFrame } from "../../lib/backtest";
import { EmptySearchIcon } from "../chart/layout/symbols/SymbolSearchModal";
import styles from "./BacktestWorkspace.module.css";

const FullChart = dynamic(() => import("../Chart"), { ssr: false, loading: () => <div className={styles.fullChartLoading} aria-busy="true" aria-label="Đang tải chart đầy đủ"><div className={styles.skeleton} /><div className={styles.skeleton} /></div> });
export type BacktestChartHandle = ReplayChartPort;

const BacktestChart = forwardRef<BacktestChartHandle, { frame: ReplayFrame | null; symbol: string; session: number; active: boolean; busy: boolean; ledger?: PaperLedger; granularity?: ReplayData["granularity"]; onTrade?: (action: BacktestDecision["action"]) => void }>(function BacktestChart({ frame, symbol, session, active, busy, ledger, granularity, onTrade }, ref) {
  const port = useRef<ReplayChartPort | null>(null);
  const onReady = useCallback((value: ReplayChartPort | null) => { port.current = value; }, []);
  useImperativeHandle(ref, () => ({
    capture: () => { if (!port.current) throw new Error("Chart đầy đủ đang tải."); return port.current.capture(); },
    screenshot: () => { if (!port.current) throw new Error("Chart đầy đủ đang tải, thử lại sau khi toolbar hiện."); return port.current.screenshot(); },
    drawings: () => port.current?.drawings() || [],
    apply: async (drawings, indicators) => { if (!port.current) throw new Error("Chart chưa sẵn sàng."); await port.current.apply(drawings, indicators); },
    reset: () => port.current?.reset(),
  }), []);
  const lastOrder = ledger?.orders.at(-1);
  const blocked = !frame?.bars.length || !!ledger?.position || !!ledger?.orders.some(order => order.status === "waiting" || order.status === "triggered");
  return <div className={`${styles.chartPanel} ${styles.fullChart}`} data-busy={busy}>
    {frame ? <FullChart active={active} replay={{ frame, symbol, session, busy, orders: ledger?.orders, granularity, onReady }} /> : <div className={styles.chartEmpty} role="status"><EmptySearchIcon /><span>Chưa nạp dữ liệu</span></div>}
    {!!frame?.bars.length && onTrade && <section className={styles.tradeOverlay} aria-label="Giao dịch mô phỏng trên chart">
      <div className={styles.tradeQuotes}>
        <button type="button" tabIndex={-1} className={styles.tradeLong} disabled={blocked} onClick={() => onTrade("OPEN_LONG")} title="Gửi lệnh MARKET LONG mô phỏng"><span>LONG</span><strong>{frame.bars.at(-1)!.close.toFixed(2)}</strong></button>
        <div className={styles.tradeQuantity}><span>KL</span><strong>1</strong></div>
        <button type="button" tabIndex={-1} className={styles.tradeShort} disabled={blocked} onClick={() => onTrade("OPEN_SHORT")} title="Gửi lệnh MARKET SHORT mô phỏng"><span>SHORT</span><strong>{frame.bars.at(-1)!.close.toFixed(2)}</strong></button>
      </div>
      <div className={styles.tradeFeedback}><span>{lastOrder ? `${lastOrder.side} · ${lastOrder.status === "filled" ? `Khớp @ ${lastOrder.price}` : lastOrder.status === "cancelled" ? "Đã hủy" : lastOrder.status === "triggered" ? "Đã kích hoạt" : "Chờ khớp"}` : "Giá replay · mô phỏng"}</span>{ledger?.position && <button type="button" tabIndex={-1} disabled={ledger.orders.some(order => order.status === "waiting" || order.status === "triggered")} onClick={() => onTrade("CLOSE")}>Đóng</button>}</div>
    </section>}
  </div>;
});

export default BacktestChart;

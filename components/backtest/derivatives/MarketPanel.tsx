import { useMemo, useState } from "react";
import type { ReplayFrame } from "../../../lib/backtest";
import type { ReplayMarket, ReplayQuote } from "../../../lib/derivatives-market";
import { volumeByPrice } from "../../../lib/derivatives-market";
import { DerivativeIcon, formatPrice, formatQuantity, priceClass } from "./DerivativeControls";
import styles from "./DerivativesTerminal.module.css";

export function MarketPanel({ symbol, frame, quote, trades, onPrice }: { symbol: string; frame: ReplayFrame | null; quote: ReplayQuote | null; trades: ReplayMarket["trades"]; onPrice: (price: number) => void }) {
  const [tab, setTab] = useState("depth");
  const [contracts, setContracts] = useState(true);
  const bars = frame?.bars ?? [], last = bars.at(-1)?.close;
  const reference = quote?.reference;
  const change = last !== undefined && reference !== undefined ? last - reference : undefined;
  const bidVolume = quote?.bids.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const askVolume = quote?.asks.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const priceStyle = (price?: number) => priceClass(price, reference, quote?.ceiling, quote?.floor);
  const stats = [
    { label: "Trần", value: quote?.ceiling, color: styles.ceiling },
    { label: "TC", value: reference, color: styles.reference },
    { label: "Sàn", value: quote?.floor, color: styles.floor },
    { label: "Mở cửa", value: bars[0]?.open },
    { label: "Cao", value: bars.length ? Math.max(...bars.map(bar => bar.high)) : undefined },
    { label: "Thấp", value: bars.length ? Math.min(...bars.map(bar => bar.low)) : undefined },
  ];
  return <section className={styles.market} aria-label="Dữ liệu thị trường đã replay">
    <header className={styles.quoteHeader}><strong>{symbol}</strong><span className={priceStyle(last)}>{formatPrice(last)} {change !== undefined && `${change > 0 ? "+" : ""}${formatPrice(change)} (${(change / reference! * 100).toFixed(2)}%)`}</span></header>
    <div className={styles.quoteStats}>{stats.map(({ label, value, color }) => <span key={label}>{label}: <button type="button" tabIndex={-1} className={color ?? priceStyle(value)} disabled={value === undefined} title="Nhấp đúp để chọn giá đặt lệnh" onDoubleClick={() => { if (value !== undefined) onPrice(value); }} onKeyDown={event => { if (event.key === "Enter" && value !== undefined) { event.preventDefault(); onPrice(value); } }}>{formatPrice(value)}</button></span>)}</div>
    <div className={styles.foreign}><span>NN mua: <b>{formatQuantity(quote?.foreignBuy)}</b></span><span>NN bán: <b>{formatQuantity(quote?.foreignSell)}</b></span></div>
    <div className={styles.tabs} role="tablist" aria-label="Thị trường">{[["depth", "Bước giá"], ["history", "Lịch sử"]].map(([value, label]) => <button key={value} type="button" tabIndex={-1} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === "depth" ? <div className={styles.depth}>
      <div className={styles.depthHeading}><span>DƯ MUA</span><span>DƯ BÁN</span></div>
      <div className={styles.pressure} aria-label={`Dư mua ${bidVolume}, dư bán ${askVolume}`}><span style={{ width: `${bidVolume + askVolume ? bidVolume / (bidVolume + askVolume) * 100 : 50}%` }} /></div>
      {!quote || !quote.bids.length && !quote.asks.length ? <p className={styles.empty}>Chưa có dữ liệu sổ lệnh tại thời điểm replay.</p> : Array.from({ length: Math.max(quote.bids.length, quote.asks.length) }, (_, index) => <div className={styles.depthRow} key={index}><span>{formatQuantity(quote.bids[index]?.quantity)}</span><button type="button" tabIndex={-1} className={priceStyle(quote.bids[index]?.price)} disabled={!quote.bids[index]} title="Nhấp đúp để chọn giá đặt lệnh" onDoubleClick={() => onPrice(quote.bids[index].price)}>{formatPrice(quote.bids[index]?.price)}</button><button type="button" tabIndex={-1} className={priceStyle(quote.asks[index]?.price)} disabled={!quote.asks[index]} title="Nhấp đúp để chọn giá đặt lệnh" onDoubleClick={() => onPrice(quote.asks[index].price)}>{formatPrice(quote.asks[index]?.price)}</button><span>{formatQuantity(quote.asks[index]?.quantity)}</span></div>)}
    </div> : <div className={styles.marketHistory}><table><thead><tr><th>Giờ</th><th>Giá</th><th>KL</th><th>Bên</th></tr></thead><tbody>{trades.slice(-100).reverse().map((trade, index) => <tr key={`${trade.time}-${index}`} onDoubleClick={() => onPrice(trade.price)}><td>{new Date(trade.time * 1000).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</td><td className={priceStyle(trade.price)}>{formatPrice(trade.price)}</td><td>{formatQuantity(trade.quantity)}</td><td>{trade.side === "BUY" ? "M" : trade.side === "SELL" ? "B" : "-"}</td></tr>)}{!trades.length && <tr><td colSpan={4} className={styles.empty}>Chưa có dữ liệu khớp lệnh.</td></tr>}</tbody></table></div>}
    <button type="button" tabIndex={-1} className={styles.contractHeading} aria-expanded={contracts} onClick={() => setContracts(value => !value)}>Hợp đồng chỉ số <span className={contracts ? styles.chevronOpen : styles.chevron}><DerivativeIcon name="collapse" /></span></button>
    {contracts && <table><thead><tr><th>HĐ</th><th>Giá</th><th>+/-</th><th>Lệch</th><th>KL</th></tr></thead><tbody><tr onDoubleClick={() => { if (last !== undefined) onPrice(last); }}><td>{symbol}</td><td className={priceStyle(last)}>{formatPrice(last)}</td><td className={priceStyle(last)}>{formatPrice(change)}</td><td>{last !== undefined && quote?.underlying !== undefined ? formatPrice(last - quote.underlying) : "-"}</td><td>{formatQuantity(bars.length ? bars.reduce((sum, bar) => sum + bar.volume, 0) : undefined)}</td></tr></tbody></table>}
  </section>;
}

export function VolumeProfile({ symbol, trades, onPrice }: { symbol: string; trades: ReplayMarket["trades"]; onPrice: (price: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => volumeByPrice(trades), [trades]);
  const max = Math.max(1, ...rows.map(row => row.quantity));
  return <section className={`${styles.volume} ${expanded ? styles.expanded : ""}`} aria-label="Khớp lệnh theo bước giá" onKeyDown={event => { if (event.key === "Escape") setExpanded(false); }}>
    <header className={styles.panelHeader}><span><DerivativeIcon name="chart" />Khớp lệnh theo bước giá</span><button type="button" tabIndex={-1} title={expanded ? "Thu nhỏ" : "Phóng to"} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}><DerivativeIcon name="maximize" /></button></header>
    <h3>Thống kê khớp lệnh theo bước giá - {symbol}</h3>
    {rows.length ? <div className={styles.histogram}><div className={styles.volumeAxis}><span>{formatQuantity(max)}</span><span>KL</span><span>0</span></div><div className={styles.volumeBars}>{rows.map(row => <button type="button" tabIndex={-1} key={row.price} title={`${formatPrice(row.price)}: ${formatQuantity(row.quantity)} HĐ. Nhấp đúp để chọn giá.`} onDoubleClick={() => onPrice(row.price)}><span style={{ height: `${row.quantity / max * 100}%` }} /><small>{formatPrice(row.price)}</small></button>)}</div></div> : <p className={styles.empty}>Cần dữ liệu khớp lệnh theo giá. Nến OHLC không cung cấp phân bổ này.</p>}
  </section>;
}

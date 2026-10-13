import { derivativeIcons } from "./reference-icons";
import styles from "./DerivativesTerminal.module.css";

export function DerivativeIcon({ name }: { name: keyof typeof derivativeIcons }) {
  return <span className={styles.icon} aria-hidden="true" dangerouslySetInnerHTML={{ __html: derivativeIcons[name] }} />;
}

export function NumberStepper({ label, value, onChange, step = 1, disabled = false }: { label: string; value: string; onChange: (value: string) => void; step?: number; disabled?: boolean }) {
  const change = (direction: number) => onChange(String(Math.max(0, Math.round(((Number(value) || 0) + direction * step) * 10) / 10)));
  return <div className={styles.stepper}>
    <button type="button" tabIndex={-1} disabled={disabled} aria-label={`Giảm ${label.toLowerCase()}`} onClick={() => change(-1)}><DerivativeIcon name="minus" /></button>
    <input id={label === "Khối lượng" ? "derivative-quantity" : undefined} tabIndex={-1} aria-label={label} inputMode={step === 1 ? "numeric" : "decimal"} value={value} placeholder="0" disabled={disabled} onChange={event => { if ((step === 1 ? /^\d*$/ : /^\d*(?:\.\d?)?$/).test(event.target.value)) onChange(event.target.value); }} onFocus={event => event.currentTarget.select()} />
    <button type="button" tabIndex={-1} disabled={disabled} aria-label={`Tăng ${label.toLowerCase()}`} onClick={() => change(1)}><DerivativeIcon name="plus" /></button>
  </div>;
}

export const formatPrice = (price: number | null | undefined) => price === null || price === undefined ? "-" : price.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatQuantity = (quantity: number | undefined) => quantity === undefined ? "-" : quantity.toLocaleString("en-US", { maximumFractionDigits: 0 });
export const priceClass = (price: number | undefined, reference: number | undefined, ceiling?: number, floor?: number) => price === undefined || reference === undefined ? "" : price === ceiling ? styles.ceiling : price === floor ? styles.floor : price > reference ? styles.up : price < reference ? styles.down : styles.reference;

import type { PaperLedger } from "./backtest";

type Account = Pick<PaperLedger, "position" | "orders">;
const optionalPositionFields = new Set(["quantity"]);
const optionalOrderFields = new Set(["quantity", "strategy", "relation", "expires", "trailing", "bracket", "parent", "group"]);

function optionalFields(value: object, fields: ReadonlySet<string>) {
  // Python thêm null cho trường tùy chọn; phía trình duyệt có thể bỏ trường đó.
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !fields.has(key) || item != null));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function paperAccountMatches(expected: Account, current: Account): boolean {
  const normalize = (account: Account) => ({
    position: account.position === null ? null : optionalFields(account.position, optionalPositionFields),
    orders: account.orders.map(order => optionalFields(order, optionalOrderFields)),
  });
  return canonical(normalize(expected)) === canonical(normalize(current));
}

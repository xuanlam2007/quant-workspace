import { z } from "zod";

const empty = z.strictObject({});
const id = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const source = id.or(z.literal(""));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const session = z.string().max(80).regex(/^session_\d{6}(?:_\w+)?$/);
const frame = z.string().max(28 * 1024 * 1024).nullable().optional();
const price = z.number().finite().positive();
const time = z.number().int().nonnegative();
const point = z.strictObject({ timestamp: time, price });
const provider = z.enum(["AGY", "CODEX"]);
const terminal = z.enum(["ORCA", "WINDOWS", "WT", "NONE"]);
const sessionBody = z.strictObject({ date, session_id: session });
const drawing = z.strictObject({ tool: z.string().min(1).max(80).regex(/^[a-zA-Z][a-zA-Z0-9]*$/), points: z.array(point).min(1).max(20), label: z.string().max(500).optional() });
const action = z.enum(["HOLD", "OPEN_LONG", "OPEN_SHORT", "CLOSE", "CANCEL"]);
const orderType = z.enum(["MARKET", "LIMIT", "STOP_LIMIT"]);
const replayDrawing = z.strictObject({ id, tool: z.enum(["TrendLine", "HorizontalLine", "Ray", "ExtendedLine"]), points: z.array(point).min(1).max(2), label: z.string().max(160) });

export const backtestFrameSchema = z.strictObject({
  symbol: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_.-]+$/), cutoff: time, granularity: z.enum(["1s", "1m"]),
  bars: z.array(z.strictObject({ time, open: price, high: price, low: price, close: price, volume: z.number().finite().nonnegative() })).min(1).max(2000),
  image: z.string().max(12 * 1024 * 1024), drawings: z.array(replayDrawing).max(100),
  position: z.strictObject({ side: z.enum(["LONG", "SHORT"]), price, time }).nullable(),
  orders: z.array(z.strictObject({ id: z.string().max(80), side: z.enum(["BUY", "SELL"]), purpose: z.enum(["OPEN", "CLOSE"]), type: orderType,
    stop: price.nullable(), limit: price.nullable(), submitted: time, triggered: time.nullable(), status: z.enum(["waiting", "triggered", "filled", "cancelled"]), filled: time.nullable(), price: price.nullable() })).max(300),
  teaching: z.string().max(6000), history: z.array(z.strictObject({ cutoff: time, action, reason: z.string().max(6000) })).max(20),
});

const bodies: Record<string, z.ZodType> = {
  "/recording": z.strictObject({ action: z.enum(["start", "pause", "resume", "stop"]), source_id: source.optional(), browser_only: z.boolean().optional(), capture_generation: time.nullable().optional() }),
  "/recording/preference": z.strictObject({ auto_start: z.boolean() }),
  "/ai/config": z.strictObject({ provider, model: z.string().max(120).regex(/^[^\x00-\x1f]*$/).optional(), effort: z.string().max(40).regex(/^(?:[a-z][a-z0-9_-]*)?$/).optional() }),
  "/ai/connection/test": empty,
  "/terminal/config": z.strictObject({ terminal_type: terminal }),
  "/terminal/open": z.strictObject({ terminal_type: terminal.nullable().optional(), purpose: z.enum(["monitor", "account"]).optional(), provider: provider.nullable().optional() }),
  "/sessions/new": empty,
  "/sessions/switch": sessionBody,
  "/strategy-mode": z.strictObject({ enabled: z.boolean() }),
  "/mode": z.strictObject({ mode: z.enum(["DESKTOP", "IN_APP"]), target_window_id: time.optional(), browser_source_id: source.optional() }),
  "/observation": z.strictObject({ reason: z.string().max(10000).optional(), frame_base64: frame, session_id: session.nullable().optional(), session_date: date.nullable().optional(), source_id: source.optional(), capture_generation: time.nullable().optional() }),
  "/trade": z.strictObject({ type: z.enum(["TRADE_MANUAL", "TRADE_OPEN", "TRADE_CLOSE"]).optional(), action: z.enum(["BUY", "SELL"]), price,
    contracts: z.number().int().min(1).max(1000).optional(), voice_transcript: z.string().max(10000).optional(), drawing_data: drawing.nullable().optional(),
    frame_base64: frame, session_id: session.nullable().optional(), session_date: date.nullable().optional(), source_id: source.optional() }),
  "/audio/start": z.strictObject({ date, session_id: session, source_id: source.optional(), capture_generation: time.nullable().optional() }),
  "/end-session": empty,
  "/socket-ticket": z.strictObject({ client_id: id }),
  "/backtest/connection/test": empty,
  "/backtest/analyze": backtestFrameSchema,
};

const audioBody = z.strictObject({ data: z.string().max(5 * 1024 * 1024), mime: z.enum(["audio/webm", "audio/ogg", "audio/mp4"]), started_at: z.string().max(50), ended_at: z.string().max(50), frame_base64: frame, frame_captured_at: z.string().max(50).nullable().optional() });
const audioFrame = z.strictObject({ frame_base64: frame, captured_at: z.string().max(50).nullable().optional() });
const fill = z.strictObject({ date, session_id: session, candidate_id: z.string().min(1).max(120), decision: z.enum(["confirm", "exclude"]),
  action: z.enum(["BUY", "SELL"]).nullable().optional(), price: price.nullable().optional(), contracts: z.number().int().min(1).max(1000).nullable().optional(),
  timestamp: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/).nullable().optional(), instrument: z.string().max(40).optional(), execution_id: z.string().max(120).optional() });

export function routeSchema(kind: "auditor" | "backtest", method: string, path: string): z.ZodType | null {
  if (kind === "backtest") {
    if (method === "GET" && ["/health", "/backtest/status"].includes(path)) return empty;
    if (method === "POST" && path.startsWith("/backtest/")) return bodies[path] || null;
    return null;
  }
  if (method === "POST") {
    if (path.startsWith("/backtest/")) return null;
    if (bodies[path]) return bodies[path];
    if (/^\/events\/[a-zA-Z0-9_-]{1,120}\/analyze$/.test(path)) return sessionBody;
    if (/^\/events\/[a-zA-Z0-9_-]{1,120}\/fill$/.test(path)) return fill;
    if (/^\/audio\/[a-f0-9]{32}\/frame$/.test(path)) return audioFrame;
    if (/^\/audio\/[a-f0-9]{32}$/.test(path)) return audioBody;
  }
  if (method === "GET" && ["/status", "/windows", "/ai/status", "/gemini/status", "/ai/catalog", "/terminal/config", "/sessions"].includes(path)) return empty;
  const sessionPath = "\\/sessions\\/\\d{4}-\\d{2}-\\d{2}\\/session_\\d{6}(?:_\\w+)?";
  if (method === "GET" && new RegExp(`^${sessionPath}/(?:report/(?:html|pdf)|(?:report/)?(?:frames|audio)/[a-zA-Z0-9_-]+\\.(?:png|jpg|webm|ogg|m4a))$`).test(path)) return empty;
  if (method === "DELETE" && (path === "/sessions" || new RegExp(`^${sessionPath}$`).test(path) || /^\/audio\/[a-f0-9]{32}$/.test(path))) return empty;
  return null;
}

export function validateQuery(path: string, params: URLSearchParams) {
  if (path !== "/ai/catalog") return params.size === 0;
  if ([...params.keys()].some(key => !["provider", "refresh"].includes(key) || params.getAll(key).length !== 1)) return false;
  return provider.safeParse(params.get("provider")).success && [null, "true", "false"].includes(params.get("refresh"));
}

export const emptyBodySchema = empty;

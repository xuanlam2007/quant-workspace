import { z } from "zod";

const symbol = z.string().trim().toUpperCase().regex(/^[A-Z0-9._-]{1,32}$/);
const timestamp = z.string().regex(/^\d{1,12}$/).transform(Number).pipe(z.number().int().positive());
export const symbolQuery = z.strictObject({ symbol });
export const historyQuery = z.strictObject({ symbol, resolution: z.enum(["1", "5", "15", "30", "60", "D", "W", "M"]), from: timestamp, to: timestamp })
  .refine(value => value.to > value.from && value.to - value.from <= 20 * 366 * 86400);
export const replayQuery = z.strictObject({ symbol, granularity: z.enum(["1s", "1m"]), from: timestamp, to: timestamp })
  .refine(value => value.to > value.from && value.to - value.from < 86400 && Math.floor((value.from + 25200) / 86400) === Math.floor((value.to + 25200) / 86400));

export function queryObject(params: URLSearchParams) {
  if ([...params.keys()].some(key => params.getAll(key).length !== 1)) return null;
  return Object.fromEntries(params);
}

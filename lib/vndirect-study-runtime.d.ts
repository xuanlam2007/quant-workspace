import type { ReferenceDefinition, ReferenceGraphics, StudyValue } from "./reference-studies";

interface RuntimeBar { time: number; open: number; high: number; low: number; close: number; volume: number; updatetime: number }
interface RuntimeBarSet { count(): number }
export const bundledStudies: ReferenceDefinition[];
export const bundledColors: Record<string, string>;
export const studyRuntime: {
  BarSet: new (info: object, bars: RuntimeBar[]) => RuntimeBarSet;
  setupFeed(feed: {
    subscribe(ticker: string, currency: unknown, unit: unknown, period: string, range: unknown, onError: unknown, info: unknown, session: unknown, callback: (bars: RuntimeBarSet) => void): string;
    unsubscribe(id: string): void;
  }): void;
  StudyEngine: new (host: {
    tickerid: string;
    period: string;
    body: object;
    symbolInfo: object;
    dataRange: { countBack: number; from: number; to: number };
    input(index: number): StudyValue;
    out(symbol: unknown, row: unknown[]): void;
    nonseriesOut(symbol: unknown, data: { data?: ReferenceGraphics }): void;
    onErrorCallback(message: string): void;
    recalc(): void;
    setNoMoreData(): void;
  }) => { stop(): void };
};

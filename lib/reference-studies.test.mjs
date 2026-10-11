import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { bundledStudies } from "./vndirect-study-runtime.js";
import { replayIndicatorCatalog } from "./backtest.ts";

const stub = 'export async function fetchHistory() { globalThis.referenceFetchCount++; throw new Error("Unexpected external history request"); }';
const source = (await readFile(new URL("./reference-studies.ts", import.meta.url), "utf8"))
  .replace('"./dchart-api"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(stub).toString("base64")}`))
  .replace('import("./vndirect-study-runtime.js")', `import(${JSON.stringify(new URL("./vndirect-study-runtime.js", import.meta.url).href)})`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const { calculateReferenceStudy, referenceDefaults } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("replay catalog matches visible runtime definitions and input contracts", () => {
  const visible = bundledStudies.filter(study => !study.metainfo.is_hidden_study);
  assert.equal(replayIndicatorCatalog.length, visible.length);
  for (const entry of replayIndicatorCatalog) {
    const definition = visible.find(study => study.name === entry.name);
    assert.ok(definition, entry.name);
    assert.deepEqual(entry.inputs.map(input => input.id), definition.metainfo.inputs.filter(input => !input.isHidden).map(input => input.id));
  }
});

test("offline replay computes MA from revealed bars and never fetches a missing symbol", async () => {
  globalThis.referenceFetchCount = 0;
  try {
    const definition = bundledStudies.find(study => study.name === "Moving Average");
    const settings = referenceDefaults(definition);
    const bars = Array.from({ length: 30 }, (_, i) => ({ time: 1700000000 + i * 60, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10 }));
    const result = await calculateReferenceStudy(definition, settings, bars, "TEST", "1", undefined, undefined, true);
    assert.ok(result.points.some(point => Object.values(point.values).some(Number.isFinite)));
    settings.inputs.symbol = "UNAVAILABLE";
    await assert.rejects(calculateReferenceStudy(definition, settings, bars, "TEST", "1", undefined, undefined, true), /cutoff/);
    assert.equal(globalThis.referenceFetchCount, 0);
  } finally { delete globalThis.referenceFetchCount; }
});

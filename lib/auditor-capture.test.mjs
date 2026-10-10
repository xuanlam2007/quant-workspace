import assert from "node:assert/strict";
import test from "node:test";
import { captureBrowserTab } from "./auditor-capture.ts";

const browserStream = { getVideoTracks: () => [{ readyState: "live", getSettings: () => ({ displaySurface: "browser" }) }] };

test("capture includes the full tab and follows resized video dimensions", t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => calls.push(args) }), toDataURL: () => "data:image/png;base64,tab" };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
  t.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document; });
  const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 };
  assert.equal(captureBrowserTab(video, browserStream), "data:image/png;base64,tab");
  assert.deepEqual([canvas.width, canvas.height], [1920, 1080]);
  assert.deepEqual(calls[0], [video, 0, 0, 1920, 1080]);
  video.videoWidth = 1280; video.videoHeight = 720;
  assert.equal(captureBrowserTab(video, browserStream), "data:image/png;base64,tab");
  assert.deepEqual([canvas.width, canvas.height], [1280, 720]);
  assert.deepEqual(calls[1], [video, 0, 0, 1280, 720]);
  canvas.getContext = () => null;
  assert.equal(captureBrowserTab(video, browserStream), undefined);
});

test("capture rejects non-tab sources, ended tracks and unavailable video", () => {
  const video = { readyState: 2, videoWidth: 1920, videoHeight: 1080 };
  for (const displaySurface of ["window", "monitor", undefined]) {
    const stream = { getVideoTracks: () => [{ readyState: "live", getSettings: () => ({ displaySurface }) }] };
    assert.equal(captureBrowserTab(video, stream), undefined);
  }
  for (const override of [{ readyState: 1 }, { videoWidth: 0 }, { videoHeight: 0 }]) {
    assert.equal(captureBrowserTab({ ...video, ...override }, browserStream), undefined);
  }
  assert.equal(captureBrowserTab(video, { getVideoTracks: () => [] }), undefined);
  assert.equal(captureBrowserTab(video, { getVideoTracks: () => [{ readyState: "ended" }] }), undefined);
});

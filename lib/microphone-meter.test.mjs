import assert from "node:assert/strict";
import test from "node:test";
import { createMicrophoneMeter } from "./microphone-meter.ts";

function harness(t, { suspended = false, rejectResume = false, failSource = false, channelCount = 1 } = {}) {
  let clock = 0;
  let nextFrame = 0;
  let allowResume = !suspended;
  let rejected = rejectResume;
  const frames = new Map();
  const pendingResumes = [];
  const statuses = [];
  const levels = [];
  const track = Object.assign(new EventTarget(), { readyState: "live", muted: false, enabled: true, stops: 0, stop() { this.stops += 1; }, getSettings: () => ({ channelCount }) });
  const stream = { getAudioTracks: () => [track] };
  const bars = Array.from({ length: 32 }, () => ({ style: {} }));
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const source = { disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
  const makeAnalyser = () => ({
    fftSize: 256, amplitude: 0, offset: 0, strength: 180, reads: 0, disconnected: false,
    get frequencyBinCount() { return this.fftSize / 2; },
    getFloatTimeDomainData(data) { this.reads += 1; data.forEach((_, index) => { data[index] = this.offset + this.amplitude * Math.sin(index); }); },
    getByteFrequencyData(data) { data.fill(0); data.fill(this.strength, 20, 130); },
    disconnect() { this.disconnected = true; },
  });
  const analysers = [];
  const splitter = { disconnected: false, connections: [], connect(node, channel) { this.connections.push({ node, channel }); }, disconnect() { this.disconnected = true; } };
  const contexts = [];
  class FakeContext extends EventTarget {
    constructor() { super(); contexts.push(this); this.state = suspended ? "suspended" : "running"; this.sampleRate = 48000; this.resumes = 0; }
    createMediaStreamSource(input) { assert.equal(input, stream); if (failSource) throw new Error("source unavailable"); return source; }
    createAnalyser() { const analyser = makeAnalyser(); analysers.push(analyser); return analyser; }
    createChannelSplitter(count) { assert.equal(count, channelCount); return splitter; }
    resume() {
      this.resumes += 1;
      if (rejected) return Promise.reject(new Error("activation needed"));
      if (!allowResume) return new Promise(resolve => pendingResumes.push(resolve));
      this.state = "running";
      this.dispatchEvent(new Event("statechange"));
      pendingResumes.splice(0).forEach(resolve => resolve());
      return Promise.resolve();
    }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  const overrides = { AudioContext: FakeContext, window: windowTarget, document: documentTarget, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id) };
  const originals = new Map(Object.keys(overrides).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(overrides)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.mock.method(performance, "now", () => clock);
  const meter = createMicrophoneMeter(stream, bars, status => statuses.push(status), level => levels.push(level));
  t.after(() => {
    meter.dispose();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    meter, frames, bars, statuses, levels, track, source, analysers, splitter, documentTarget,
    get analyser() { return analysers[0]; },
    get context() { return contexts.at(-1); },
    tick(time) { clock = time; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)); },
    activate() { allowResume = true; rejected = false; windowTarget.dispatchEvent(new Event("pointerdown")); },
    finishPending() { pendingResumes.splice(0).forEach(resolve => resolve()); },
  };
}

test("pending resume reports blocked and recovers from a user gesture", async t => {
  const h = harness(t, { suspended: true });
  h.tick(50);
  assert.equal(h.statuses.at(-1), "blocked");
  assert.equal(h.frames.size, 1);
  assert.equal(h.analyser.reads, 0);
  h.analyser.amplitude = 0.02;
  h.activate();
  await Promise.resolve();
  h.tick(100);
  assert.equal(h.statuses.at(-1), "signal");
  assert.ok(h.bars.some(bar => bar.style.transform !== "scaleY(0.08)"));
  assert.equal(h.frames.size, 1);
});

test("quiet speech moves multiple voice-frequency bands without fake silence motion", t => {
  const h = harness(t);
  h.tick(50);
  assert.ok(h.bars.every(bar => bar.style.transform === "scaleY(0.08)"));
  h.analyser.amplitude = 0.004;
  h.tick(100);
  assert.ok(h.bars.filter(bar => bar.style.transform !== "scaleY(0.08)").length > 5);
  h.analyser.amplitude = 0;
  h.tick(3200);
  assert.equal(h.statuses.at(-1), "silent");
  assert.ok(h.bars.every(bar => bar.style.transform === "scaleY(0.08)"));
  h.analyser.amplitude = 0.02;
  h.tick(3300);
  assert.equal(h.statuses.at(-1), "signal");
});

test("mute, unmute, and ended input states reset the spectrum", t => {
  const h = harness(t);
  h.analyser.amplitude = 0.02;
  h.tick(50);
  h.track.muted = true;
  h.track.dispatchEvent(new Event("mute"));
  assert.equal(h.statuses.at(-1), "muted");
  assert.ok(h.bars.every(bar => bar.style.transform === "scaleY(0.08)"));
  h.track.muted = false;
  h.track.dispatchEvent(new Event("unmute"));
  h.tick(100);
  assert.equal(h.statuses.at(-1), "signal");
  h.track.enabled = false;
  h.tick(150);
  assert.equal(h.statuses.at(-1), "muted");
  h.track.readyState = "ended";
  h.track.dispatchEvent(new Event("ended"));
  assert.equal(h.statuses.at(-1), "ended");
});

test("soft input produces visible bars quickly without changing measured volume", t => {
  const h = harness(t);
  h.tick(0);
  h.analyser.amplitude = 0.0005;
  h.analyser.strength = 36;
  h.tick(34);
  assert.equal(h.statuses.at(-1), "signal");
  assert.ok(Math.abs(h.levels.at(-1) - (-69.03)) < 0.1);
  assert.ok(h.bars.some(bar => Number(bar.style.transform.slice(7, -1)) > 0.25));
  assert.ok(h.bars.every(bar => Number(bar.style.transform.slice(7, -1)) <= 1));
  h.analyser.amplitude = 0;
  h.tick(68);
  assert.ok(h.bars.every(bar => bar.style.transform === "scaleY(0.08)" && bar.style.opacity === "0.4"));
});

test("a rejected resume remains recoverable", async t => {
  const h = harness(t, { suspended: true, rejectResume: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.statuses.at(-1), "blocked");
  h.activate();
  await Promise.resolve();
  h.tick(50);
  assert.equal(h.statuses.at(-1), "running");
});

test("a running processor and DC offset do not claim an audio signal", t => {
  const h = harness(t);
  assert.equal(h.statuses.at(-1), "running");
  assert.ok(!h.statuses.includes("signal"));
  h.analyser.offset = 0.2;
  h.tick(50);
  h.tick(3100);
  assert.equal(h.statuses.at(-1), "silent");
  assert.ok(h.levels.at(-1) <= -100);
  assert.ok(h.bars.every(bar => bar.style.transform === "scaleY(0.08)"));
  h.analyser.amplitude = 0.004;
  h.tick(3200);
  assert.equal(h.statuses.at(-1), "signal");
  assert.ok(h.levels.at(-1) > -65 && h.levels.at(-1) < -40);
  h.track.muted = true;
  h.track.dispatchEvent(new Event("mute"));
  assert.equal(h.levels.at(-1), null);
});

test("right-channel audio remains visible when the left channel is silent", t => {
  const h = harness(t, { channelCount: 2 });
  h.analysers[1].amplitude = 0.02;
  h.tick(50);
  assert.equal(h.statuses.at(-1), "signal");
  assert.ok(h.levels.at(-1) > -40);
  assert.ok(h.bars.some(bar => bar.style.transform !== "scaleY(0.08)"));
  assert.deepEqual(h.splitter.connections.map(connection => connection.channel), [0, 1]);
  assert.equal(h.splitter.connections[1].node, h.analysers[1]);
});

test("opposite-phase stereo does not cancel the meter reading", t => {
  const h = harness(t, { channelCount: 2 });
  h.analysers[0].amplitude = 0.02;
  h.analysers[1].amplitude = -0.02;
  h.tick(50);
  assert.equal(h.statuses.at(-1), "signal");
  assert.ok(h.levels.at(-1) > -40);
  assert.ok(h.bars.some(bar => bar.style.transform !== "scaleY(0.08)"));
  h.meter.dispose();
  assert.equal(h.splitter.disconnected, true);
  assert.ok(h.analysers.every(analyser => analyser.disconnected));
  assert.equal(h.track.stops, 0);
});

test("cleanup ignores late resume and leaves recorder-owned tracks alive", async t => {
  const h = harness(t, { suspended: true });
  h.meter.dispose();
  const count = h.statuses.length;
  const resumes = h.context.resumes;
  h.finishPending();
  await Promise.resolve();
  h.activate();
  h.track.dispatchEvent(new Event("mute"));
  h.tick(100);
  assert.equal(h.statuses.length, count);
  assert.equal(h.context.resumes, resumes);
  assert.equal(h.context.state, "closed");
  assert.equal(h.track.stops, 0);
  assert.equal(h.track.readyState, "live");
  assert.equal(h.frames.size, 0);
  assert.equal(h.source.disconnected, true);
  assert.equal(h.analyser.disconnected, true);
});

test("source initialization failure closes only meter resources", t => {
  const h = harness(t, { failSource: true });
  assert.equal(h.statuses.at(-1), "error");
  assert.equal(h.context.state, "closed");
  assert.equal(h.track.stops, 0);
  assert.equal(h.frames.size, 0);
});

test("hidden pages skip analysis and recover a suspended context when visible", async t => {
  const h = harness(t);
  h.documentTarget.visibilityState = "hidden";
  h.tick(50);
  assert.equal(h.analyser.reads, 0);
  h.context.state = "suspended";
  h.context.dispatchEvent(new Event("statechange"));
  h.documentTarget.visibilityState = "visible";
  h.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  h.tick(100);
  assert.equal(h.statuses.at(-1), "running");
  assert.equal(h.analyser.reads, 1);
});

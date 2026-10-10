export type MicrophoneMeterStatus = "waiting" | "running" | "signal" | "silent" | "muted" | "ended" | "blocked" | "error";

const SIGNAL_FLOOR_DB = -72;
const SIGNAL_FLOOR_POWER = 10 ** (SIGNAL_FLOOR_DB / 10);

export function createMicrophoneMeter(stream: MediaStream, bars: readonly HTMLElement[], onStatus: (status: MicrophoneMeterStatus) => void, onLevel: (decibels: number | null) => void = () => {}) {
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let splitter: ChannelSplitterNode | undefined;
  const analysers: AnalyserNode[] = [];
  let frame = 0;
  let disposed = false;
  let previous: MicrophoneMeterStatus | undefined;
  let lastSample = -Infinity;
  let lastSignal = -Infinity;
  let readySince = performance.now();
  const track = stream.getAudioTracks()[0];
  const reset = () => { bars.forEach(bar => { bar.style.transform = "scaleY(0.08)"; bar.style.opacity = "0.4"; }); onLevel(null); };
  const report = (status: MicrophoneMeterStatus) => {
    if (!disposed && previous !== status) { previous = status; onStatus(status); }
  };
  const inputStatus = (): MicrophoneMeterStatus => {
    if (!track || track.readyState !== "live") return "ended";
    if (track.muted || !track.enabled) return "muted";
    if (!context || context.state === "closed") return "error";
    if (context.state !== "running") return "blocked";
    return "running";
  };
  const stateChanged = () => {
    const status = inputStatus();
    if (status !== "running") reset();
    else { readySince = performance.now(); lastSignal = -Infinity; }
    report(status);
  };
  const resume = () => {
    if (disposed || !context || context.state === "closed" || context.state === "running") return;
    // Gọi ngay trong sự kiện người dùng để đáp ứng chính sách tự phát âm thanh.
    void context.resume().then(() => { if (!disposed) stateChanged(); }).catch(() => {
      if (!disposed) { reset(); report(inputStatus()); }
    });
  };
  const visible = () => { if (document.visibilityState === "visible") resume(); };
  const dispose = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    document.removeEventListener("visibilitychange", visible);
    track?.removeEventListener("mute", stateChanged);
    track?.removeEventListener("unmute", stateChanged);
    track?.removeEventListener("ended", stateChanged);
    context?.removeEventListener("statechange", stateChanged);
    source?.disconnect();
    splitter?.disconnect();
    analysers.forEach(analyser => analyser.disconnect());
    if (context && context.state !== "closed") void context.close().catch(() => {});
    reset();
  };
  reset();
  report("waiting");
  try {
    // Chỉ đo luồng đang ghi; không mở thêm microphone hoặc phát âm ra loa.
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    const channelCount = Math.min(32, Math.max(1, track?.getSettings().channelCount || 2));
    splitter = context.createChannelSplitter(channelCount);
    source.connect(splitter);
    for (let channel = 0; channel < channelCount; channel++) {
      const analyser = context.createAnalyser();
      analysers.push(analyser);
      analyser.fftSize = 2048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -35;
      analyser.smoothingTimeConstant = 0.2;
      splitter.connect(analyser, channel);
    }
    const frequencies = new Uint8Array(1024);
    const channelFrequencies = new Uint8Array(1024);
    const waveform = new Float32Array(2048);
    const binHz = context.sampleRate / 2048;
    const maxHz = Math.min(8000, context.sampleRate / 2);
    const bands = bars.map((_, index) => {
      // Dải tần logarit giúp giọng nói không dồn vào vài cột đầu tiên.
      const start = Math.max(1, Math.floor(80 * (maxHz / 80) ** (index / bars.length) / binHz));
      const end = Math.min(frequencies.length, Math.max(start + 1, Math.ceil(80 * (maxHz / 80) ** ((index + 1) / bars.length) / binHz)));
      return { start, end };
    });
    const sample = (time: number) => {
      if (disposed) return;
      if (time - lastSample >= 1000 / 30 && document.visibilityState === "visible") {
        lastSample = time;
        const status = inputStatus();
        if (status !== "running") { reset(); report(status); }
        else {
          frequencies.fill(0);
          let peakPower = 0;
          // Đo riêng từng kênh để tín hiệu ngược pha không triệt tiêu khi trộn mono.
          for (const analyser of analysers) {
            analyser.getFloatTimeDomainData(waveform);
            let mean = 0;
            for (const amplitude of waveform) mean += amplitude;
            mean /= waveform.length;
            let power = 0;
            // Loại độ lệch DC để nguồn ảo không bị nhận nhầm là tiếng nói.
            for (const amplitude of waveform) power += (amplitude - mean) ** 2;
            power /= waveform.length;
            peakPower = Math.max(peakPower, power);
            if (power > SIGNAL_FLOOR_POWER) {
              analyser.getByteFrequencyData(channelFrequencies);
              for (let bin = 0; bin < frequencies.length; bin++) frequencies[bin] = Math.max(frequencies[bin], channelFrequencies[bin]);
            }
          }
          const decibels = 10 * Math.log10(Math.max(peakPower, 1e-12));
          onLevel(decibels);
          const hasSignal = decibels > SIGNAL_FLOOR_DB;
          if (hasSignal) lastSignal = time;
          report(time - lastSignal < 500 ? "signal" : time - Math.max(readySince, lastSignal) >= 3000 ? "silent" : "running");
          bars.forEach((bar, index) => {
            const { start, end } = bands[index];
            let peak = 0;
            for (let bin = start; bin < end; bin++) peak = Math.max(peak, frequencies[bin]);
            // Tăng độ nhạy hiển thị của âm nhỏ, không đổi âm lượng bản ghi.
            const strength = hasSignal ? (peak / 255) ** 0.65 : 0;
            bar.style.transform = `scaleY(${Math.max(0.08, strength)})`;
            bar.style.opacity = String(0.4 + strength * 0.6);
          });
        }
      }
      frame = requestAnimationFrame(sample);
    };
    context.addEventListener("statechange", stateChanged);
    track?.addEventListener("mute", stateChanged);
    track?.addEventListener("unmute", stateChanged);
    track?.addEventListener("ended", stateChanged);
    window.addEventListener("pointerdown", resume, { passive: true });
    window.addEventListener("keydown", resume);
    document.addEventListener("visibilitychange", visible);
    // Vòng đo vẫn chạy khi resume đang chờ để hiển thị trạng thái bị chặn.
    stateChanged();
    frame = requestAnimationFrame(sample);
    resume();
  } catch {
    dispose();
    onStatus("error");
  }
  return { resume, dispose };
}

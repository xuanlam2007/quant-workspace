export function captureBrowserTab(video: HTMLVideoElement, stream: MediaStream): string | undefined {
  const track = stream.getVideoTracks()[0];
  // Chỉ nhận browser tab; không fallback sang cửa sổ hoặc desktop.
  if (!track || track.readyState !== "live" || track.getSettings().displaySurface !== "browser" || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

async function waitForResult(signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 400);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function recoverBacktestAnalysis<T>(send: () => Promise<T>, completed: () => T | undefined, signal: AbortSignal, wait = waitForResult): Promise<T> {
  try { return await send(); }
  catch (error) {
    if (!(error instanceof TypeError) || signal.aborted) throw error;
    // Chỉ đọc kết quả đã xác thực; không gửi lại yêu cầu AI hoặc lệnh mô phỏng.
    for (let attempt = 0; attempt <= 20; attempt += 1) {
      signal.throwIfAborted();
      const result = completed();
      if (result !== undefined) return result;
      if (attempt < 20) await wait(signal);
    }
    throw new Error("Mất kết nối khi nhận quyết định AI. Chưa khôi phục được kết quả; thao tác đã xác nhận vẫn được giữ.");
  }
}

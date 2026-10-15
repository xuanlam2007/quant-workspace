type Delivery<T> = { payload: Promise<T>; acknowledged: boolean };

export async function pollReplayTools(valid: () => boolean, poll: () => Promise<boolean>, retry: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 400))) {
  // Server chờ lệnh mới; luồng thành công không phụ thuộc timer của tab.
  while (valid()) {
    const delivered = await poll();
    if (!delivered && valid()) await retry();
  }
}

export class ReplayToolDelivery<T> {
  private entries = new Map<string, Delivery<T>>();
  private onAcknowledged: (payload: T) => void;

  constructor(onAcknowledged: (payload: T) => void) {
    this.onAcknowledged = onAcknowledged;
  }

  async confirm(ids: string[]) {
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry || entry.acknowledged) continue;
      const payload = await entry.payload;
      if (entry.acknowledged) continue;
      entry.acknowledged = true;
      this.onAcknowledged(payload);
    }
  }

  async deliver(id: string, prepare: () => Promise<T>, send: (payload: T) => Promise<unknown>) {
    let entry = this.entries.get(id);
    if (!entry) {
      // Giữ nguyên payload ACK qua các lần thử, không chạy lại thao tác chart hoặc lệnh.
      entry = { payload: Promise.resolve().then(prepare), acknowledged: false };
      this.entries.set(id, entry);
    }
    if (entry.acknowledged) return;
    await send(await entry.payload);
    await this.confirm([id]);
  }
}

export function waitForReplayPaint(schedule: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback), cancel: (id: number) => void = id => cancelAnimationFrame(id)) {
  return new Promise<void>(resolve => {
    let first = 0;
    let second = 0;
    const finish = () => { clearTimeout(timer); cancel(first); cancel(second); resolve(); };
    const timer = setTimeout(finish, 100);
    first = schedule(() => { second = schedule(finish); });
  });
}

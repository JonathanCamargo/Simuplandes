import type { FrameScheduler } from "../runtime";

/** A manual, deterministic `FrameScheduler`: `tick(ms)` advances `now()` and runs every queued callback. */
export class FakeScheduler implements FrameScheduler {
  private nowMs = 0;
  private queue = new Map<number, (nowMs: number) => void>();
  private nextId = 1;

  now(): number {
    return this.nowMs;
  }

  request(cb: (nowMs: number) => void): number {
    const id = this.nextId++;
    this.queue.set(id, cb);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  /** How many callbacks are waiting for the next tick. */
  get pending(): number {
    return this.queue.size;
  }

  /** Advances `now` by `ms` and runs every callback queued at the time of the call. */
  tick(ms: number): void {
    this.nowMs += ms;
    const callbacks = Array.from(this.queue.values());
    this.queue.clear();
    for (const cb of callbacks) cb(this.nowMs);
  }
}

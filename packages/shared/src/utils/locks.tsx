import { Semaphore } from 'async-mutex';

type LockCallback<T> = () => Promise<T>;

export class ReadWriteLock {
  private semaphore: Semaphore;
  private readers: number;
  private readersMutex: Semaphore;
  // Incremented every time a writer enters its critical section. This lets code snapshot the
  // generation, do work WITHOUT holding the lock (eg. network I/O — holding a read lock across a
  // fetch starves writers, see AsyncStore.setAsync), and later detect whether a write-locked
  // mutation began in the meantime: if the generation changed, the work's result was computed
  // against pre-mutation state and must be discarded rather than committed.
  private writeGeneration: number;

  constructor() {
    this.semaphore = new Semaphore(1); // Semaphore with 1 permit
    this.readers = 0; // Track the number of readers
    this.readersMutex = new Semaphore(1); // Protect access to `readers` count
    this.writeGeneration = 0;
  }

  /**
   * Returns the current write generation: a counter that increases whenever a writer acquires this
   * lock. Compare two snapshots to check whether a write-locked mutation started in between.
   *
   * Note that reading the generation without holding the lock is only a heuristic (a writer may
   * enter right after the read); for a reliable compare, take the second snapshot while holding at
   * least a read lock, which guarantees no writer is concurrently active.
   */
  getWriteGeneration(): number {
    return this.writeGeneration;
  }

  async withReadLock<T>(callback: LockCallback<T>): Promise<T> {
    await this._acquireReadLock();
    try {
      return await callback();
    } finally {
      await this._releaseReadLock();
    }
  }

  async withWriteLock<T>(callback: LockCallback<T>): Promise<T> {
    await this._acquireWriteLock();
    try {
      return await callback();
    } finally {
      await this._releaseWriteLock();
    }
  }

  private async _acquireReadLock(): Promise<void> {
    // Increment the readers count
    await this.readersMutex.acquire();
    try {
      this.readers += 1;
      // If this is the first reader, block writers
      if (this.readers === 1) {
        await this.semaphore.acquire();
      }
    } finally {
      this.readersMutex.release();
    }
  }

  private async _releaseReadLock(): Promise<void> {
    // Decrement the readers count
    await this.readersMutex.acquire();
    try {
      this.readers -= 1;
      // If this was the last reader, release the writer block
      if (this.readers === 0) {
        this.semaphore.release();
      }
    } finally {
      this.readersMutex.release();
    }
  }

  private async _acquireWriteLock(): Promise<void> {
    // Writers acquire the main semaphore exclusively
    await this.semaphore.acquire();
    // Bump the generation only AFTER the semaphore is held, ie. exactly when the writer's critical
    // section begins. A lock-free commit racing a waiting writer thus linearizes cleanly: either it
    // commits before the writer starts (same generation), or it observes the bumped generation and
    // discards. We intentionally do NOT bump again on release, so work started while the writer is
    // active (same generation as the writer) may still commit afterwards — see AsyncStore.setAsync
    // for why that is desired.
    this.writeGeneration++;
  }

  private async _releaseWriteLock(): Promise<void> {
    // Writers release the main semaphore
    this.semaphore.release();
  }
}

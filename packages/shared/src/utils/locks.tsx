import { Semaphore } from 'async-mutex';

type LockCallback<T> = () => Promise<T>;

export class ReadWriteLock {
  private semaphore: Semaphore;
  private readers: number;
  private readersMutex: Semaphore;

  constructor() {
    this.semaphore = new Semaphore(1); // Semaphore with 1 permit
    this.readers = 0; // Track the number of readers
    this.readersMutex = new Semaphore(1); // Protect access to `readers` count
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
  }

  private async _releaseWriteLock(): Promise<void> {
    // Writers release the main semaphore
    this.semaphore.release();
  }
}

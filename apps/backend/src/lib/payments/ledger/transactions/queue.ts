export class EventQueue<T extends { at: number }> {
  private readonly heap: Array<{ seq: number, value: T }> = [];
  private seq = 0;

  push(value: T) {
    this.heap.push({ seq: this.seq++, value });
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | null {
    if (this.heap.length === 0) return null;
    const root = this.heap[0];
    const tail = this.heap.pop();
    if (!tail) return root.value;
    if (this.heap.length > 0) {
      this.heap[0] = tail;
      this.bubbleDown(0);
    }
    return root.value;
  }

  private compare(a: { seq: number, value: T }, b: { seq: number, value: T }) {
    if (a.value.at !== b.value.at) return a.value.at - b.value.at;
    return a.seq - b.seq;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[parent], this.heap[index]) <= 0) return;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.heap.length && this.compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < this.heap.length && this.compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === index) return;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}

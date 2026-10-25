// Binary min-heap used by the path searches (map generation, sea routes, marching).

/** Binary min-heap of (priority, value) pairs. */
export class MinHeap {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  push(priority: number, value: number): void {
    this.priorities.push(priority);
    this.values.push(value);
    let i = this.values.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.priorities[parent] as number) <= priority) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.priorities[0] as number, this.values[0] as number];
    const lastPriority = this.priorities.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.values.length > 0) {
      this.priorities[0] = lastPriority;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.values.length && (this.priorities[left] as number) < (this.priorities[smallest] as number))
          smallest = left;
        if (right < this.values.length && (this.priorities[right] as number) < (this.priorities[smallest] as number))
          smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(i: number, j: number): void {
    [this.priorities[i], this.priorities[j]] = [this.priorities[j] as number, this.priorities[i] as number];
    [this.values[i], this.values[j]] = [this.values[j] as number, this.values[i] as number];
  }
}

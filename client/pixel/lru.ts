/**
 * A least-recently-used cache with a cap on entries and, optionally, on their total weight.
 * Reading an entry makes it the newest; the oldest go first once either cap is passed.
 */
export class Lru<Value> {
  private readonly entries = new Map<string, Value>();
  private total = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight = Infinity,
    private readonly weigh: (value: Value) => number = () => 0,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get weight(): number {
    return this.total;
  }

  get(key: string): Value | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: Value): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.total -= this.weigh(previous);
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.total += this.weigh(value);
    // The entry just added always stays, even when it alone is over the weight cap.
    while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.total > this.maxWeight)) {
      const oldest = this.entries.keys().next().value!;
      this.total -= this.weigh(this.entries.get(oldest)!);
      this.entries.delete(oldest);
    }
  }
}

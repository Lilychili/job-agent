export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs `work` on every item, at most `limit` at a time. */
export async function forEachParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  async function next() {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }
  await Promise.all(Array.from({ length: limit }, next));
}

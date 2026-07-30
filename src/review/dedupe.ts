// Deduplicate concurrent reviews for the same key within a process.

const inflight = new Map<string, Promise<unknown>>();

export async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key);
	if (existing) return existing as Promise<T>;

	const p = fn().finally(() => inflight.delete(key));
	inflight.set(key, p);
	return p;
}

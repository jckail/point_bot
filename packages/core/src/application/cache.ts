import type { UserId } from "../domain/shared/ids";
/**
 * Read-through cache port for derived read models (portfolio views).
 *
 * The cache is an optimisation, never a source of truth: every value has a
 * short TTL as a staleness backstop, and writers invalidate by tag (typically
 * `user:<id>`) right after a state change commits. `remember` coalesces
 * concurrent loads of one key (single flight) and never stores a value whose
 * load began before an invalidation of that key/tag, so a read that starts
 * after a write always observes the write.
 *
 * Adapters: `InMemoryCache` below (per process; use TTL as the cross-instance
 * staleness bound) or a shared store such as Redis behind the same port.
 */
export interface CacheSetOptions {
  /** Time to live in milliseconds. */
  readonly ttlMs: number;
  /** Tags the entry can be invalidated by (e.g. `user:abc`). */
  readonly tags?: readonly string[];
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** Drops every entry carrying `tag` and fences loads that are in flight. */
  invalidateTag(tag: string): Promise<void>;
  /** Cached value, or `loader()` (coalesced across concurrent callers). */
  remember<T>(
    key: string,
    options: CacheSetOptions,
    loader: () => Promise<T>,
  ): Promise<T>;
}

/** Tag used for everything cached on behalf of one user. */
export const userCacheTag = (userId: UserId): string => `user:${userId}`;

export interface InMemoryCacheOptions {
  /** Maximum entries; least recently used are evicted first. Default 5,000. */
  readonly maxEntries?: number;
  /** Injected for tests. */
  readonly now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
  tags: readonly string[];
}

interface Flight {
  promise: Promise<unknown>;
  tags: readonly string[];
  /** Set by an invalidation that happened while loading: do not store. */
  fenced: boolean;
}

/** Per-process TTL + LRU cache with tag invalidation and single-flight loads. */
export class InMemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>(); // insertion order = recency
  private readonly byTag = new Map<string, Set<string>>();
  private readonly flights = new Map<string, Flight>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 5_000);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.read(key) as T | undefined;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    this.write(key, value, options);
  }

  async delete(key: string): Promise<void> {
    this.drop(key);
  }

  async invalidateTag(tag: string): Promise<void> {
    for (const key of [...(this.byTag.get(tag) ?? [])]) this.drop(key);
    this.byTag.delete(tag);
    for (const flight of this.flights.values()) {
      if (flight.tags.includes(tag)) flight.fenced = true;
    }
  }

  remember<T>(
    key: string,
    options: CacheSetOptions,
    loader: () => Promise<T>,
  ): Promise<T> {
    const hit = this.read(key);
    if (hit !== undefined) return Promise.resolve(hit as T);
    const inflight = this.flights.get(key);
    if (inflight && !inflight.fenced) return inflight.promise as Promise<T>;

    const flight: Flight = {
      tags: options.tags ?? [],
      fenced: false,
      promise: Promise.resolve(),
    };
    flight.promise = (async () => {
      try {
        const value = await loader();
        if (!flight.fenced) this.write(key, value, options);
        return value;
      } finally {
        if (this.flights.get(key) === flight) this.flights.delete(key);
      }
    })();
    this.flights.set(key, flight);
    return flight.promise as Promise<T>;
  }

  private read(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.drop(key);
      return undefined;
    }
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  private write(key: string, value: unknown, options: CacheSetOptions): void {
    if (options.ttlMs <= 0) return;
    this.drop(key);
    const tags = options.tags ?? [];
    this.entries.set(key, { value, expiresAt: this.now() + options.ttlMs, tags });
    for (const tag of tags) {
      let keys = this.byTag.get(tag);
      if (!keys) this.byTag.set(tag, (keys = new Set()));
      keys.add(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    for (const tag of entry.tags) {
      const keys = this.byTag.get(tag);
      keys?.delete(key);
      if (keys?.size === 0) this.byTag.delete(tag);
    }
  }
}

/** A cache that stores nothing (loads every time). Useful as a test double. */
export const noCache: Cache = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
  invalidateTag: async () => {},
  remember: (_key, _options, loader) => loader(),
};

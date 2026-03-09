/**
 * Cache Service
 * Simple in-memory cache with TTL support
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class CacheService {
  private cache = new Map<string, CacheEntry<any>>()

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  /**
   * Set cached value
   */
  async set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): Promise<void> {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    })
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache.clear()
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size
  }
}

// Export singleton instance
export const cacheService = new CacheService()

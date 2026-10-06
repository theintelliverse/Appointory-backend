// High-Performance In-Memory SSR Cache for Appointory
// Provides 5-minute caching with instant programmatic invalidation on clinic admin updates.

class SsrCache {
    constructor(maxEntries = 500, defaultTtlMs = 5 * 60 * 1000) {
        this.cache = new Map();
        this.maxEntries = maxEntries;
        this.defaultTtlMs = defaultTtlMs;
        this.sitemapLastMod = new Date();
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return item.value;
    }

    set(key, value, ttlMs = this.defaultTtlMs) {
        if (this.cache.size >= this.maxEntries) {
            // Evict oldest entry (first key in insertion order)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs
        });
    }

    del(key) {
        return this.cache.delete(key);
    }

    invalidateClinic(slug) {
        if (!slug) return;
        const normalized = String(slug).toLowerCase().trim();
        // Invalidate exact clinic keys
        this.cache.delete(`clinic:${normalized}`);
        this.cache.delete(`page:/c/${normalized}`);
        
        // Invalidate directory caches because listing/details might have changed
        for (const key of this.cache.keys()) {
            if (key.startsWith('dir:') || key.startsWith('page:/clinics') || key.startsWith('sitemap:')) {
                this.cache.delete(key);
            }
        }
        this.sitemapLastMod = new Date();
    }

    touchSitemap() {
        this.sitemapLastMod = new Date();
        this.cache.delete('sitemap:xml');
    }

    clear() {
        this.cache.clear();
        this.sitemapLastMod = new Date();
    }
}

const ssrCacheInstance = new SsrCache();

module.exports = ssrCacheInstance;

const stats = new Map();
function getOrInit(name) {
    let entry = stats.get(name);
    if (!entry) {
        entry = { cacheHits: 0, ao3Requests: 0, errors: 0 };
        stats.set(name, entry);
    }
    return entry;
}
export function recordCacheHit(name) {
    getOrInit(name).cacheHits++;
}
export function recordAo3Request(name) {
    getOrInit(name).ao3Requests++;
}
export function recordError(name) {
    getOrInit(name).errors++;
}
// Per-resource-type breakdown (work/series/user/chapter/content).
export function getCacheStatsByType() {
    return Object.fromEntries(stats);
}
// Single combined total across all resource types, for this shard.
export function getCacheStatsTotals() {
    const totals = { cacheHits: 0, ao3Requests: 0, errors: 0 };
    for (const entry of stats.values()) {
        totals.cacheHits += entry.cacheHits;
        totals.ao3Requests += entry.ao3Requests;
        totals.errors += entry.errors;
    }
    return totals;
}

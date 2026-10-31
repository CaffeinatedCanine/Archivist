import { getSeries, getUser, getWork, getWorkContent, setFetcher, } from "@fujocoded/ao3.js";
import { recordAo3Request, recordCacheHit, recordError } from "./cacheStats.js";
import { ao3Limiter } from "./ao3Limiter.js";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const THREE_HOURS_MS = 3 * HOUR_MS;
// Default cap per cache. When full, the least recently used entry is dropped.
const DEFAULT_MAX_ENTRIES = 2000;
// How often every cache drops expired entries that nobody asked for again.
const SWEEP_INTERVAL_MS = 10 * MINUTE_MS;
// Cooldown before a failed link is retried, so repeated posts of a broken
// link don't each trigger a fresh AO3 request.
const FAILURE_TTL_MS = 15 * 1000;
// Thrown instead of contacting AO3 while it's asked us to back off or our
// own queue is too long. Not the item's fault, so it doesn't start the
// per-item failure cooldown below.
export class Ao3BusyError extends Error {
    reason;
    constructor(reason = "overloaded") {
        super("AO3 is busy; not sending more requests for now.");
        this.reason = reason;
        this.name = "Ao3BusyError";
    }
}
// Thrown when getOrSet is still in the cooldown above.
export class RecentFailureError extends Error {
    constructor() {
        super("AO3 request recently failed for this item; try again in a bit.");
        this.name = "RecentFailureError";
    }
}
const allCaches = new Set();
// Map keeps insertion order, so the first key is always the least recently
// used one: get() re-inserts a hit at the end, and set() evicts from the front.
export class Cache {
    ttlMs;
    statsName;
    maxEntries;
    store = new Map();
    inFlight = new Map();
    failures = new Map();
    // statsName feeds /cachestats (utils/cacheStats.ts). Left unset for
    // internal caches like the raw-HTML fetch cache.
    constructor(ttlMs = HOUR_MS, statsName, maxEntries = DEFAULT_MAX_ENTRIES) {
        this.ttlMs = ttlMs;
        this.statsName = statsName;
        this.maxEntries = maxEntries;
        allCaches.add(this);
    }
    set(key, value) {
        this.store.delete(key);
        this.store.set(key, {
            data: value,
            expiresAt: Date.now() + this.ttlMs,
        });
        while (this.store.size > this.maxEntries) {
            const oldest = this.store.keys().next().value;
            this.store.delete(oldest);
        }
    }
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        // Moves the entry to the back of the eviction line. expiresAt is left
        // alone so popular works still get fresh stats from AO3 after the TTL.
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.data;
    }
    // Drops expired entries and finished failure cooldowns.
    sweep(now = Date.now()) {
        for (const [key, entry] of this.store) {
            if (now > entry.expiresAt)
                this.store.delete(key);
        }
        for (const [key, until] of this.failures) {
            if (now >= until)
                this.failures.delete(key);
        }
    }
    async getOrSet(key, loader) {
        const cached = this.get(key);
        if (cached !== null) {
            if (this.statsName)
                recordCacheHit(this.statsName);
            return cached;
        }
        const failedUntil = this.failures.get(key);
        if (failedUntil && Date.now() < failedUntil) {
            throw new RecentFailureError();
        }
        const pending = this.inFlight.get(key);
        if (pending)
            return pending;
        if (this.statsName)
            recordAo3Request(this.statsName);
        const promise = (async () => {
            try {
                const value = await loader();
                this.set(key, value);
                this.failures.delete(key);
                return value;
            }
            catch (error) {
                if (!(error instanceof Ao3BusyError)) {
                    this.failures.set(key, Date.now() + FAILURE_TTL_MS);
                    if (this.statsName)
                        recordError(this.statsName);
                }
                throw error;
            }
            finally {
                this.inFlight.delete(key);
            }
        })();
        this.inFlight.set(key, promise);
        return promise;
    }
    clear() {
        this.store.clear();
        this.inFlight.clear();
        this.failures.clear();
    }
}
// unref() so the timer never keeps the process alive on shutdown.
setInterval(() => {
    for (const cache of allCaches)
        cache.sweep();
}, SWEEP_INTERVAL_MS).unref();
export const workCache = new Cache(HOUR_MS, "work");
export const seriesCache = new Cache(HOUR_MS, "series");
export const fullSeriesCache = new Cache(HOUR_MS, "series");
export const workChapterCache = new Cache(HOUR_MS, "chapter");
export const workContentCache = new Cache(HOUR_MS, "content");
export const userCache = new Cache(THREE_HOURS_MS, "user");
// Retries a failed request with growing backoff (1.5s, then 3s).
async function withRetry(loader, attempts = 3, baseDelayMs = 1500) {
    for (let attempt = 1;; attempt++) {
        try {
            return await loader();
        }
        catch (error) {
            if (attempt >= attempts)
                throw error;
            // Retrying right away would only make a rate limit worse.
            if (error instanceof Ao3BusyError)
                throw error;
            await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
        }
    }
}
export async function cachedGetWork(workId) {
    return workCache.getOrSet(workId, () => getWork({ workId }));
}
// First page of a series only (up to 20 works). Fine for embeds, which just
// need the metadata. Use cachedGetFullSeries when you need every work.
export async function cachedGetSeries(seriesId) {
    return seriesCache.getOrSet(seriesId, async () => {
        const series = await getSeries({ seriesId });
        // Unlike getWork, ao3.js's series parser doesn't validate the page
        // actually parsed — an incomplete/broken AO3 response comes back as a
        // "successful" series with an empty name and no works instead of
        // throwing, which would otherwise get cached as good data for an hour.
        if (!series.name)
            throw new Error("Series name is empty — AO3 likely returned an incomplete page");
        return series;
    });
}
// Every work in a series, fetched page by page (AO3 shows 20 per page).
// Each page request takes its own ao3Limiter slot inside fetchAo3Text, so
// requests stay spaced out. Nobody may wrap AO3 calls in
// ao3Limiter.schedule themselves: with maxConcurrent: 1, the nested fetch
// would wait on the outer job forever.
export async function cachedGetFullSeries(seriesId) {
    return fullSeriesCache.getOrSet(seriesId, async () => {
        const first = await getSeries({ seriesId, page: 1 });
        if (!first.name)
            throw new Error("Series name is empty — AO3 likely returned an incomplete page");
        const works = [...first.works];
        for (let page = 2; page <= first.pages.total; page++) {
            const next = await getSeries({ seriesId, page });
            if (!next.works.length)
                break; // safety net against a bad/empty page
            works.push(...next.works);
        }
        return { ...first, works, pages: { total: first.pages.total, current: 1 } };
    });
}
export async function cachedGetUser(username) {
    return userCache.getOrSet(username, () => getUser({ username }));
}
function chapterCacheKey(workId, chapterId) {
    return `${workId}:${chapterId ?? "default"}`;
}
export async function cachedGetWorkChapter(workId, chapterId) {
    const key = chapterCacheKey(workId, chapterId);
    return workChapterCache.getOrSet(key, () => getWork({ workId, chapterId }));
}
export async function cachedGetWorkContent(workId, chapterId) {
    const key = chapterCacheKey(workId, chapterId);
    return workContentCache.getOrSet(key, () => getWorkContent({ workId, chapterId }));
}
// Shared raw-HTML cache for every ao3.js fetch, wired in via setFetcher
// below, so e.g. getWork and getWorkContent for the same page share one
// download. Kept short and small: pages can be large, and the parsed caches
// above already hold everything the bot needs for longer.
const rawHtmlCache = new Cache(10 * MINUTE_MS, undefined, 200);
// Browser-like headers reduce Cloudflare bot-detection challenges.
const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
};
// Caps how long a single fetch attempt can hang, so one slow request
// doesn't block ao3Limiter's whole queue.
const FETCH_TIMEOUT_MS = 30 * 1000;
// Requests already waiting beyond this many get turned away with
// Ao3BusyError. At one request per 2.5s that's roughly a 40s wait.
const MAX_QUEUED_REQUESTS = 15;
// AO3/Cloudflare statuses meaning "too much traffic, back off". 429 and 502
// mean AO3 is rate-limiting the bot (502 bad gateway is in practice AO3's
// usual rate-limit answer, rather than 429); 503 service unavailable and
// 529 site overloaded mean AO3 itself is overloaded.
const BACK_OFF_STATUSES = new Map([
    [429, "rateLimited"],
    [502, "rateLimited"],
    [503, "overloaded"],
    [529, "overloaded"],
]);
// When AO3 sends one of those without a usable Retry-After, pause this long.
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60 * 1000;
const MAX_RATE_LIMIT_PAUSE_MS = 10 * MINUTE_MS;
// While set, every request on this shard is refused without reaching AO3.
let ao3PausedUntil = 0;
let ao3PauseReason = "overloaded";
function pauseFromRetryAfter(header) {
    if (header) {
        const seconds = Number(header);
        const ms = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(header) - Date.now();
        if (Number.isFinite(ms) && ms > 0)
            return Math.min(ms, MAX_RATE_LIMIT_PAUSE_MS);
    }
    return DEFAULT_RATE_LIMIT_PAUSE_MS;
}
// The only place the bot talks to AO3. Each attempt waits its turn in
// ao3Limiter, so cache hits anywhere above never queue, and retry backoff
// happens outside the limiter instead of holding its slot.
export async function fetchAo3Text(url, cookie = "") {
    return withRetry(async () => {
        // RECEIVED counts jobs Bottleneck hasn't moved into its queue yet.
        const { RECEIVED, QUEUED } = ao3Limiter.counts();
        if (Date.now() < ao3PausedUntil)
            throw new Ao3BusyError(ao3PauseReason);
        if (RECEIVED + QUEUED >= MAX_QUEUED_REQUESTS)
            throw new Ao3BusyError("overloaded");
        return ao3Limiter.schedule(async () => {
            // A pause can start while this request was waiting in the queue.
            if (Date.now() < ao3PausedUntil)
                throw new Ao3BusyError(ao3PauseReason);
            const headers = cookie
                ? { ...BROWSER_HEADERS, Cookie: cookie }
                : BROWSER_HEADERS;
            let response;
            try {
                response = await fetch(url, {
                    headers,
                    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                });
            }
            catch (error) {
                if (error instanceof Error && error.name === "TimeoutError") {
                    throw new Error(`AO3 request timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${url}`, { cause: error });
                }
                throw error;
            }
            const backOffReason = BACK_OFF_STATUSES.get(response.status);
            if (backOffReason) {
                const pauseMs = pauseFromRetryAfter(response.headers.get("Retry-After"));
                ao3PausedUntil = Date.now() + pauseMs;
                ao3PauseReason = backOffReason;
                const what = backOffReason === "rateLimited" ? "rate-limited us" : "is overloaded";
                console.warn(`AO3 ${what} (HTTP ${response.status}); pausing requests for ${Math.round(pauseMs / 1000)}s`);
                throw new Ao3BusyError(backOffReason);
            }
            if (!response.ok) {
                throw new Error(`AO3 returned HTTP ${response.status} for ${url}`);
            }
            return response.text();
        });
    });
}
export async function cachedFetchText(url, cookie = "") {
    const key = `${url}::${cookie}`;
    // Retry happens inside fetchAo3Text, not around a caller, so it's a real
    // second network attempt rather than hitting this cache's own cooldown.
    return rawHtmlCache.getOrSet(key, () => fetchAo3Text(url, cookie));
}
setFetcher(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = init?.headers;
    const text = await cachedFetchText(url, headers?.Cookie ?? "");
    return new Response(text);
});

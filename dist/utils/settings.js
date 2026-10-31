import { blockedTags, chapterFieldSettings, guildSettings, seriesFieldSettings, userFieldSettings, workFieldSettings, } from "../db/schema.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
function emptyBundle(guildId) {
    return {
        guildId,
        guildSettingsId: null,
        guild: null,
        work: null,
        chapter: null,
        series: null,
        user: null,
        blockedTags: [],
    };
}
// Settings change rarely (an admin clicking through /settings) but are read
// on every single AO3 link posted, in every guild — caching avoids a burst
// of DB round-trips per link while still reflecting a change within a few
// seconds. Writes call invalidateBundle() so the admin who just changed
// something always sees it immediately, rather than waiting out the TTL.
const BUNDLE_TTL_MS = 30_000;
const bundleCache = new Map();
function invalidateBundle(guildId) {
    bundleCache.delete(guildId);
}
async function fetchBundle(guildId) {
    const guild = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, guildId),
    });
    if (!guild)
        return emptyBundle(guildId);
    const [work, chapter, series, user, tags] = await Promise.all([
        db.query.workFieldSettings.findFirst({
            where: eq(workFieldSettings.guildSettingsId, guild.id),
        }),
        db.query.chapterFieldSettings.findFirst({
            where: eq(chapterFieldSettings.guildSettingsId, guild.id),
        }),
        db.query.seriesFieldSettings.findFirst({
            where: eq(seriesFieldSettings.guildSettingsId, guild.id),
        }),
        db.query.userFieldSettings.findFirst({
            where: eq(userFieldSettings.guildSettingsId, guild.id),
        }),
        db.query.blockedTags.findMany({
            where: eq(blockedTags.guildSettingsId, guild.id),
        }),
    ]);
    return {
        guildId,
        guildSettingsId: guild.id,
        guild,
        work: work ?? null,
        chapter: chapter ?? null,
        series: series ?? null,
        user: user ?? null,
        blockedTags: tags.map((t) => t.tag),
    };
}
export async function getGuildSettingsBundle(guildId) {
    if (!guildId)
        return emptyBundle("");
    const cached = bundleCache.get(guildId);
    if (cached && cached.expiresAt > Date.now())
        return cached.data;
    const data = await fetchBundle(guildId);
    bundleCache.set(guildId, { data, expiresAt: Date.now() + BUNDLE_TTL_MS });
    return data;
}
// Ensures a guild_settings row exists and returns its id — the FK every
// other table hangs off of. Upsert rather than select-then-insert so two
// concurrent first-writes for the same guild (e.g. two links posted at once
// before either has a row yet) can't race into a duplicate-key error.
// Exported for redirects.ts, which needs the id but not any of the
// field-setting tables above.
export async function getOrCreateGuildSettingsId(guildId) {
    await db
        .insert(guildSettings)
        .values({ guildId })
        .onDuplicateKeyUpdate({ set: { guildId } });
    const row = await db.query.guildSettings.findFirst({
        where: eq(guildSettings.guildId, guildId),
    });
    if (!row)
        throw new Error(`Failed to create guild_settings row for guild ${guildId}`);
    return row.id;
}
export async function updateGuildSettings(guildId, values) {
    const id = await getOrCreateGuildSettingsId(guildId);
    await db.update(guildSettings).set(values).where(eq(guildSettings.id, id));
    invalidateBundle(guildId);
}
export async function updateWorkFieldSettings(guildId, values) {
    const guildSettingsId = await getOrCreateGuildSettingsId(guildId);
    await db
        .insert(workFieldSettings)
        .values({ guildSettingsId, ...values })
        .onDuplicateKeyUpdate({ set: values });
    invalidateBundle(guildId);
}
export async function updateChapterFieldSettings(guildId, values) {
    const guildSettingsId = await getOrCreateGuildSettingsId(guildId);
    await db
        .insert(chapterFieldSettings)
        .values({ guildSettingsId, ...values })
        .onDuplicateKeyUpdate({ set: values });
    invalidateBundle(guildId);
}
export async function updateSeriesFieldSettings(guildId, values) {
    const guildSettingsId = await getOrCreateGuildSettingsId(guildId);
    await db
        .insert(seriesFieldSettings)
        .values({ guildSettingsId, ...values })
        .onDuplicateKeyUpdate({ set: values });
    invalidateBundle(guildId);
}
export async function updateUserFieldSettings(guildId, values) {
    const guildSettingsId = await getOrCreateGuildSettingsId(guildId);
    await db
        .insert(userFieldSettings)
        .values({ guildSettingsId, ...values })
        .onDuplicateKeyUpdate({ set: values });
    invalidateBundle(guildId);
}
export async function replaceBlockedTags(guildId, tags) {
    const guildSettingsId = await getOrCreateGuildSettingsId(guildId);
    await db
        .delete(blockedTags)
        .where(eq(blockedTags.guildSettingsId, guildSettingsId));
    if (tags.length > 0) {
        await db
            .insert(blockedTags)
            .values(tags.map((tag) => ({ guildSettingsId, tag })));
    }
    invalidateBundle(guildId);
}
// Outage alerts: guilds that opted in and picked a channel.
export async function getGuildsWithOutageAlertsEnabled() {
    const rows = await db.query.guildSettings.findMany({
        where: and(eq(guildSettings.outageAlertsEnabled, true), isNotNull(guildSettings.outageAlertChannelId)),
        columns: { guildId: true, outageAlertChannelId: true },
    });
    return rows
        .filter((row) => row.outageAlertChannelId !== null)
        .map((row) => ({
        guildId: row.guildId,
        channelId: row.outageAlertChannelId,
    }));
}

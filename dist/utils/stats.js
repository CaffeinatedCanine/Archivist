import { Api } from "@top-gg/sdk";
import { postBotStats } from "discordbotlist";
const sum = (nums) => nums.reduce((a, b) => a + b, 0);
export async function collectStats(source) {
    const guildCounts = (await source.fetchClientValues("guilds.cache.size"));
    // Cast: the two sources have separate overloads, but identical behavior.
    const userCounts = (await source.broadcastEval((c) => c.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)));
    return {
        guilds: sum(guildCounts),
        users: sum(userCounts),
        shards: guildCounts.length,
    };
}
let topgg = null;
async function postToTopgg(stats) {
    const token = process.env.TOPGG_TOKEN;
    if (!token)
        return "skipped (no TOPGG_TOKEN)";
    topgg ??= new Api(token);
    await topgg.postMetrics({
        serverCount: stats.guilds,
        shardCount: stats.shards,
    });
    return "ok";
}
async function postToDiscordBotList(stats) {
    const token = process.env.DBL_TOKEN;
    const botId = process.env.CLIENT_ID;
    if (!token || !botId)
        return "skipped (no DBL_TOKEN/CLIENT_ID)";
    await postBotStats(token, botId, {
        guilds: stats.guilds,
        users: stats.users,
    });
    return "ok";
}
const targets = [
    { name: "top.gg", post: postToTopgg },
    { name: "discordbotlist", post: postToDiscordBotList },
];
export async function postStats(source, { dryRun = false } = {}) {
    const stats = await collectStats(source);
    if (dryRun) {
        console.log("[stats] dry run, not sending:", stats);
        return { stats, lines: ["dry run: nothing sent"] };
    }
    // allSettled so one site being down doesn't block the other.
    const settled = await Promise.allSettled(targets.map((t) => t.post(stats)));
    const lines = settled.map((r, i) => r.status === "fulfilled"
        ? `${targets[i].name}: ${r.value}`
        : `${targets[i].name}: failed (${r.reason?.message ?? r.reason})`);
    console.log("[stats] posted", stats, lines);
    return { stats, lines };
}

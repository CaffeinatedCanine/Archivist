var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Collection, ComponentType, Events, GatewayIntentBits, MessageFlags, } from "discord.js";
import { buildLegacyWorkEmbed, buildWorkEmbedComponents, buildWorkEmbedDefaultPayload, buildWorkEmbedPages, } from "./utils/embeds/worksEmbed.js";
import { buildUserEmbedComponents, buildUserEmbedDefaultPayload, buildUserEmbedPages, } from "./utils/embeds/userEmbed.js";
import { buildGalleryDefaultPayload, buildWorkGalleryComponents, buildWorkGalleryPage, } from "./utils/images.js";
import { cachedGetSeries, cachedGetWork } from "./utils/cache.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findDisallowedWarning, getGuildSettingsBundle, getIgnoreChar, isFieldEnabled, isRatingAllowed, shouldShowNsfwWarning, } from "./utils/embedFields.js";
import { getCacheStatsByType, getCacheStatsTotals, } from "./utils/cacheStats.js";
import { getSeriesIdFromUrl, getUsernameFromUrl, sendRedirectableEmbed, showTemporaryNotice, } from "./utils/urls.js";
import { ERROR_MESSAGE_LIFETIME_MS, getAo3FailureNotice, } from "./utils/messageCleanup.js";
import { authError } from "./utils/errors.js";
import { buildChapterEmbedComponents, buildChapterEmbedDefaultPayload, buildChapterEmbedPages, } from "./utils/embeds/chapterEmbed.js";
import dotenv from "dotenv";
import { findBlockedTag } from "./utils/restrictions.js";
import fs from "node:fs";
import { getBotCredentials } from "./utils/botEnv.js";
import { scheduleInactivityReset } from "./utils/inactivityReset.js";
import path from "node:path";
import { buildSeriesEmbedComponents, buildSeriesEmbedDefaultPayload, buildSeriesEmbedPages, } from "./utils/embeds/seriesEmbed.js";
import { getWorkDetailsFromUrl } from "@fujocoded/ao3.js/urls";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ quiet: true });
const { token } = getBotCredentials();
// Extends Client class to add Commands
export class ClientWithCommands extends Client {
    commands = new Collection();
    // Exposed so broadcastEval can pull this shard's cache stats
    // (mirrors the pattern about.ts uses for guild/user counts).
    getCacheStatsTotals = getCacheStatsTotals;
    getCacheStatsByType = getCacheStatsByType;
}
// Declares Intents
const client = new ClientWithCommands({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});
// Last-resort error handler — prevents an unhandled 'error' event from crashing the process.
client.on(Events.Error, (error) => {
    console.error("Discord client error:", error);
});
// Loads event listeners.
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.readdirSync(eventsPath).filter((file) => {
    console.log("Event Loaded:", file);
    return file.endsWith(".js");
});
for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const eventModule = await import(__rewriteRelativeImportExtension(pathToFileURL(filePath).href));
    const event = eventModule.default ?? eventModule;
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    }
    else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}
// Loads commands.
const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);
for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file) => file.endsWith(".js"));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const commandModule = await import(__rewriteRelativeImportExtension(pathToFileURL(filePath).href));
        const command = commandModule.default ?? commandModule;
        if ("data" in command && "execute" in command) {
            client.commands.set(command.data.name, { ...command, category: folder });
            console.log("Command Loaded:", file);
        }
        else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}
// TODO: Add support for respect masked links setting.
// Listens to message.
const BLOCKED_CONTENT_NOTICE_LIFETIME_MS = 10_000;
// Posts a work embed (legacy single-embed or new paginated Stats/Tags/Summary,
// per the guild's General setting) plus its gallery, redirecting either to a
// /redirect-configured destination if a rule matches this work's
// rating/fandoms. Shared by direct /works/ links and the "Work" choice on
// the chapter-link disambiguation prompt, so both get the same treatment.
async function postWorkLink(message, url) {
    const bundle = await getGuildSettingsBundle(message.guildId);
    const galleryEnabled = isFieldEnabled(bundle, "gallery", "enabled");
    const useLegacyEmbed = isFieldEnabled(bundle, "general", "legacyWorkEmbed");
    const waitingMsg = await message.channel.send("⏳ Fetching from AO3...");
    const galleryWaitingMsg = galleryEnabled
        ? await message.channel.send("⏳ Fetching gallery...")
        : null;
    const workId = getWorkDetailsFromUrl({ url }).workId;
    // Normalized to EmbedBuilder[] either way so downstream handling doesn't
    // need to branch on which embed style was built. Rating/tag restrictions
    // are checked first so a blocked work never gets its embed built at all.
    // AO3 rate limiting happens per request inside utils/cache.ts, so cache
    // hits here return right away instead of waiting in the queue.
    const workTask = (async () => {
        const work = await cachedGetWork(workId);
        if (!work.locked) {
            if (!isRatingAllowed(bundle, work.rating)) {
                return {
                    blocked: true,
                    reason: `Links to **${work.rating}** works aren't allowed in this server.`,
                };
            }
            const blockedTag = findBlockedTag(bundle, work.tags?.additional);
            if (blockedTag) {
                return {
                    blocked: true,
                    reason: `This work is tagged "${blockedTag}", which is blocked in this server.`,
                };
            }
            const blockedWarning = findDisallowedWarning(bundle, work.tags?.warnings);
            if (blockedWarning) {
                return {
                    blocked: true,
                    reason: `This work has the "${blockedWarning}" warning, which is blocked in this server.`,
                };
            }
        }
        if (!useLegacyEmbed)
            return buildWorkEmbedPages(url, message.guildId);
        const result = await buildLegacyWorkEmbed(url, message.guildId);
        return "locked" in result ? result : [result];
    })();
    // Starts right after the work embed is built, without waiting for message
    // edits in between, and is skipped if the work turned out blocked/locked.
    const galleryTask = galleryEnabled
        ? workTask.then(async (result) => {
            if ("blocked" in result || "locked" in result)
                return null;
            const work = await cachedGetWork(workId);
            const nsfwWarning = work.locked
                ? false
                : shouldShowNsfwWarning(bundle, work.rating, work.locked);
            return buildWorkGalleryPage(workId, url, 0, { nsfwWarning });
        }, () => null) // the work embed's own .catch below reports the failure
        : null;
    workTask
        .then(async (result) => {
        if (result && "blocked" in result) {
            await showTemporaryNotice(waitingMsg, `🚫 ${result.reason}`, BLOCKED_CONTENT_NOTICE_LIFETIME_MS);
            await galleryWaitingMsg?.delete().catch(() => { });
            return;
        }
        if (result && "locked" in result) {
            await waitingMsg.edit(authError);
            await galleryWaitingMsg?.delete().catch(() => { });
            return;
        }
        const embeds = [result[0]];
        const components = result.length > 1
            ? buildWorkEmbedComponents(message.author.id, 0, result.length, workId)
            : [];
        const work = await cachedGetWork(workId);
        const { message: sentMessage } = await sendRedirectableEmbed(message, { embeds, components }, {
            rating: work.locked ? undefined : work.rating,
            fandoms: work.locked ? undefined : work.fandoms,
            type: "work",
        }, waitingMsg);
        // Legacy embed mode has no tabs/pages to reset to.
        if (!useLegacyEmbed) {
            scheduleInactivityReset(sentMessage, () => buildWorkEmbedDefaultPayload(url, message.guildId, message.author.id));
        }
    })
        .catch(async (error) => {
        console.error(`Failed to build work embed for ${url}`, error);
        await showTemporaryNotice(waitingMsg, getAo3FailureNotice(error), ERROR_MESSAGE_LIFETIME_MS).catch(() => { });
        await galleryWaitingMsg?.delete().catch(() => { });
    });
    galleryTask
        ?.then(async (result) => {
        if (!result) {
            await galleryWaitingMsg?.delete().catch(() => { });
            return;
        }
        const work = await cachedGetWork(workId);
        const { message: sentMessage } = await sendRedirectableEmbed(message, {
            embeds: result.page.embeds,
            files: result.page.files,
            components: result.totalPages > 1
                ? buildWorkGalleryComponents(message.author.id, 0, result.totalPages, workId)
                : [],
        }, {
            rating: work.locked ? undefined : work.rating,
            fandoms: work.locked ? undefined : work.fandoms,
            type: "work",
        }, galleryWaitingMsg);
        scheduleInactivityReset(sentMessage, () => buildGalleryDefaultPayload(workId, message.guildId, message.author.id));
    })
        .catch(async (error) => {
        console.error(`Failed to build gallery for ${url}`, error);
        await galleryWaitingMsg?.delete().catch(() => { });
    });
}
client.on(Events.MessageCreate, async (message) => {
    try {
        await handleMessageCreate(message);
    }
    catch (error) {
        // Prevents one bad message from crashing the whole shard.
        console.error("Error handling message:", error);
    }
});
async function handleMessageCreate(message) {
    // Tells bot to ignore messages from other bots.
    if (message.author.bot)
        return;
    // Regex used to identify if AO3 links are in the message.
    const ao3Links = /https?:\/\/(?:www\.)?(?:archiveofourown\.org|ao3\.org)\/\S+/g;
    // Strips the ">" Discord uses around a suppressed link preview before
    // matching. Bail out before touching the DB if there's nothing to match
    // at all — most messages in a chatty server have no AO3 link in them.
    const content = message.content.replaceAll(">", "");
    const rawMatches = [...content.matchAll(ao3Links)];
    if (rawMatches.length === 0)
        return;
    // Drops any link immediately preceded by the guild's configured ignore
    // character (default "%", e.g. "%https://...") — needs matchAll's
    // per-match index rather than a plain .match(), since that only returns
    // the matched URL text with no way to see what precedes it.
    const bundle = await getGuildSettingsBundle(message.guildId);
    const ignoreChar = getIgnoreChar(bundle);
    const urls = rawMatches
        .filter((match) => !ignoreChar || content[match.index - 1] !== ignoreChar)
        .map((match) => match[0]);
    if (urls.length > 0) {
        // * Identifies what type of AO3 links are in message and responds.
        for (const url of urls) {
            // For works link that does not contain chapter information:
            if (url.includes("/works/") && !url.includes("/chapters/")) {
                await postWorkLink(message, url);
                continue;
            }
            if (url.includes("/users/")) {
                const waitingMsg = await message.channel.send("⏳ Fetching from AO3...");
                try {
                    const username = getUsernameFromUrl(url);
                    const pages = await buildUserEmbedPages(username, message.guildId);
                    const { message: sentMessage } = await sendRedirectableEmbed(message, {
                        embeds: [pages[0]],
                        components: pages.length > 1
                            ? buildUserEmbedComponents(message.author.id, 0, pages.length, username)
                            : [],
                    }, { type: "user" }, waitingMsg);
                    scheduleInactivityReset(sentMessage, () => buildUserEmbedDefaultPayload(username, message.guildId, message.author.id));
                }
                catch (error) {
                    console.error(`Failed to build user embed for ${url}`);
                    console.error(error);
                    await showTemporaryNotice(waitingMsg, getAo3FailureNotice(error), ERROR_MESSAGE_LIFETIME_MS).catch(() => { });
                }
                continue;
            }
            if (url.includes("/series/")) {
                const waitingMsg = await message.channel.send("⏳ Fetching from AO3...");
                try {
                    const seriesId = getSeriesIdFromUrl(url);
                    const [result, series] = await Promise.all([
                        buildSeriesEmbedPages(url, message.guildId),
                        cachedGetSeries(seriesId),
                    ]);
                    const fandoms = [...new Set(series.works.flatMap((w) => w.fandoms))];
                    const components = result.pages.length > 1
                        ? buildSeriesEmbedComponents(message.author.id, 0, result.notesPageCount, result.descriptionPageCount, seriesId)
                        : [];
                    const { message: sentMessage } = await sendRedirectableEmbed(message, { embeds: [result.pages[0]], components }, { fandoms, type: "series" }, waitingMsg);
                    scheduleInactivityReset(sentMessage, () => buildSeriesEmbedDefaultPayload(url, message.guildId, message.author.id));
                }
                catch (error) {
                    console.error(`Failed to build series embed for ${url}`, error);
                    await showTemporaryNotice(waitingMsg, getAo3FailureNotice(error), ERROR_MESSAGE_LIFETIME_MS).catch(() => { });
                }
                continue;
            }
            if (url.includes("/chapters/")) {
                await handleChapterLink(message, url);
                continue;
            }
        }
        // Deleted after processing (not before), so it only disappears once the
        // bot has actually registered/responded to every link in the message —
        // and only when there was an actual (non-ignored) link to respond to,
        // not for every message in the channel.
        if (isFieldEnabled(bundle, "general", "deleteOriginalMessage")) {
            await message.delete().catch((error) => {
                // 10008 = Unknown Message, i.e. it's already gone. Not a permissions issue.
                if (error?.code === 10008)
                    return;
                console.error(`Failed to delete original message ${message.id} in channel ${message.channelId} — likely missing "Manage Messages" permission there.`, error);
            });
        }
    }
}
async function handleChapterLink(message, url) {
    const question = "Would you like a work or chapter embed?";
    const workButton = new ButtonBuilder()
        .setCustomId("work")
        .setLabel("Work")
        .setStyle(ButtonStyle.Secondary);
    const chapterButton = new ButtonBuilder()
        .setCustomId("chapter")
        .setLabel("Chapter")
        .setStyle(ButtonStyle.Secondary);
    const buttons = new ActionRowBuilder().addComponents(workButton, chapterButton);
    const botReply = await message.channel.send({
        content: question,
        components: [buttons],
    });
    const collector = botReply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15_000,
    });
    collector.on("collect", async (buttonInteraction) => {
        try {
            await handleWorkOrChapterChoice(buttonInteraction, message, url, botReply);
        }
        catch (error) {
            console.error(`Failed to handle work/chapter choice for ${url}`, error);
        }
    });
    collector.on("end", (collected) => {
        console.log(`Collected ${collected.size} interactions.`);
        // Nobody clicked in time — clean up instead of leaving dead buttons.
        if (collected.size === 0) {
            botReply.delete().catch(() => { });
        }
    });
}
async function handleWorkOrChapterChoice(buttonInteraction, message, url, botReply) {
    if (buttonInteraction.user.id !== message.author.id) {
        await buttonInteraction.reply({
            content: "These buttons aren't for you!",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    botReply.delete();
    if (buttonInteraction.customId === "work") {
        await postWorkLink(message, url);
        return;
    }
    if (buttonInteraction.customId === "chapter") {
        const waitingMsg = await message.channel.send("⏳ Fetching from AO3...");
        try {
            const workId = getWorkDetailsFromUrl({ url }).workId;
            const work = await cachedGetWork(workId);
            const bundle = await getGuildSettingsBundle(message.guildId);
            if (!work.locked) {
                if (!isRatingAllowed(bundle, work.rating)) {
                    await showTemporaryNotice(waitingMsg, `🚫 Links to **${work.rating}** works aren't allowed in this server.`, BLOCKED_CONTENT_NOTICE_LIFETIME_MS);
                    return;
                }
                const blockedTag = findBlockedTag(bundle, work.tags?.additional);
                if (blockedTag) {
                    await showTemporaryNotice(waitingMsg, `🚫 This work is tagged "${blockedTag}", which is blocked in this server.`, BLOCKED_CONTENT_NOTICE_LIFETIME_MS);
                    return;
                }
                const blockedWarning = findDisallowedWarning(bundle, work.tags?.warnings);
                if (blockedWarning) {
                    await showTemporaryNotice(waitingMsg, `🚫 This work has the "${blockedWarning}" warning, which is blocked in this server.`, BLOCKED_CONTENT_NOTICE_LIFETIME_MS);
                    return;
                }
            }
            const result = await buildChapterEmbedPages(url, message.guildId);
            if ("locked" in result) {
                await waitingMsg.edit(authError);
                return;
            }
            // Always present — this branch only runs for /chapters/ URLs (see handleChapterLink).
            const chapterId = getWorkDetailsFromUrl({ url }).chapterId;
            const components = result.pages.length > 1
                ? buildChapterEmbedComponents(message.author.id, 0, result.tagsPageCount, result.contentPageCount, result.contentTabLabel, workId, chapterId)
                : [];
            const { message: sentMessage } = await sendRedirectableEmbed(message, { embeds: [result.pages[0]], components }, {
                rating: work.locked ? undefined : work.rating,
                fandoms: work.locked ? undefined : work.fandoms,
                type: "chapter",
            }, waitingMsg);
            scheduleInactivityReset(sentMessage, () => buildChapterEmbedDefaultPayload(url, message.guildId, message.author.id));
        }
        catch (error) {
            console.error(`Failed to build chapter embed for ${url}`);
            console.error(error);
            await showTemporaryNotice(waitingMsg, getAo3FailureNotice(error), ERROR_MESSAGE_LIFETIME_MS).catch(() => { });
        }
    }
}
// Login to Discord and start bot.
client.login(token);

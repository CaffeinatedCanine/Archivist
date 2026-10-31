import { ActivityType, Events } from "discord.js";
import { loadEmojis } from "../utils/emojis.js";
import { startOutageMonitor } from "../utils/otwStatus.js";
export const name = Events.ClientReady;
export const once = true;
export const execute = async (client) => {
    await loadEmojis(client);
    client.user?.setPresence({
        activities: [{ name: `archivistbot.com`, type: ActivityType.Watching }],
        status: "online",
    });
    startOutageMonitor(client);
    console.log(`Ready! Logged in as ${client.user?.tag}`);
};

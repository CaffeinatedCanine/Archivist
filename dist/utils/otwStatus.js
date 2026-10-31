import { ao3Embed } from "./baseEmbed.js";
import { getGuildsWithOutageAlertsEnabled } from "./settings.js";
// AO3 outage monitor — polls otwstatus.org's public Statuspage API.
const INCIDENTS_API_URL = "https://www.otwstatus.org/api/v2/incidents.json";
const COMPONENTS_API_URL = "https://www.otwstatus.org/api/v2/components.json";
const AO3_COMPONENT_NAME = "Archive of Our Own";
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const GENERIC_STATUS_LABELS = {
    operational: "Operational",
    degraded_performance: "Degraded Performance",
    partial_outage: "Partial Outage",
    major_outage: "Major Outage",
    under_maintenance: "Under Maintenance",
};
const GENERIC_STATUS_COLORS = {
    operational: 0x2ecc71,
    degraded_performance: 0xf1c40f,
    partial_outage: 0xe67e22,
    major_outage: 0xe74c3c,
    under_maintenance: 0x3498db,
};
const UPDATE_STATUS_LABELS = {
    investigating: "Investigating",
    identified: "Identified",
    monitoring: "Monitoring",
    resolved: "Resolved",
    postmortem: "Postmortem",
};
const UPDATE_STATUS_COLORS = {
    investigating: 0xe74c3c,
    identified: 0xe67e22,
    monitoring: 0xf1c40f,
    resolved: 0x2ecc71,
    postmortem: 0x3498db,
};
let consecutiveFailures = 0;
// Fetches JSON with a timeout and one retry. Only the first failure in a streak is logged.
async function fetchJson(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            consecutiveFailures = 0;
            return (await response.json());
        }
        catch (error) {
            if (attempt === 1) {
                if (consecutiveFailures++ === 0) {
                    console.error(`otwstatus.org fetch failed (${url})`, error?.cause ?? error);
                }
                return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
    return null;
}
async function fetchAo3Incidents() {
    const data = await fetchJson(INCIDENTS_API_URL);
    if (!data)
        return null;
    return data.incidents.filter((incident) => incident.components.some((component) => component.name === AO3_COMPONENT_NAME));
}
function buildIncidentUpdateEmbed(incident, update) {
    const label = UPDATE_STATUS_LABELS[update.status] ?? update.status;
    const color = UPDATE_STATUS_COLORS[update.status] ?? 0x2f3136;
    const isResolved = update.status === "resolved";
    return ao3Embed(color)
        .setTitle(`${isResolved ? "✅" : "⚠️"} ${incident.name} — ${label}`)
        .setURL(incident.shortlink)
        .setDescription(update.body);
}
async function fetchAo3ComponentStatus() {
    const data = await fetchJson(COMPONENTS_API_URL);
    if (!data)
        return null;
    return (data.components.find((component) => component.name === AO3_COMPONENT_NAME)
        ?.status ?? null);
}
// Fallback notice for a status change with no published incident.
function buildGenericStatusEmbed(status) {
    const label = GENERIC_STATUS_LABELS[status] ?? status;
    const color = GENERIC_STATUS_COLORS[status] ?? 0x2f3136;
    const isRecovered = status === "operational";
    return ao3Embed(color)
        .setTitle(isRecovered ? "✅ AO3 is back to normal" : `⚠️ AO3 status: ${label}`)
        .setURL("https://www.otwstatus.org/")
        .setDescription((isRecovered
        ? "Archive of Our Own's status has returned to **Operational**."
        : `Archive of Our Own's status changed to **${label}**.`) +
        "\n\n*No incident was published for this change — this is a fallback notice.*");
}
// Already-posted incident update IDs, per incident.
const postedUpdateIds = new Map();
let lastKnownComponentStatus = null;
let hasSeededInitialState = false;
async function pollAndNotify(client) {
    const [incidents, componentStatus] = await Promise.all([
        fetchAo3Incidents(),
        fetchAo3ComponentStatus(),
    ]);
    if (!incidents || !componentStatus)
        return;
    if (!hasSeededInitialState) {
        for (const incident of incidents) {
            postedUpdateIds.set(incident.id, new Set(incident.incident_updates.map((update) => update.id)));
        }
        lastKnownComponentStatus = componentStatus;
        hasSeededInitialState = true;
        return;
    }
    const newUpdates = [];
    for (const incident of incidents) {
        const seen = postedUpdateIds.get(incident.id) ?? new Set();
        // Post oldest-to-newest.
        for (const update of [...incident.incident_updates].reverse()) {
            if (seen.has(update.id))
                continue;
            seen.add(update.id);
            newUpdates.push({ incident, update });
        }
        postedUpdateIds.set(incident.id, seen);
    }
    // Status changed but no incident update covers it — use the fallback.
    const statusChangedWithoutIncident = componentStatus !== lastKnownComponentStatus && newUpdates.length === 0;
    const genericStatus = componentStatus;
    lastKnownComponentStatus = componentStatus;
    if (newUpdates.length === 0 && !statusChangedWithoutIncident)
        return;
    const targets = await getGuildsWithOutageAlertsEnabled();
    if (targets.length === 0)
        return;
    const embedsToSend = newUpdates.map(({ incident, update }) => {
        console.log(`AO3 incident update: "${incident.name}" -> ${update.status}`);
        return buildIncidentUpdateEmbed(incident, update);
    });
    if (statusChangedWithoutIncident) {
        console.log(`AO3 status changed with no incident published: -> ${genericStatus}`);
        embedsToSend.push(buildGenericStatusEmbed(genericStatus));
    }
    for (const embed of embedsToSend) {
        for (const { guildId, channelId } of targets) {
            // Skip guilds this shard doesn't own.
            const guild = client.guilds.cache.get(guildId);
            if (!guild)
                continue;
            const channel = guild.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased())
                continue;
            await channel.send({ embeds: [embed] }).catch((error) => {
                console.error(`Failed to send outage alert to guild ${guildId} channel ${channelId}`, error);
            });
        }
    }
}
export function startOutageMonitor(client) {
    pollAndNotify(client).catch((error) => console.error("Initial outage status poll failed", error));
    setInterval(() => {
        pollAndNotify(client).catch((error) => console.error("Outage status poll failed", error));
    }, POLL_INTERVAL_MS);
}

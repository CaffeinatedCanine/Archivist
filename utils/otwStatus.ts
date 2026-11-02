import type { Client, EmbedBuilder } from "discord.js";

import { ao3Embed } from "./baseEmbed.ts";
import { getGuildsWithOutageAlertsEnabled } from "./settings.ts";

// AO3 outage monitor — polls otwstatus.org's public Statuspage API.
const INCIDENTS_API_URL = "https://www.otwstatus.org/api/v2/incidents.json";
const COMPONENTS_API_URL = "https://www.otwstatus.org/api/v2/components.json";
const AO3_COMPONENT_NAME = "Archive of Our Own";
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const DB_TIMEOUT_MS = 15_000;

const GENERIC_STATUS_LABELS: Record<string, string> = {
  operational: "Operational",
  degraded_performance: "Degraded Performance",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
  under_maintenance: "Under Maintenance",
};

const GENERIC_STATUS_COLORS: Record<string, number> = {
  operational: 0x2ecc71,
  degraded_performance: 0xf1c40f,
  partial_outage: 0xe67e22,
  major_outage: 0xe74c3c,
  under_maintenance: 0x3498db,
};

const UPDATE_STATUS_LABELS: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
  postmortem: "Postmortem",
};

const UPDATE_STATUS_COLORS: Record<string, number> = {
  investigating: 0xe74c3c,
  identified: 0xe67e22,
  monitoring: 0xf1c40f,
  resolved: 0x2ecc71,
  postmortem: 0x3498db,
};

interface AffectedComponent {
  name: string;
}

interface IncidentUpdate {
  id: string;
  status: string;
  body: string;
  affected_components?: AffectedComponent[];
}

interface Incident {
  id: string;
  name: string;
  shortlink: string;
  components: AffectedComponent[];
  incident_updates: IncidentUpdate[];
}

let consecutiveFailures = 0;

// Fetches JSON with a timeout and one retry. Only the first failure in a streak is logged.
async function fetchJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      consecutiveFailures = 0;
      return (await response.json()) as T;
    } catch (error) {
      if (attempt === 1) {
        if (consecutiveFailures++ === 0) {
          console.error(
            `otwstatus.org fetch failed (${url})`,
            (error as any)?.cause ?? error,
          );
        }
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return null;
}

async function fetchAo3Incidents(): Promise<Incident[] | null> {
  const data = await fetchJson<{ incidents: Incident[] }>(INCIDENTS_API_URL);
  if (!data) return null;
  return data.incidents.filter((incident) =>
    incident.components.some(
      (component) => component.name === AO3_COMPONENT_NAME,
    ),
  );
}

function buildIncidentUpdateEmbed(
  incident: Incident,
  update: IncidentUpdate,
): EmbedBuilder {
  const label = UPDATE_STATUS_LABELS[update.status] ?? update.status;
  const color = UPDATE_STATUS_COLORS[update.status] ?? 0x2f3136;
  const isResolved = update.status === "resolved";

  return ao3Embed(color)
    .setTitle(`${isResolved ? "✅" : "⚠️"} ${incident.name} — ${label}`)
    .setURL(incident.shortlink)
    .setDescription(update.body);
}

async function fetchAo3ComponentStatus(): Promise<string | null> {
  const data = await fetchJson<{
    components: { name: string; status: string }[];
  }>(COMPONENTS_API_URL);
  if (!data) return null;
  return (
    data.components.find((component) => component.name === AO3_COMPONENT_NAME)
      ?.status ?? null
  );
}

// Fallback notice for a status change with no published incident.
function buildGenericStatusEmbed(status: string): EmbedBuilder {
  const label = GENERIC_STATUS_LABELS[status] ?? status;
  const color = GENERIC_STATUS_COLORS[status] ?? 0x2f3136;
  const isRecovered = status === "operational";

  return ao3Embed(color)
    .setTitle(
      isRecovered ? "✅ AO3 is back to normal" : `⚠️ AO3 status: ${label}`,
    )
    .setURL("https://www.otwstatus.org/")
    .setDescription(
      (isRecovered
        ? "Archive of Our Own's status has returned to **Operational**."
        : `Archive of Our Own's status changed to **${label}**.`) +
        "\n\n*No incident was published for this change — this is a fallback notice.*",
    );
}

// Already-posted incident update IDs, per incident.
const postedUpdateIds = new Map<string, Set<string>>();
let lastKnownComponentStatus: string | null = null;
let hasSeededInitialState = false;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function pollAndNotify(client: Client): Promise<void> {
  const [incidents, componentStatus] = await Promise.all([
    fetchAo3Incidents(),
    fetchAo3ComponentStatus(),
  ]);
  if (!incidents || !componentStatus) return;

  if (!hasSeededInitialState) {
    for (const incident of incidents) {
      postedUpdateIds.set(
        incident.id,
        new Set(incident.incident_updates.map((update) => update.id)),
      );
    }
    lastKnownComponentStatus = componentStatus;
    hasSeededInitialState = true;
    return;
  }

  const newUpdates: { incident: Incident; update: IncidentUpdate }[] = [];

  for (const incident of incidents) {
    const seen = postedUpdateIds.get(incident.id);
    // Post oldest-to-newest.
    for (const update of [...incident.incident_updates].reverse()) {
      if (!seen?.has(update.id)) newUpdates.push({ incident, update });
    }
  }

  // Status changed but no incident update covers it — use the fallback.
  const statusChangedWithoutIncident =
    componentStatus !== lastKnownComponentStatus && newUpdates.length === 0;

  if (newUpdates.length === 0 && !statusChangedWithoutIncident) return;

  // A hung or failed lookup throws here, before anything is marked as posted, so the next poll retries.
  const targets = await withTimeout(
    getGuildsWithOutageAlertsEnabled(),
    DB_TIMEOUT_MS,
    "Outage alert guild lookup",
  );

  if (targets.length > 0) {
    const embedsToSend: EmbedBuilder[] = newUpdates.map(
      ({ incident, update }) => {
        console.log(
          `AO3 incident update: "${incident.name}" -> ${update.status}`,
        );
        return buildIncidentUpdateEmbed(incident, update);
      },
    );

    if (statusChangedWithoutIncident) {
      console.log(
        `AO3 status changed with no incident published: -> ${componentStatus}`,
      );
      embedsToSend.push(buildGenericStatusEmbed(componentStatus));
    }

    for (const embed of embedsToSend) {
      for (const { guildId, channelId } of targets) {
        // Skip guilds this shard doesn't own.
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const channel = guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased()) continue;

        await channel.send({ embeds: [embed] }).catch((error) => {
          console.error(
            `Failed to send outage alert to guild ${guildId} channel ${channelId}`,
            error,
          );
        });
      }
    }
  }

  // Mark as posted only once sending is done.
  for (const { incident, update } of newUpdates) {
    const seen = postedUpdateIds.get(incident.id) ?? new Set<string>();
    seen.add(update.id);
    postedUpdateIds.set(incident.id, seen);
  }
  lastKnownComponentStatus = componentStatus;
}

let isPolling = false;

// Skips a tick while the previous poll is still running, so slow polls can't pile up.
async function pollSafely(client: Client, errorLabel: string): Promise<void> {
  if (isPolling) return;
  isPolling = true;
  try {
    await pollAndNotify(client);
  } catch (error) {
    console.error(errorLabel, error);
  } finally {
    isPolling = false;
  }
}

export function startOutageMonitor(client: Client): void {
  void pollSafely(client, "Initial outage status poll failed");
  setInterval(
    () => void pollSafely(client, "Outage status poll failed"),
    POLL_INTERVAL_MS,
  );
}

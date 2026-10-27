import { Ao3BusyError, RecentFailureError } from "./cache.ts";

// How long an error notice stays before it's auto-deleted.
export const ERROR_MESSAGE_LIFETIME_MS = 20 * 1000;

const GENERIC_AO3_FAILURE_NOTICE =
  "⚠️ Something went wrong fetching that from AO3.";
const RECENT_FAILURE_NOTICE =
  "⏳ AO3 just failed to load this a moment ago and hasn't had time to recover yet — try again in a few seconds.";

const AO3_RATE_LIMITED_NOTICE =
  "🐢 AO3 has asked me to slow down for a bit. Please try again in a minute or two!";

const AO3_BUSY_NOTICE =
  "🐢 AO3 is getting a lot of traffic right now, so I'm giving it a short break. Please try again in a minute or two!";

// Fresh failure vs. still-in-cooldown from a moments-ago attempt vs. AO3
// (or our own queue) being too busy to take the request at all.
export function getAo3FailureNotice(error: unknown): string {
  if (error instanceof Ao3BusyError) {
    return error.reason === "rateLimited"
      ? AO3_RATE_LIMITED_NOTICE
      : AO3_BUSY_NOTICE;
  }
  return error instanceof RecentFailureError
    ? RECENT_FAILURE_NOTICE
    : GENERIC_AO3_FAILURE_NOTICE;
}

const GENERIC_COMMAND_FAILURE_NOTICE =
  "⚠️ Something went wrong running that command.";

// AO3 failures get the AO3-specific notices above; anything else (a bug,
// a Discord or database error) gets a neutral message.
export function getCommandFailureNotice(error: unknown): string {
  const fromAo3 =
    error instanceof Ao3BusyError ||
    error instanceof RecentFailureError ||
    (error instanceof Error &&
      (error.name === "ArchivePageRequestError" ||
        error.message.startsWith("AO3 ")));
  return fromAo3 ? getAo3FailureNotice(error) : GENERIC_COMMAND_FAILURE_NOTICE;
}

interface DeletableMessage {
  delete: () => Promise<unknown>;
}

// Deletes an already-sent message after a delay.
export function scheduleMessageDeletion(
  message: DeletableMessage | null | undefined,
  delayMs: number = ERROR_MESSAGE_LIFETIME_MS,
): void {
  if (!message) return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delayMs);
}

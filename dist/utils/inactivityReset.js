// Inactivity auto-reset: resets a paginated message to its default page
// after 5 minutes with no clicks. Owner messages only.
const RESET_DELAY_MS = 5 * 60 * 1000;
const pendingResets = new Map();
export function scheduleInactivityReset(message, buildDefaultPayload) {
    const existing = pendingResets.get(message.id);
    if (existing)
        clearTimeout(existing);
    const timer = setTimeout(async () => {
        pendingResets.delete(message.id);
        try {
            const payload = await buildDefaultPayload();
            if (!payload)
                return;
            await message.edit(payload);
        }
        catch (error) {
            console.error(`Failed to reset message ${message.id} to its default page`, error);
        }
    }, RESET_DELAY_MS);
    pendingResets.set(message.id, timer);
}

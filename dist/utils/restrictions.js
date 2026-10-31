import { replaceBlockedTags } from "./settings.js";
export function getBlockedTags(bundle) {
    return bundle.blockedTags;
}
export async function setBlockedTags(guildId, tags) {
    await replaceBlockedTags(guildId, tags);
}
// Returns the matching work tag if the work should be blocked, else null.
// Substring match (case-insensitive) so blocking "Character Death" also
// catches variants like "Original Character Death(s)".
export function findBlockedTag(bundle, workTags) {
    const blocked = bundle.blockedTags;
    if (blocked.length === 0 || !workTags?.length)
        return null;
    for (const workTag of workTags) {
        const match = blocked.find((b) => workTag.toLowerCase().includes(b.toLowerCase()));
        if (match)
            return workTag;
    }
    return null;
}

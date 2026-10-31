function formatTagList(work, field) {
    if (work?.locked)
        return "";
    return field?.length ? field.join(", ") : "N/A";
}
export const shipCategories = (work) => formatTagList(work, work?.category);
export const formatFandoms = (work) => formatTagList(work, work?.fandoms);
export const formatWarnings = (work) => formatTagList(work, work?.tags?.warnings);
export const formatCharacters = (work) => formatTagList(work, work?.tags?.characters);
export const formatRelationships = (work) => formatTagList(work, work?.tags?.relationships);
export const formatTags = (work) => formatTagList(work, work?.tags?.additional);

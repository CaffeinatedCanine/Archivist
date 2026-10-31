import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
dayjs.extend(localizedFormat);
export function publishedDate(work) {
    if (work.locked)
        return "";
    return dayjs(work.publishedAt).format("ll");
}
export function startedDate(series) {
    return dayjs(series.startedAt).format("ll");
}
export function updatedAt(item) {
    if (!item || item.locked)
        return "";
    return item.updatedAt ? dayjs(item.updatedAt).format("ll") : "N/A";
}
export function chapterDisplay(work) {
    if (work.locked)
        return "";
    const { published, total } = work.chapters;
    return total == null ? `${published}/?` : `${published}/${total}`;
}
export function formatCompletionStatus(item) {
    if (!item || item.locked)
        return "";
    if (item.complete === true)
        return "Complete";
    if (item.complete === false)
        return "Work in Progress";
    return "";
}

import { htmlToMarkdown } from "./htmlToMarkdown.js";
export function formatWorkSeries(work) {
    if (work?.locked || !work?.series?.length)
        return "";
    const formattedSeries = work.series.map(({ id, name }) => `[${name}](https://archiveofourown.org/series/${id})`);
    return `**Series:** ${formattedSeries.join(", ")}`;
}
export function formatWorkSummary(work) {
    if (work?.locked || !work)
        return "";
    const summary = htmlToMarkdown(work.summary?.trim());
    return summary || "N/A";
}
export function formatWorkStartNotes(work) {
    if (work?.locked || !work)
        return "";
    const notes = htmlToMarkdown(work.startNotes?.trim());
    return notes || "N/A";
}

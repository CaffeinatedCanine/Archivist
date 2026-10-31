import { load } from "cheerio";
export function countChapterWords(html) {
    if (!html)
        return 0;
    const $ = load(html);
    const text = $("p, center").text().trim();
    return text ? text.split(/\s+/).length : 0;
}

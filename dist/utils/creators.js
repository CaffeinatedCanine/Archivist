import { getUserProfileUrl } from "@fujocoded/ao3.js/urls";
export function constructCreators(source, anonymous) {
    const creators = Array.isArray(source)
        ? source
        : (source?.authors ?? source?.creators ?? []);
    const isAnonymous = anonymous ?? (Array.isArray(source) ? false : (source?.anonymous ?? false));
    if (isAnonymous)
        return "Anonymous";
    if (!creators.length)
        return "";
    return creators
        .map((creator) => {
        const display = creator.pseud ?? creator.name ?? creator.username ?? "Anonymous";
        return creator.username
            ? `[${display}](${getUserProfileUrl({ username: creator.username })})`
            : display;
    })
        .join(", ");
}

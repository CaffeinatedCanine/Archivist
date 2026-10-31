import { getGuildSettingsBundle, updateChapterFieldSettings, updateGuildSettings, updateSeriesFieldSettings, updateUserFieldSettings, updateWorkFieldSettings, } from "./settings.js";
export { getGuildSettingsBundle };
// Prefixing a link with this character stops the bot from embedding it at
// all, e.g. "%https://archiveofourown.org/works/...". Guild-configurable,
// falls back to "%" to preserve the documented default behavior.
export const DEFAULT_IGNORE_CHAR = "%";
// Discord's hard cap on a single embed field's value.
export const FIELD_VALUE_HARD_CAP = 1024;
const MIN_FIELD_MAX_LENGTH = 50;
// Each category maps 1:1 to a CheckboxGroup modal. Discord caps a CheckboxGroup at 10 options
export const EMBED_FIELD_CATEGORIES = {
    general: {
        title: "Preferences",
        fields: [
            {
                key: "deleteOriginalMessage",
                label: "Delete original message with link",
                description: "Deletes the user's entire message, including any other text, after the bot posts its embed(s).",
                defaultEnabled: false,
            },
            {
                key: "legacyWorkEmbed",
                label: "Use the original Archivist-style embed",
                description: "One embed including all fields, instead of paginated Stats/Tags/Summary tabs.",
                defaultEnabled: false,
            },
            {
                key: "outageAlerts",
                label: "Post AO3 outage alerts",
                description: "Posts to the channel set below whenever AO3's status changes, and again on recovery.",
                defaultEnabled: false,
            },
        ],
    },
    "work-stats": {
        title: "Stats",
        fields: [
            {
                key: "words",
                label: "Words",
                description: "Total word count of the work.",
            },
            {
                key: "chapters",
                label: "Chapters",
                description: "Published / total chapter count.",
            },
            {
                key: "language",
                label: "Language",
                description: "The work's language.",
            },
            {
                key: "published",
                label: "Published",
                description: "When the work was first posted.",
            },
            {
                key: "updated",
                label: "Updated",
                description: "When the work was last updated.",
            },
            {
                key: "status",
                label: "Status",
                description: "Complete or Work in Progress.",
            },
            {
                key: "rating",
                label: "Rating",
                description: "AO3 content rating (Explicit, Mature, etc.).",
            },
            {
                key: "warnings",
                label: "Warnings",
                description: "The work's Archive Warnings, if any.",
            },
            {
                key: "category",
                label: "Category",
                description: "Ship category (F/M, M/M, Gen, etc.).",
            },
        ],
    },
    "work-tags": {
        title: "Tags",
        fields: [
            {
                key: "fandoms",
                label: "Fandoms",
                description: "Which fandom(s) the work belongs to.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
            {
                key: "relationships",
                label: "Relationships",
                description: "Tagged relationships.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
            {
                key: "characters",
                label: "Characters",
                description: "Tagged characters featured in the work.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
            {
                key: "tags",
                label: "Additional Tags",
                description: "Freeform tags the author added.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
        ],
    },
    "work-summary": {
        title: "Summary",
        fields: [
            {
                key: "summary",
                label: "Summary",
                description: "Adds a Summary tab that describes the work.",
                maxLength: 3000,
                maxLengthCap: 10000,
            },
        ],
    },
    gallery: {
        title: "Gallery",
        fields: [
            {
                key: "enabled",
                label: "Show image gallery",
                description: "Post a paginated gallery of a work's all embedded images alongside its main embed.",
            },
            {
                key: "nsfwWarningMature",
                label: "NSFW warning for Mature works",
                description: "Adds a warning-only first page to Mature-rated galleries. Click through to see the images.",
            },
            {
                key: "nsfwWarningExplicit",
                label: "NSFW warning for Explicit works",
                description: "Adds a warning-only first page to Explicit-rated galleries. Click through to see the images.",
            },
        ],
    },
    // Inactivity auto-reset: default tab + gallery reset toggle.
    "work-inactivity": {
        title: "Inactivity",
        fields: [
            {
                key: "galleryResetToFirstPage",
                label: "Reset gallery to page 1 after inactivity",
                description: "The original gallery message jumps back to page 1 after 5 minutes with no clicks.",
            },
        ],
    },
    // Subcategory of Restrictions — a work with a disallowed rating is
    // blocked from being posted at all, same as a blocked warning/tag.
    ratings: {
        title: "Ratings",
        fields: [
            { key: "rating-not-rated", label: "Not Rated", defaultEnabled: true },
            {
                key: "rating-general-audiences",
                label: "General Audiences",
                defaultEnabled: true,
            },
            {
                key: "rating-teen-and-up-audiences",
                label: "Teen And Up Audiences",
                defaultEnabled: true,
            },
            { key: "rating-mature", label: "Mature", defaultEnabled: true },
            { key: "rating-explicit", label: "Explicit", defaultEnabled: true },
        ],
    },
    // Special-cased in settingsPanel.ts: its modal combines these Archive
    // Warning checkboxes with a free-text Additional Tags blocklist that
    // doesn't fit the fixed-checkbox shape.
    restrictions: {
        title: "Restrictions",
        fields: [
            {
                key: "warning-graphic-violence",
                label: "Graphic Depictions Of Violence",
                defaultEnabled: true,
            },
            {
                key: "warning-major-character-death",
                label: "Major Character Death",
                defaultEnabled: true,
            },
            {
                key: "warning-no-warnings-apply",
                label: "No Archive Warnings Apply",
                defaultEnabled: true,
            },
            { key: "warning-noncon", label: "Rape/Non-Con", defaultEnabled: true },
            { key: "warning-underage", label: "Underage Sex", defaultEnabled: true },
            {
                key: "warning-choose-not-to-warn",
                label: "Creator Chose Not To Use Archive Warnings",
                defaultEnabled: true,
            },
        ],
    },
    chapter: {
        title: "Fields",
        fields: [
            {
                key: "words",
                label: "Words",
                description: "Chapter word count, with the work's total in brackets.",
            },
            {
                key: "chapters",
                label: "Chapters",
                description: "Published / total chapter count.",
            },
            {
                key: "rating",
                label: "Rating",
                description: "AO3 content rating (Explicit, Mature, etc.).",
            },
            {
                key: "published",
                label: "Published",
                description: "When the work was first posted.",
            },
            {
                key: "updated",
                label: "Updated",
                description: "When the work was last updated.",
            },
            {
                key: "status",
                label: "Status",
                description: "Complete or Work in Progress.",
            },
            {
                key: "warnings",
                label: "Warnings",
                description: "The work's Archive Warnings, if any.",
            },
            {
                key: "summary",
                label: "Summary",
                description: "Adds a Summary tab with this chapter's summary, paginated if it's long.",
                maxLength: 3000,
                maxLengthCap: 10000,
            },
            {
                key: "notes",
                label: "Notes",
                description: "This chapter's beginning/end author notes — merged into Summary if present, else its own tab.",
                maxLength: 3000,
                maxLengthCap: 10000,
            },
        ],
    },
    "chapter-tags": {
        title: "Tags",
        fields: [
            {
                key: "fandoms",
                label: "Fandoms",
                description: "Which fandom(s) the work belongs to.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
            {
                key: "relationships",
                label: "Relationships",
                description: "Tagged relationships.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
            {
                key: "characters",
                label: "Characters",
                description: "Tagged characters featured in the work.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
            {
                key: "tags",
                label: "Additional Tags",
                description: "Freeform tags the author added.",
                maxLength: FIELD_VALUE_HARD_CAP,
            },
        ],
    },
    "chapter-thumbnail": {
        title: "Thumbnail",
        fields: [
            {
                key: "enabled",
                label: "Show chapter thumbnail",
                description: "Shows the chapter's first embedded image as a small thumbnail.",
            },
            {
                key: "excludeMature",
                label: "Hide thumbnail on Mature works",
                description: "Never show a thumbnail for chapters belonging to a Mature-rated work.",
            },
            {
                key: "excludeExplicit",
                label: "Hide thumbnail on Explicit works",
                description: "Never show a thumbnail for chapters belonging to an Explicit-rated work.",
            },
        ],
    },
    // Inactivity auto-reset: default tab only.
    "chapter-inactivity": {
        title: "Inactivity",
        fields: [],
    },
    series: {
        title: "Fields",
        fields: [
            {
                key: "authors",
                label: "Authors",
                description: "Who wrote the series.",
            },
            {
                key: "complete",
                label: "Complete",
                description: "Whether every work in the series is finished.",
            },
            {
                key: "workCount",
                label: "Works",
                description: "How many works are in the series.",
            },
            {
                key: "wordCount",
                label: "Total Word Count",
                description: "Combined word count across the series.",
            },
            {
                key: "bookmarks",
                label: "Bookmarks",
                description: "Total bookmark count for the series.",
            },
            {
                key: "started",
                label: "Started",
                description: "When the series was started.",
            },
            {
                key: "updated",
                label: "Updated",
                description: "When the series was last updated.",
            },
            {
                key: "notes",
                label: "Notes",
                description: "Adds a Notes tab with the series' author notes, paginated if it's long.",
                maxLength: 3000,
                maxLengthCap: 10000,
            },
            {
                key: "description",
                label: "Description",
                description: "Adds a Description tab with the series' description, paginated if it's long.",
                maxLength: 3000,
                maxLengthCap: 10000,
            },
        ],
    },
    // Inactivity auto-reset: default tab only.
    "series-inactivity": {
        title: "Inactivity",
        fields: [],
    },
    user: {
        title: "Fields",
        fields: [
            {
                key: "pseuds",
                label: "Pseuds",
                description: "The user's alternate pseud names.",
            },
            {
                key: "joined",
                label: "Joined",
                description: "When the user joined AO3.",
            },
            {
                key: "location",
                label: "Location",
                description: "User-provided location, if set.",
            },
            {
                key: "birthday",
                label: "Birthday",
                description: "User-provided birthday, if set.",
            },
            {
                key: "works",
                label: "Works",
                description: "Link + count of the user's works.",
            },
            {
                key: "series",
                label: "Series",
                description: "Link + count of the user's series.",
            },
            {
                key: "collections",
                label: "Collections",
                description: "Link + count of the user's collections.",
            },
            {
                key: "bookmarks",
                label: "Bookmarks",
                description: "Link + count of the user's bookmarks.",
            },
            {
                key: "gifts",
                label: "Gifts",
                description: "Link + count of works gifted to the user.",
            },
            {
                key: "bio",
                label: "Bio",
                description: "The user's profile bio, paginated if it's long.",
                maxLength: 6000,
                maxLengthCap: 20000,
            },
        ],
    },
    "user-inactivity": {
        title: "Inactivity",
        fields: [
            {
                key: "resetToFirstPage",
                label: "Reset to page 1 after inactivity",
                description: "The original profile message jumps back to page 1 after 5 minutes with no clicks.",
            },
        ],
    },
};
// Top-level panel pages — one per embed type. Each page's Configure row
// gets one button per category listed here.
export const EMBED_FIELD_GROUPS = [
    {
        key: "general",
        title: "General",
        categories: ["general", "ratings", "restrictions"],
    },
    {
        key: "work",
        title: "Work",
        categories: [
            "work-stats",
            "work-tags",
            "work-summary",
            "gallery",
            "work-inactivity",
        ],
    },
    {
        key: "chapter",
        title: "Chapter",
        categories: [
            "chapter",
            "chapter-tags",
            "chapter-thumbnail",
            "chapter-inactivity",
        ],
    },
    {
        key: "series",
        title: "Series",
        categories: ["series", "series-inactivity"],
    },
    {
        key: "user",
        title: "User Profile",
        categories: ["user", "user-inactivity"],
    },
];
const CATEGORY_TABLE = {
    general: "guild",
    "work-stats": "work",
    "work-tags": "work",
    "work-summary": "work",
    gallery: "guild",
    "work-inactivity": "guild",
    ratings: "guild",
    restrictions: "guild",
    chapter: "chapter",
    "chapter-tags": "chapter",
    "chapter-thumbnail": "chapter",
    "chapter-inactivity": "chapter",
    series: "series",
    "series-inactivity": "series",
    user: "user",
    "user-inactivity": "user",
};
const FIELD_COLUMNS = {
    general: {
        deleteOriginalMessage: { column: "deleteOriginalLink" },
        legacyWorkEmbed: { column: "legacyWorkEmbed" },
        outageAlerts: { column: "outageAlertsEnabled" },
    },
    "work-stats": {
        words: { column: "showWords" },
        chapters: { column: "showChapters" },
        language: { column: "showLanguage" },
        published: { column: "showPublished" },
        updated: { column: "showUpdated" },
        status: { column: "showStatus" },
        rating: { column: "showRating" },
        warnings: { column: "showWarnings" },
        category: { column: "showCategory" },
    },
    "work-tags": {
        fandoms: { column: "showFandoms", lengthColumn: "fandomsMaxLength" },
        relationships: {
            column: "showRelationships",
            lengthColumn: "relationshipsMaxLength",
        },
        characters: {
            column: "showCharacters",
            lengthColumn: "charactersMaxLength",
        },
        tags: { column: "showTags", lengthColumn: "tagsMaxLength" },
    },
    "work-summary": {
        summary: { column: "showSummary", lengthColumn: "summaryMaxLength" },
    },
    gallery: {
        enabled: { column: "galleryEnabled" },
        nsfwWarningMature: { column: "galleryNsfwWarningMature" },
        nsfwWarningExplicit: { column: "galleryNsfwWarningExplicit" },
    },
    "work-inactivity": {
        galleryResetToFirstPage: { column: "galleryResetToFirstPage" },
    },
    ratings: {
        "rating-not-rated": { column: "allowRatingNotRated" },
        "rating-general-audiences": { column: "allowRatingGeneralAudiences" },
        "rating-teen-and-up-audiences": { column: "allowRatingTeenAndUpAudiences" },
        "rating-mature": { column: "allowRatingMature" },
        "rating-explicit": { column: "allowRatingExplicit" },
    },
    restrictions: {
        "warning-graphic-violence": { column: "allowWarningGraphicViolence" },
        "warning-major-character-death": {
            column: "allowWarningMajorCharacterDeath",
        },
        "warning-no-warnings-apply": { column: "allowWarningNoWarningsApply" },
        "warning-noncon": { column: "allowWarningNoncon" },
        "warning-underage": { column: "allowWarningUnderage" },
        "warning-choose-not-to-warn": { column: "allowWarningChooseNotToWarn" },
    },
    chapter: {
        words: { column: "showWords" },
        chapters: { column: "showChapters" },
        rating: { column: "showRating" },
        published: { column: "showPublished" },
        updated: { column: "showUpdated" },
        status: { column: "showStatus" },
        warnings: { column: "showWarnings" },
        summary: { column: "showSummary", lengthColumn: "summaryMaxLength" },
        notes: { column: "showNotes", lengthColumn: "notesMaxLength" },
    },
    "chapter-tags": {
        fandoms: { column: "showFandoms", lengthColumn: "fandomsMaxLength" },
        relationships: {
            column: "showRelationships",
            lengthColumn: "relationshipsMaxLength",
        },
        characters: {
            column: "showCharacters",
            lengthColumn: "charactersMaxLength",
        },
        tags: { column: "showTags", lengthColumn: "tagsMaxLength" },
    },
    "chapter-thumbnail": {
        enabled: { column: "showThumbnail" },
        excludeMature: { column: "hideThumbnailOnMature" },
        excludeExplicit: { column: "hideThumbnailOnExplicit" },
    },
    "chapter-inactivity": {},
    series: {
        authors: { column: "showAuthors" },
        complete: { column: "showComplete" },
        workCount: { column: "showWorkCount" },
        wordCount: { column: "showWordCount" },
        bookmarks: { column: "showBookmarks" },
        started: { column: "showStarted" },
        updated: { column: "showUpdated" },
        notes: { column: "showNotes", lengthColumn: "notesMaxLength" },
        description: {
            column: "showDescription",
            lengthColumn: "descriptionMaxLength",
        },
    },
    "series-inactivity": {},
    user: {
        pseuds: { column: "showPseuds" },
        joined: { column: "showJoined" },
        location: { column: "showLocation" },
        birthday: { column: "showBirthday" },
        works: { column: "showWorks" },
        series: { column: "showSeries" },
        collections: { column: "showCollections" },
        bookmarks: { column: "showBookmarks" },
        gifts: { column: "showGifts" },
        bio: { column: "showBio", lengthColumn: "bioMaxLength" },
    },
    "user-inactivity": {
        resetToFirstPage: { column: "resetToFirstPage" },
    },
};
function bundleRow(bundle, category) {
    const table = CATEGORY_TABLE[category];
    switch (table) {
        case "guild":
            return bundle.guild;
        case "work":
            return bundle.work;
        case "chapter":
            return bundle.chapter;
        case "series":
            return bundle.series;
        case "user":
            return bundle.user;
    }
}
async function writeCategoryValues(guildId, category, values) {
    const table = CATEGORY_TABLE[category];
    switch (table) {
        case "guild":
            return updateGuildSettings(guildId, values);
        case "work":
            return updateWorkFieldSettings(guildId, values);
        case "chapter":
            return updateChapterFieldSettings(guildId, values);
        case "series":
            return updateSeriesFieldSettings(guildId, values);
        case "user":
            return updateUserFieldSettings(guildId, values);
    }
}
export function isFieldEnabled(bundle, category, key) {
    const field = EMBED_FIELD_CATEGORIES[category].fields.find((f) => f.key === key);
    const fallback = field?.defaultEnabled ?? true;
    const map = FIELD_COLUMNS[category][key];
    const row = map ? bundleRow(bundle, category) : null;
    if (!map || !row)
        return fallback;
    const value = row[map.column];
    return typeof value === "boolean" ? value : fallback;
}
export function getCategoryFieldStates(bundle, category) {
    return EMBED_FIELD_CATEGORIES[category].fields.map((field) => ({
        ...field,
        enabled: isFieldEnabled(bundle, category, field.key),
    }));
}
// Whether a work/chapter of this rating is allowed to be posted at all —
// a hard block, distinct from the gallery's NSFW warning (which still posts
// the content, just with a heads-up banner).
// Maps AO3's exact rating strings to their checkbox field keys.
const RATING_FIELD_KEYS = {
    "Not Rated": "rating-not-rated",
    "General Audiences": "rating-general-audiences",
    "Teen And Up Audiences": "rating-teen-and-up-audiences",
    Mature: "rating-mature",
    Explicit: "rating-explicit",
};
export function isRatingAllowed(bundle, rating) {
    if (!rating)
        return true;
    const key = RATING_FIELD_KEYS[rating];
    if (!key)
        return true;
    return isFieldEnabled(bundle, "ratings", key);
}
// Maps AO3's exact Archive Warning strings to their checkbox field keys.
const WARNING_FIELD_KEYS = {
    "Graphic Depictions Of Violence": "warning-graphic-violence",
    "Major Character Death": "warning-major-character-death",
    "No Archive Warnings Apply": "warning-no-warnings-apply",
    "Rape/Non-Con": "warning-noncon",
    "Underage Sex": "warning-underage",
    "Creator Chose Not To Use Archive Warnings": "warning-choose-not-to-warn",
};
// Returns the first disallowed Archive Warning present on the work, or null
// if all of its warnings are allowed (or it has none AO3.js recognizes).
export function findDisallowedWarning(bundle, workWarnings) {
    if (!workWarnings?.length)
        return null;
    for (const warning of workWarnings) {
        const key = WARNING_FIELD_KEYS[warning];
        if (key && !isFieldEnabled(bundle, "restrictions", key))
            return warning;
    }
    return null;
}
export function shouldShowNsfwWarning(bundle, rating, locked) {
    if (locked)
        return false;
    if (rating === "Mature")
        return isFieldEnabled(bundle, "gallery", "nsfwWarningMature");
    if (rating === "Explicit")
        return isFieldEnabled(bundle, "gallery", "nsfwWarningExplicit");
    return false;
}
export function getFieldMaxLength(bundle, category, key) {
    const field = EMBED_FIELD_CATEGORIES[category].fields.find((f) => f.key === key);
    const defaultMax = field?.maxLength ?? FIELD_VALUE_HARD_CAP;
    const map = FIELD_COLUMNS[category][key];
    const row = map?.lengthColumn ? bundleRow(bundle, category) : null;
    if (!map?.lengthColumn || !row)
        return defaultMax;
    const value = row[map.lengthColumn];
    return typeof value === "number" ? value : defaultMax;
}
export function getFieldMaxLengthCap(category, key) {
    const field = EMBED_FIELD_CATEGORIES[category].fields.find((f) => f.key === key);
    return field?.maxLengthCap ?? FIELD_VALUE_HARD_CAP;
}
export async function setFieldMaxLengths(guildId, category, lengths) {
    const values = {};
    for (const field of EMBED_FIELD_CATEGORIES[category].fields) {
        if (!field.maxLength)
            continue;
        const map = FIELD_COLUMNS[category][field.key];
        if (!map?.lengthColumn)
            continue;
        const cap = field.maxLengthCap ?? FIELD_VALUE_HARD_CAP;
        const requested = lengths[field.key];
        values[map.lengthColumn] = Number.isFinite(requested)
            ? Math.min(Math.max(requested, MIN_FIELD_MAX_LENGTH), cap)
            : field.maxLength;
    }
    if (Object.keys(values).length === 0)
        return;
    await writeCategoryValues(guildId, category, values);
}
export async function setCategoryFields(guildId, category, enabledKeys) {
    const enabledSet = new Set(enabledKeys);
    const values = {};
    for (const field of EMBED_FIELD_CATEGORIES[category].fields) {
        const map = FIELD_COLUMNS[category][field.key];
        if (map)
            values[map.column] = enabledSet.has(field.key);
    }
    await writeCategoryValues(guildId, category, values);
}
export async function resetCategoryToDefaults(guildId, category) {
    const values = {};
    for (const field of EMBED_FIELD_CATEGORIES[category].fields) {
        const map = FIELD_COLUMNS[category][field.key];
        if (!map)
            continue;
        values[map.column] = field.defaultEnabled ?? true;
        if (map.lengthColumn)
            values[map.lengthColumn] = field.maxLength ?? FIELD_VALUE_HARD_CAP;
    }
    // Skip categories with no FieldDefs (e.g. the -inactivity ones).
    if (Object.keys(values).length === 0)
        return;
    await writeCategoryValues(guildId, category, values);
}
export function getIgnoreChar(bundle) {
    return bundle.guild?.ignoreChar || DEFAULT_IGNORE_CHAR;
}
export async function setIgnoreChar(guildId, ignoreChar) {
    const char = ignoreChar.trim().slice(0, 1);
    await updateGuildSettings(guildId, {
        ignoreChar: char || DEFAULT_IGNORE_CHAR,
    });
}
export function getWorkDefaultTab(bundle) {
    return bundle.work?.defaultTab ?? "stats";
}
export async function setWorkDefaultTab(guildId, tab) {
    await updateWorkFieldSettings(guildId, { defaultTab: tab });
}
export function getChapterDefaultTab(bundle) {
    return bundle.chapter?.defaultTab ?? "stats";
}
export async function setChapterDefaultTab(guildId, tab) {
    await updateChapterFieldSettings(guildId, { defaultTab: tab });
}
export function getSeriesDefaultTab(bundle) {
    return bundle.series?.defaultTab ?? "stats";
}
export async function setSeriesDefaultTab(guildId, tab) {
    await updateSeriesFieldSettings(guildId, { defaultTab: tab });
}
// /list's reset toggle — shown on the Series settings page.
export function getListResetToFirstPage(bundle) {
    return bundle.guild?.listResetToFirstPage ?? true;
}
export async function setListResetToFirstPage(guildId, enabled) {
    await updateGuildSettings(guildId, { listResetToFirstPage: enabled });
}
// Flips a single field via a partial UPDATE on just its column — used to
// apply a field change gated behind a separate confirmation step (see
// settingsPanel.ts's delete-original-message confirm flow), after the rest
// of that category's modal has already saved.
export async function setSingleFieldEnabled(guildId, category, key, enabled) {
    const map = FIELD_COLUMNS[category][key];
    if (!map)
        return;
    await writeCategoryValues(guildId, category, { [map.column]: enabled });
}

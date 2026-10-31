import { SlashCommandBuilder } from "discord.js";
import { ao3WorkError, authError } from "../../utils/errors.js";
import { getDownloadUrls, getWorkDetailsFromUrl } from "@fujocoded/ao3.js/urls";
import { ao3Embed } from "../../utils/baseEmbed.js";
import { cachedGetWork } from "../../utils/cache.js";
import { constructCreators } from "../../utils/creators.js";
import { getEmoji } from "../../utils/emojis.js";
import { stripIndents } from "common-tags";
export const data = new SlashCommandBuilder()
    .setName("download")
    .setDescription("Provides a link so you can download a work with a specific format from AO3.")
    .addStringOption((option) => option
    .setName("filetype")
    .setDescription("Select the file type you would like.")
    .setRequired(true)
    .addChoices({ name: "AZW3", value: "azw3" }, { name: "EPUB", value: "epub" }, { name: "HTML", value: "html" }, { name: "MOBI", value: "mobi" }, { name: "PDF", value: "pdf" }))
    .addStringOption((option) => option
    .setName("url")
    .setDescription("Provide the work link.")
    .setRequired(true));
export const execute = async (interaction) => {
    // validate early to avoid deferring when input is invalid
    const workURL = interaction.options.getString("url", true);
    const isWorkUrl = workURL.includes("archiveofourown.org/works/") ||
        workURL.includes("ao3.org/works/");
    if (!isWorkUrl) {
        await interaction.reply(ao3WorkError);
        return;
    }
    await interaction.deferReply();
    const workId = getWorkDetailsFromUrl({ url: workURL }).workId;
    const work = await cachedGetWork(workId);
    if (work.locked) {
        await interaction.editReply(authError);
        return;
    }
    const title = work.title;
    const creators = constructCreators(work);
    const file = interaction.options.getString("filetype", true);
    const urls = getDownloadUrls(work);
    const FILE_TYPE = {
        azw3: { url: urls.azw3, icon: getEmoji("azw3") },
        epub: { url: urls.epub, icon: getEmoji("epub") },
        html: { url: urls.html, icon: getEmoji("html") },
        mobi: { url: urls.mobi, icon: getEmoji("mobi") },
        pdf: { url: urls.pdf, icon: getEmoji("pdf") },
    };
    const downloadLink = FILE_TYPE[file]?.url;
    const fileIcon = FILE_TYPE[file]?.icon ?? "";
    if (!downloadLink) {
        await interaction.editReply({
            content: "Sorry — that format is not available for this work.",
        });
        return;
    }
    const description = stripIndents `by ${creators}
    _Click the link below to download the **${file.toUpperCase()}** file you requested._
    ## ${fileIcon} [Download](${downloadLink})

		🌟 DON'T FORGET TO VISIT AO3 TO LEAVE KUDOS OR COMMENTS! 🌟`;
    const downloadEmbed = ao3Embed()
        .setTitle(title)
        .setURL(workURL)
        .setDescription(description);
    await interaction.editReply({ embeds: [downloadEmbed] });
};

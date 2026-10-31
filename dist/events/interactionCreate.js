import { Events, MessageFlags } from "discord.js";
import { handleRestrictionsModalSubmit, handleSettingsPanelButtonInteraction, handleSettingsPanelModalSubmit, handleSettingsPanelSelectInteraction, } from "../utils/settingsPanel.js";
import { handleWorkGalleryButtonInteraction, handleWorkGallerySelectInteraction, } from "../utils/images.js";
import { getCommandFailureNotice } from "../utils/messageCleanup.js";
import { handleChapterEmbedButtonInteraction } from "../utils/embeds/chapterEmbed.js";
import { handleHelpButtonInteraction } from "../commands/general/help.js";
import { handleListButtonInteraction, handleListSelectInteraction, } from "../commands/ao3/list.js";
import { handleSeriesEmbedButtonInteraction } from "../utils/embeds/seriesEmbed.js";
import { handleUserEmbedButtonInteraction } from "../utils/embeds/userEmbed.js";
import { handleWorkEmbedButtonInteraction } from "../utils/embeds/worksEmbed.js";
export const name = Events.InteractionCreate;
export const execute = async (interaction) => {
    if (interaction.isButton()) {
        try {
            if (await handleHelpButtonInteraction(interaction))
                return;
            if (await handleWorkEmbedButtonInteraction(interaction))
                return;
            if (await handleWorkGalleryButtonInteraction(interaction))
                return;
            if (await handleUserEmbedButtonInteraction(interaction))
                return;
            if (await handleChapterEmbedButtonInteraction(interaction))
                return;
            if (await handleSeriesEmbedButtonInteraction(interaction))
                return;
            if (await handleListButtonInteraction(interaction))
                return;
            if (await handleSettingsPanelButtonInteraction(interaction))
                return;
        }
        catch (error) {
            console.error("Error handling button interaction:", error);
        }
    }
    if (interaction.isStringSelectMenu()) {
        try {
            if (await handleWorkGallerySelectInteraction(interaction))
                return;
            if (await handleListSelectInteraction(interaction))
                return;
            if (await handleSettingsPanelSelectInteraction(interaction))
                return;
        }
        catch (error) {
            console.error("Error handling select menu interaction:", error);
        }
    }
    if (interaction.isModalSubmit()) {
        try {
            if (await handleRestrictionsModalSubmit(interaction))
                return;
            if (await handleSettingsPanelModalSubmit(interaction))
                return;
        }
        catch (error) {
            console.error("Error handling modal submit interaction:", error);
        }
    }
    if (interaction.isAutocomplete()) {
        const command = interaction.client.commands.get(interaction.commandName);
        try {
            await command?.autocomplete?.(interaction);
        }
        catch (error) {
            console.error(`Error handling autocomplete for ${interaction.commandName}`);
            console.error(error);
        }
        return;
    }
    if (!interaction.isChatInputCommand())
        return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    try {
        await command.execute(interaction);
    }
    catch (error) {
        console.error(`Error executing ${interaction.commandName}`);
        console.error(error);
        // Otherwise a deferred reply would sit on "thinking..." forever.
        const content = getCommandFailureNotice(error);
        const reply = interaction.deferred || interaction.replied
            ? interaction.editReply({ content })
            : interaction.reply({ content, flags: MessageFlags.Ephemeral });
        await reply.catch(() => { });
    }
};

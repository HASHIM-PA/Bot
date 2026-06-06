// ── repost.js ─────────────────────────────────────────────────────────────────
// src/commands/Channal/repost.js
//
// Destination channel — 3 ways to pick (all supported):
//   1. /repost message_id:<id> destination:<#channel>  ← slash option
//   2. Type #channel mention or channel ID in the modal popup
//   3. Pick from a dropdown list of all text channels in the server
//
// Other features:
//   • Auto-detects posts in watched channels and prompts repost
//   • Keeps original image / attachments
//   • Opens modal to edit full message text + prices before reposting
//   • Confirm step shows preview before sending
// ─────────────────────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  ChannelType,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

// ── In-memory pending reposts (userId → session) ──────────────────────────────
const pending = new Map();

// ── Price regex — matches ₹299/-, $10, Rs.499, 10.00, 299/- etc. ─────────────
const PRICE_REGEX = /(?:₹|\$|Rs\.?|INR\s*)?\d+(?:[.,]\d+)*\s*(?:\/[-–])?/gi;

function extractPrices(text) {
  return [...(text.matchAll(PRICE_REGEX) ?? [])].map(m => m[0].trim()).filter(Boolean);
}

// ── Resolve channel from mention (#channel) or raw ID ────────────────────────
function resolveChannel(guild, raw) {
  const id = raw.replace(/[<#>]/g, '').trim();
  return guild.channels.cache.get(id) ?? null;
}

// ── Build text channel dropdown (max 25) ──────────────────────────────────────
function buildChannelDropdown(guild) {
  const textChannels = guild.channels.cache
    .filter(c =>
      c.type === ChannelType.GuildText ||
      c.type === ChannelType.GuildAnnouncement
    )
    .sort((a, b) => a.position - b.position)
    .first(25);

  if (!textChannels.size) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rp_dest_select')
      .setPlaceholder('📢 Pick a destination channel…')
      .addOptions(
        textChannels.map(c =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`# ${c.name}`)
            .setDescription(c.topic?.substring(0, 50) || 'No topic')
            .setValue(c.id)
        )
      )
  );
}

// ── Preview embed ─────────────────────────────────────────────────────────────
function buildPreviewEmbed(originalMsg, destChannel = null) {
  const prices = extractPrices(originalMsg.content || '');

  const embed = new EmbedBuilder()
    .setTitle('📋 Repost Setup')
    .setColor(0x5865f2)
    .addFields(
      {
        name: '📨 Source',
        value: `${originalMsg.channel} by **${originalMsg.author.tag}**`,
        inline: true,
      },
      {
        name: '📢 Destination',
        value: destChannel ? `${destChannel}` : '⚠️ _not set yet_',
        inline: true,
      },
      {
        name: '💰 Detected Prices',
        value: prices.length
          ? prices.map((p, i) => `${i + 1}. \`${p}\``).join('\n')
          : '_(none detected)_',
        inline: false,
      },
      {
        name: '🖼️ Attachments',
        value: originalMsg.attachments.size > 0
          ? `${originalMsg.attachments.size} file(s) will be kept`
          : 'None',
        inline: true,
      },
      {
        name: '📝 Message Preview',
        value: originalMsg.content
          ? `\`\`\`\n${originalMsg.content.substring(0, 300)}\n\`\`\``
          : '_(no text content)_',
        inline: false,
      }
    );

  return embed;
}

// ── Action buttons ────────────────────────────────────────────────────────────
function buildActionButtons(destSet = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rp_type_channel')
      .setLabel('⌨️ Type Channel')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('rp_edit_prices')
      .setLabel('✏️ Edit Message & Prices')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!destSet),
    new ButtonBuilder()
      .setCustomId('rp_send_asis')
      .setLabel('✅ Send As-Is')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!destSet),
    new ButtonBuilder()
      .setCustomId('rp_cancel')
      .setLabel('🗑️ Cancel')
      .setStyle(ButtonStyle.Danger),
  );
  return row;
}

// ── Actually send the repost ──────────────────────────────────────────────────
async function doRepost(interaction, session) {
  const { destChannelId, newContent, originalMsg } = session;

  const destChannel = interaction.guild.channels.cache.get(destChannelId);
  if (!destChannel) {
    await InteractionHelper.universalReply(interaction, {
      content: '❌ Destination channel not found.',
      ephemeral: true,
    });
    return;
  }

  try {
    const files = originalMsg.attachments.size > 0
      ? [...originalMsg.attachments.values()].map(a => a.url)
      : [];

    const embeds = originalMsg.embeds?.filter(
      e => e.data && Object.keys(e.data).length > 0
    ) ?? [];

    const sentMsg = await destChannel.send({
      content: newContent || originalMsg.content || undefined,
      files:   files.length   > 0 ? files   : undefined,
      embeds:  embeds.length  > 0 ? embeds  : undefined,
    });

    const doneEmbed = new EmbedBuilder()
      .setTitle('✅ Reposted!')
      .setColor(0x57f287)
      .addFields(
        { name: 'Channel', value: `${destChannel}`,                          inline: true },
        { name: 'Message', value: `[Jump ↗](${sentMsg.url})`,                inline: true },
        { name: 'By',      value: interaction.user.tag,                       inline: true },
      )
      .setTimestamp();

    await InteractionHelper.universalReply(interaction, {
      embeds: [doneEmbed],
      components: [],
    });
  } catch (err) {
    logger.error('repost doRepost error:', err);
    await handleInteractionError(interaction, err, { subtype: 'repost_failed' });
  }
}

// ── Full page rebuild (embed + dropdown + buttons) ────────────────────────────
async function rebuildPage(interaction, session, guild) {
  const destChannel = session.destChannelId
    ? guild.channels.cache.get(session.destChannelId)
    : null;

  const embed      = buildPreviewEmbed(session.originalMsg, destChannel);
  const dropdown   = buildChannelDropdown(guild);
  const btnRow     = buildActionButtons(!!session.destChannelId);
  const components = dropdown ? [dropdown, btnRow] : [btnRow];

  await interaction.update({ embeds: [embed], components });
}

// ─────────────────────────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('repost')
    .setDescription('Repost a message to another channel with optional price edits')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o =>
      o.setName('message_id')
        .setDescription('ID of the message to repost (right-click message → Copy ID)')
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName('destination')
        .setDescription('Channel to repost into')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName('source')
        .setDescription('Channel to fetch the message from (default: current channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    ),

  category: 'admin',

  // ── /repost executed ─────────────────────────────────────────────────────
  async execute(interaction, config, client) {
    try {
      const messageId   = interaction.options.getString('message_id');
      const srcChannel  = interaction.options.getChannel('source')      ?? interaction.channel;
      const destChannel = interaction.options.getChannel('destination') ?? null;

      await InteractionHelper.universalReply(interaction, {
        content: '🔍 Fetching message…',
        ephemeral: true,
      });

      const originalMsg = await srcChannel.messages.fetch(messageId).catch(() => null);
      if (!originalMsg) {
        await interaction.editReply({
          content: '❌ Message not found. Check the ID and make sure I can see that channel.',
        });
        return;
      }

      const session = {
        originalMsg,
        destChannelId: destChannel?.id ?? null,
        newContent: null,
      };
      pending.set(interaction.user.id, session);

      const embed      = buildPreviewEmbed(originalMsg, destChannel);
      const dropdown   = buildChannelDropdown(interaction.guild);
      const btnRow     = buildActionButtons(!!destChannel);
      const components = dropdown ? [dropdown, btnRow] : [btnRow];

      await interaction.editReply({ content: '', embeds: [embed], components });
    } catch (error) {
      logger.error('repost execute error:', error);
      await handleInteractionError(interaction, error, { subtype: 'repost_failed' });
    }
  },

  // ── Auto-detect (call from messageCreate.js) ──────────────────────────────
  async onMessage(message, watchedChannelIds = []) {
    if (message.author.bot) return;
    if (!watchedChannelIds.includes(message.channel.id)) return;

    const prices   = extractPrices(message.content || '');
    const hasMedia = message.attachments.size > 0 || message.embeds.length > 0;
    if (prices.length === 0 && !hasMedia) return;

    try {
      pending.set(message.author.id, {
        originalMsg:   message,
        destChannelId: null,
        newContent:    null,
      });

      const embed      = buildPreviewEmbed(message);
      const dropdown   = buildChannelDropdown(message.guild);
      const btnRow     = buildActionButtons(false);
      const components = dropdown ? [dropdown, btnRow] : [btnRow];

      await message.reply({ embeds: [embed], components });
    } catch (err) {
      logger.error('repost onMessage error:', err);
    }
  },

  // ── Buttons + select menu ─────────────────────────────────────────────────
  async handleComponent(interaction) {
    const { customId, user } = interaction;
    const session = pending.get(user.id);

    try {
      // ── Dropdown: channel selected ────────────────────────────────────────
      if (customId === 'rp_dest_select') {
        if (!session) return expiredReply(interaction);
        session.destChannelId = interaction.values[0];
        pending.set(user.id, session);
        await rebuildPage(interaction, session, interaction.guild);
        return;
      }

      // ── Button: type channel manually ─────────────────────────────────────
      if (customId === 'rp_type_channel') {
        if (!session) return expiredReply(interaction);
        const modal = new ModalBuilder()
          .setCustomId('rp_modal_channel')
          .setTitle('Type Destination Channel');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('rp_channel_input')
            .setLabel('Mention or paste Channel ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('#general  or  123456789012345678')
            .setRequired(true)
        ));
        await interaction.showModal(modal);
        return;
      }

      // ── Button: edit message + prices ─────────────────────────────────────
      if (customId === 'rp_edit_prices') {
        if (!session) return expiredReply(interaction);
        const modal = new ModalBuilder()
          .setCustomId('rp_modal_edit')
          .setTitle('Edit Message & Prices');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('rp_new_content')
            .setLabel('Full message with updated prices')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(session.originalMsg.content?.substring(0, 4000) || '')
            .setPlaceholder('Edit the full message here. Change any prices as needed.')
            .setRequired(true)
        ));
        await interaction.showModal(modal);
        return;
      }

      // ── Button: send as-is ────────────────────────────────────────────────
      if (customId === 'rp_send_asis') {
        if (!session) return expiredReply(interaction);
        session.newContent = session.originalMsg.content || null;
        pending.set(user.id, session);
        await interaction.deferUpdate();
        await doRepost(interaction, session);
        pending.delete(user.id);
        return;
      }

      // ── Button: confirm after edit ────────────────────────────────────────
      if (customId === 'rp_confirm_send') {
        if (!session) return expiredReply(interaction);
        await interaction.deferUpdate();
        await doRepost(interaction, session);
        pending.delete(user.id);
        return;
      }

      // ── Button: cancel ────────────────────────────────────────────────────
      if (customId === 'rp_cancel') {
        pending.delete(user.id);
        await interaction.update({ content: '❌ Repost cancelled.', embeds: [], components: [] });
        return;
      }

    } catch (error) {
      logger.error('repost component error:', error);
      await handleInteractionError(interaction, error, { subtype: 'repost_failed' });
    }
  },

  // ── Modals ────────────────────────────────────────────────────────────────
  async handleModal(interaction) {
    const { customId, user } = interaction;
    const session = pending.get(user.id);

    try {
      if (!session) return expiredReply(interaction);

      // ── Channel typed manually ────────────────────────────────────────────
      if (customId === 'rp_modal_channel') {
        const raw     = interaction.fields.getTextInputValue('rp_channel_input').trim();
        const channel = resolveChannel(interaction.guild, raw);

        if (!channel) {
          await interaction.reply({
            content: `❌ Could not find channel \`${raw}\`. Try mentioning it with # or paste the ID.`,
            ephemeral: true,
          });
          return;
        }

        session.destChannelId = channel.id;
        pending.set(user.id, session);
        await rebuildPage(interaction, session, interaction.guild);
        return;
      }

      // ── Message + prices edited ───────────────────────────────────────────
      if (customId === 'rp_modal_edit') {
        const newContent = interaction.fields.getTextInputValue('rp_new_content').trim();
        session.newContent = newContent;
        pending.set(user.id, session);

        const destChannel = interaction.guild.channels.cache.get(session.destChannelId);

        const confirmEmbed = new EmbedBuilder()
          .setTitle('📤 Confirm & Send')
          .setColor(0xfee75c)
          .addFields(
            { name: '📢 Destination',    value: destChannel ? `${destChannel}` : `ID: ${session.destChannelId}`, inline: true },
            { name: '🖼️ Attachments',    value: session.originalMsg.attachments.size > 0 ? `${session.originalMsg.attachments.size} file(s)` : 'None', inline: true },
            { name: '📝 Updated Message', value: `\`\`\`\n${newContent.substring(0, 500)}\n\`\`\`` },
          );

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rp_confirm_send').setLabel('✅ Send').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('rp_cancel').setLabel('🗑️ Cancel').setStyle(ButtonStyle.Danger),
        );

        await interaction.update({ embeds: [confirmEmbed], components: [confirmRow] });
        return;
      }

    } catch (error) {
      logger.error('repost modal error:', error);
      await handleInteractionError(interaction, error, { subtype: 'repost_failed' });
    }
  },
};

function expiredReply(interaction) {
  return InteractionHelper.universalReply(interaction, {
    content: '⏱️ Session expired. Run `/repost` again.',
    ephemeral: true,
  });
}

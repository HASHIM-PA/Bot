import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDelay(delayInput) {
  if (!delayInput) return 0;
  const match = delayInput.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new TitanBotError(
      `Invalid delay format: "${delayInput}"`,
      ErrorTypes.VALIDATION,
      '⚠️ Invalid delay format. Use `10s`, `5m`, or `2h`.',
      { delayInput }
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 's') return value * 1000;
  if (unit === 'm') return value * 60 * 1000;
  if (unit === 'h') return value * 60 * 60 * 1000;
  return 0;
}

function getRoles(interaction) {
  return ['role1', 'role2', 'role3', 'role4', 'role5']
    .map(k => interaction.options.getRole(k))
    .filter(Boolean);
}

async function checkPermission(interaction, targetChannel) {
  if (!targetChannel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
    throw new TitanBotError(
      `Missing SendMessages in ${targetChannel.id}`,
      ErrorTypes.PERMISSION,
      `⚠️ I don't have permission to send messages in ${targetChannel}.`,
      { channelId: targetChannel.id }
    );
  }
}

async function deliverMessage(targetChannel, messageText, roles, fileSource) {
  const roleMentions = roles.map(r => r.toString()).join(' ');
  const fullContent  = roleMentions ? `${messageText}\n${roleMentions}` : messageText;
  const payload      = { content: fullContent };
  if (fileSource) payload.files = [fileSource]; // works for both URL string and attachment URL
  await targetChannel.send(payload);
}

async function replyWithResult(interaction, delayInput, delayMs, targetChannel) {
  if (delayMs > 0) {
    await interaction.reply({ content: `⏳ Scheduled to ${targetChannel} in **${delayInput}**.`, ephemeral: true });
  } else {
    await interaction.reply({ content: `✅ Sent to ${targetChannel}!`, ephemeral: true });
  }
}

async function handleError(interaction, error) {
  logger.error('Error in /send command', { error: error.message, stack: error.stack });
  const msg = error.userMessage ?? '❌ Something went wrong. Please try again.';
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content: msg, ephemeral: true });
  } else {
    await interaction.reply({ content: msg, ephemeral: true });
  }
}

// ─── Subcommand handlers ──────────────────────────────────────────────────────

async function handleInline(interaction) {
  const targetChannel = interaction.options.getChannel('channel');
  const rawMessage    = interaction.options.getString('message');
  const image         = interaction.options.getAttachment('image');
  const delayInput    = interaction.options.getString('delay');

  // Convert | to real newlines
  const messageText = rawMessage.split('|').map(s => s.trim()).join('\n');
  const roles       = getRoles(interaction);

  try {
    const delayMs = parseDelay(delayInput);
    await checkPermission(interaction, targetChannel);

    if (delayMs > 0) {
      setTimeout(() => deliverMessage(targetChannel, messageText, roles, image?.url), delayMs);
    } else {
      await deliverMessage(targetChannel, messageText, roles, image?.url);
    }

    await replyWithResult(interaction, delayInput, delayMs, targetChannel);
    logger.info('/send inline delivered', { guildId: interaction.guildId, userId: interaction.user.id, channelId: targetChannel.id });

  } catch (error) {
    await handleError(interaction, error);
  }
}

async function handleForm(interaction) {
  const targetChannel = interaction.options.getChannel('channel');
  const imageUrl      = interaction.options.getString('image_url');
  const delayInput    = interaction.options.getString('delay');
  const roles         = getRoles(interaction);

  let delayMs = 0;
  try {
    delayMs = parseDelay(delayInput);
    await checkPermission(interaction, targetChannel);
  } catch (error) {
    return interaction.reply({ content: error.userMessage ?? '❌ Error.', ephemeral: true });
  }

  // Show modal
  const modal = new ModalBuilder()
    .setCustomId(`send_modal_${interaction.id}`)
    .setTitle('Write your message');

  const messageInput = new TextInputBuilder()
    .setCustomId('messageText')
    .setLabel('Message')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Type your message here...\nPress Enter for new lines!')
    .setRequired(true)
    .setMaxLength(2000);

  modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
  await interaction.showModal(modal);

  // Wait for submission
  let modalInteraction;
  try {
    modalInteraction = await interaction.awaitModalSubmit({
      filter: i => i.customId === `send_modal_${interaction.id}` && i.user.id === interaction.user.id,
      time: 5 * 60 * 1000
    });
  } catch {
    return; // User dismissed or timed out
  }

  const messageText = modalInteraction.fields.getTextInputValue('messageText');

  try {
    if (delayMs > 0) {
      setTimeout(() => deliverMessage(targetChannel, messageText, roles, imageUrl), delayMs);
    } else {
      await deliverMessage(targetChannel, messageText, roles, imageUrl);
    }

    await replyWithResult(modalInteraction, delayInput, delayMs, targetChannel);
    logger.info('/send form delivered', { guildId: interaction.guildId, userId: interaction.user.id, channelId: targetChannel.id });

  } catch (error) {
    await handleError(modalInteraction, error);
  }
}

// ─── Command definition ───────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a message to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // ── Subcommand: inline (/send inline)
    .addSubcommand(sub =>
      sub
        .setName('inline')
        .setDescription('Quick send — use | for line breaks (e.g. line1 | line2 | line3)')
        .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Message — use | for new lines').setRequired(true))
        .addRoleOption(o => o.setName('role1').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role2').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role3').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role4').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role5').setDescription('Role to mention').setRequired(false))
        .addAttachmentOption(o => o.setName('image').setDescription('Optional image attachment').setRequired(false))
        .addStringOption(o => o.setName('delay').setDescription('Delay e.g. 10s, 5m, 2h').setRequired(false))
    )

    // ── Subcommand: form (/send form)
    .addSubcommand(sub =>
      sub
        .setName('form')
        .setDescription('Open a popup form to write a multiline message')
        .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
        .addRoleOption(o => o.setName('role1').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role2').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role3').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role4').setDescription('Role to mention').setRequired(false))
        .addRoleOption(o => o.setName('role5').setDescription('Role to mention').setRequired(false))
        .addStringOption(o => o.setName('image_url').setDescription('Optional image URL').setRequired(false))
        .addStringOption(o => o.setName('delay').setDescription('Delay e.g. 10s, 5m, 2h').setRequired(false))
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'inline') return handleInline(interaction);
    if (subcommand === 'form')   return handleForm(interaction);
  }
};

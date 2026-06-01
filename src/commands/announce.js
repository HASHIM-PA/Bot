import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
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

// ─── Command ─────────────────────────────────────────────────────────────────

export default {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a message to a channel with optional role mentions, image, and delay')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('The channel to send the message to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The text message to send')
        .setRequired(true)
    )
    // Up to 5 role mentions
    .addRoleOption(option =>
      option.setName('role1').setDescription('Role to mention').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role2').setDescription('Role to mention').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role3').setDescription('Role to mention').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role4').setDescription('Role to mention').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role5').setDescription('Role to mention').setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Optional image to attach')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('delay')
        .setDescription('Delay before sending — e.g. 10s, 5m, 2h (leave empty to send now)')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel');
    const messageText   = interaction.options.getString('message');
    const image         = interaction.options.getAttachment('image');
    const delayInput    = interaction.options.getString('delay');

    // Collect all provided roles
    const roles = ['role1', 'role2', 'role3', 'role4', 'role5']
      .map(key => interaction.options.getRole(key))
      .filter(Boolean);

    try {
      const delayMs = parseDelay(delayInput);

      // Check bot permissions
      const botMember = interaction.guild.members.me;
      if (!targetChannel.permissionsFor(botMember).has(PermissionFlagsBits.SendMessages)) {
        throw new TitanBotError(
          `Bot lacks SendMessages permission in channel ${targetChannel.id}`,
          ErrorTypes.PERMISSION,
          `⚠️ I don't have permission to send messages in ${targetChannel}.`,
          { channelId: targetChannel.id }
        );
      }

      const sendMessage = async () => {
        // Build role mentions string, e.g. "@ADMINS @SELLER @MEMBERS"
        const roleMentions = roles.map(r => r.toString()).join(' ');

        // Final message: text first, then role mentions on a new line (like your example)
        const fullContent = roleMentions
          ? `${messageText}\n${roleMentions}`
          : messageText;

        const payload = { content: fullContent };
        if (image) payload.files = [image.url];

        await targetChannel.send(payload);

        logger.info('Send command delivered message', {
          guildId:   interaction.guildId,
          userId:    interaction.user.id,
          channelId: targetChannel.id,
          roles:     roles.map(r => r.name),
          hasImage:  !!image,
          delayed:   delayMs > 0,
          delay:     delayInput ?? 'none'
        });
      };

      if (delayMs > 0) {
        setTimeout(sendMessage, delayMs);

        logger.info('Send command scheduled', {
          guildId:   interaction.guildId,
          userId:    interaction.user.id,
          channelId: targetChannel.id,
          delayMs
        });

        await interaction.reply({
          content: `⏳ Message scheduled to ${targetChannel} in **${delayInput}**.`,
          ephemeral: true
        });
      } else {
        await sendMessage();
        await interaction.reply({
          content: `✅ Message sent to ${targetChannel}!`,
          ephemeral: true
        });
      }

    } catch (error) {
      logger.error('Error in /send command', {
        error:     error.message,
        stack:     error.stack,
        guildId:   interaction.guildId,
        userId:    interaction.user.id,
        channelId: targetChannel?.id
      });

      const userMessage = error.userMessage ?? '❌ Something went wrong. Please try again.';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: userMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: userMessage, ephemeral: true });
      }
    }
  }
};

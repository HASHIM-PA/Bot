import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';


// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parses a delay string like "10s", "5m", "2h" into milliseconds.
 * Returns 0 if no delay given, or throws TitanBotError for bad format.
 */
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
    .setName('announce')
    .setDescription('Send an announcement to a channel with optional styling & delay')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('The channel to send the announcement to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('The announcement title')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The announcement content')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('color')
        .setDescription('Embed color (hex code without #, e.g. FF0000 for red)')
        .setRequired(false)
    )
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Optional image to attach to the announcement')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('delay')
        .setDescription('Delay before sending — e.g. 10s, 5m, 2h (leave empty to send now)')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('ping')
        .setDescription('Ping @everyone with the announcement')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),


  async execute(interaction) {
    const targetChannel = interaction.options.getChannel('channel');
    const title         = interaction.options.getString('title');
    const messageText   = interaction.options.getString('message');
    const colorInput    = interaction.options.getString('color');
    const image         = interaction.options.getAttachment('image');
    const delayInput    = interaction.options.getString('delay');
    const shouldPing    = interaction.options.getBoolean('ping') ?? false;

    try {
      // ── Validate delay ──────────────────────────────────────────────────
      const delayMs = parseDelay(delayInput);

      // ── Validate color hex ──────────────────────────────────────────────
      let embedColor = null;
      if (colorInput) {
        if (!/^[0-9A-Fa-f]{6}$/.test(colorInput)) {
          throw new TitanBotError(
            `Invalid color format: "${colorInput}"`,
            ErrorTypes.VALIDATION,
            '⚠️ Invalid color format. Use a hex code without # (e.g., FF0000).',
            { colorInput }
          );
        }
        embedColor = colorInput;
      }

      // ── Check bot permissions in target channel ─────────────────────────
      const botMember = interaction.guild.members.me;
      if (!targetChannel.permissionsFor(botMember).has(PermissionFlagsBits.SendMessages)) {
        throw new TitanBotError(
          `Bot lacks SendMessages permission in channel ${targetChannel.id}`,
          ErrorTypes.PERMISSION,
          `⚠️ I don't have permission to send messages in ${targetChannel}.`,
          { channelId: targetChannel.id }
        );
      }

      // ── Build the announcement embed ────────────────────────────────────
      const sendAnnouncement = async () => {
        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(messageText)
          .setTimestamp();

        if (embedColor) {
          embed.setColor(parseInt(embedColor, 16));
        } else {
          embed.setColor(0x5865F2); // Discord blue as default
        }

        if (image) {
          embed.setImage(image.url);
        }

        const payload = {
          embeds: [embed],
          content: shouldPing ? '@everyone' : ''
        };

        // Remove empty content field
        if (!payload.content) delete payload.content;

        await targetChannel.send(payload);

        logger.info('Announce command delivered announcement', {
          guildId:   interaction.guildId,
          userId:    interaction.user.id,
          channelId: targetChannel.id,
          title,
          hasImage:  !!image,
          hasColor:  !!embedColor,
          delayed:   delayMs > 0,
          pinged:    shouldPing,
          delay:     delayInput ?? 'none'
        });
      };

      // ── Send now or schedule ────────────────────────────────────────────
      if (delayMs > 0) {
        setTimeout(sendAnnouncement, delayMs);

        logger.info('Announce command scheduled', {
          guildId:   interaction.guildId,
          userId:    interaction.user.id,
          channelId: targetChannel.id,
          delayMs
        });

        await interaction.reply({
          content: `⏳ Announcement scheduled to ${targetChannel} in **${delayInput}**.`,
          ephemeral: true
        });

      } else {
        await sendAnnouncement();

        await interaction.reply({
          content: `✅ Announcement sent to ${targetChannel}!`,
          ephemeral: true
        });
      }

    } catch (error) {
      logger.error('Error in /announce command', {
        error:     error.message,
        stack:     error.stack,
        guildId:   interaction.guildId,
        userId:    interaction.user.id,
        channelId: targetChannel?.id
      });

      // Show user-friendly message from TitanBotError, or a generic fallback
      const userMessage = error.userMessage ?? '❌ Something went wrong. Please try again.';

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: userMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: userMessage, ephemeral: true });
      }
    }
  }
};

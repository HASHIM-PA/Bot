import {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

// ── Channel type definitions ──────────────────────────────────────────────────
const CHANNEL_TYPES = [
  {
    label: '💬 Text Channel',
    description: 'Standard text chat channel',
    value: 'GUILD_TEXT',
    type: ChannelType.GuildText,
    supportsSlowmode: true,
    supportsNSFW: true,
    supportsParent: true,
    supportsPosition: true,
    isThread: false,
    isCategory: false,
    private: false,
  },
  {
    label: '🔒 Private Text Channel',
    description: 'Text channel — hidden from @everyone',
    value: 'GUILD_TEXT_PRIVATE',
    type: ChannelType.GuildText,
    supportsSlowmode: true,
    supportsNSFW: true,
    supportsParent: true,
    supportsPosition: true,
    isThread: false,
    isCategory: false,
    private: true,
  },
  {
    label: '🔊 Voice Channel',
    description: 'Voice + video channel',
    value: 'GUILD_VOICE',
    type: ChannelType.GuildVoice,
    supportsSlowmode: false,
    supportsNSFW: false,
    supportsParent: true,
    supportsPosition: true,
    isThread: false,
    isCategory: false,
    private: false,
  },
  {
    label: '📢 Announcement Channel',
    description: 'Publish messages to followers',
    value: 'GUILD_ANNOUNCEMENT',
    type: ChannelType.GuildAnnouncement,
    supportsSlowmode: false,
    supportsNSFW: true,
    supportsParent: true,
    supportsPosition: true,
    isThread: false,
    isCategory: false,
    private: false,
  },
  {
    label: '🗂️ Forum Channel',
    description: 'Threaded discussion board',
    value: 'GUILD_FORUM',
    type: ChannelType.GuildForum,
    supportsSlowmode: true,
    supportsNSFW: false,
    supportsParent: true,
    supportsPosition: true,
    isThread: false,
    isCategory: false,
    private: false,
  },
  {
    label: '🎭 Stage Channel',
    description: 'Speaker / audience stage',
    value: 'GUILD_STAGE_VOICE',
    type: ChannelType.GuildStageVoice,
    supportsSlowmode: false,
    supportsNSFW: false,
    supportsParent: true,
    supportsPosition: true,
    isThread: false,
    isCategory: false,
    private: false,
  },
  {
    label: '🗃️ Category',
    description: 'Group channels under a category header',
    value: 'GUILD_CATEGORY',
    type: ChannelType.GuildCategory,
    supportsSlowmode: false,
    supportsNSFW: false,
    supportsParent: false,
    supportsPosition: true,
    isThread: false,
    isCategory: true,
    private: false,
  },
  {
    label: '🧵 Thread (Public)',
    description: 'Public thread inside a text channel',
    value: 'GUILD_PUBLIC_THREAD',
    type: ChannelType.PublicThread,
    supportsSlowmode: true,
    supportsNSFW: false,
    supportsParent: true,
    supportsPosition: false,
    isThread: true,
    isCategory: false,
    private: false,
  },
  {
    label: '🔐 Thread (Private)',
    description: 'Private thread inside a text channel',
    value: 'GUILD_PRIVATE_THREAD',
    type: ChannelType.PrivateThread,
    supportsSlowmode: true,
    supportsNSFW: false,
    supportsParent: true,
    supportsPosition: false,
    isThread: true,
    isCategory: false,
    private: false,
  },
  {
    label: '📰 News Thread',
    description: 'Thread inside an announcement channel',
    value: 'GUILD_NEWS_THREAD',
    type: ChannelType.AnnouncementThread,
    supportsSlowmode: false,
    supportsNSFW: false,
    supportsParent: true,
    supportsPosition: false,
    isThread: true,
    isCategory: false,
    private: false,
  },
];

const SLOWMODE_OPTIONS = [
  { label: 'Off',        value: '0'     },
  { label: '5 seconds',  value: '5'     },
  { label: '10 seconds', value: '10'    },
  { label: '30 seconds', value: '30'    },
  { label: '1 minute',   value: '60'    },
  { label: '5 minutes',  value: '300'   },
  { label: '10 minutes', value: '600'   },
  { label: '1 hour',     value: '3600'  },
  { label: '6 hours',    value: '21600' },
];

// ── In-memory session store (keyed by userId) ─────────────────────────────────
const sessions = new Map();

function defaultSession() {
  return {
    name: '',
    topic: '',
    categoryId: null,
    channelTypeValue: null,
    allowedUsers: [],
    allowedRoles: [],
    deniedUsers: [],
    deniedRoles: [],
    slowmode: 0,
    nsfw: false,
    position: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getType(value) {
  return CHANNEL_TYPES.find((t) => t.value === value) ?? CHANNEL_TYPES[0];
}

function fmtSlowmode(sec) {
  if (!sec)       return 'Off';
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${sec / 60}m`;
  return `${sec / 3600}h`;
}

function fmtList(arr, prefix) {
  return arr.length ? arr.map((id) => `<${prefix}${id}>`).join(' ') : 'None';
}

function expiredReply(interaction) {
  return InteractionHelper.universalReply(interaction, {
    content: '⏱️ Session expired. Run `/createchannel` again.',
    ephemeral: true,
  });
}

// ── Page builders ─────────────────────────────────────────────────────────────
function buildExtrasPage(session) {
  const t = getType(session.channelTypeValue);

  const lines = [
    `**Type:** ${t.label}`,
    `**Name:** \`${session.name}\``,
  ];
  if (t.supportsSlowmode) lines.push(`**Slowmode:** ${fmtSlowmode(session.slowmode)}`);
  if (t.supportsNSFW)     lines.push(`**NSFW:** ${session.nsfw ? '✅ On' : '❌ Off'}`);
  if (t.supportsPosition) lines.push(`**Position:** ${session.position !== null ? `#${session.position}` : '_default_'}`);
  if (t.isThread)         lines.push(`**Parent Channel ID:** ${session.categoryId || '⚠️ _not set — required!_'}`);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Create Channel — Step 2: Settings')
    .setDescription(lines.join('\n'))
    .setColor(0xfee75c)
    .setFooter({ text: 'All settings are optional except thread parent channel.' });

  const rows = [];

  if (t.supportsSlowmode) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('cc_slowmode_select')
        .setPlaceholder('⏱️ Set slowmode…')
        .addOptions(SLOWMODE_OPTIONS.map((o) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(o.label)
            .setValue(o.value)
            .setDefault(session.slowmode === parseInt(o.value))
        ))
    ));
  }

  const btns = [];
  if (t.supportsNSFW)
    btns.push(new ButtonBuilder()
      .setCustomId('cc_nsfw_toggle')
      .setLabel(`NSFW: ${session.nsfw ? 'ON ✅' : 'OFF ❌'}`)
      .setStyle(session.nsfw ? ButtonStyle.Danger : ButtonStyle.Secondary));
  if (t.supportsPosition)
    btns.push(new ButtonBuilder()
      .setCustomId('cc_set_position')
      .setLabel('📌 Set Position')
      .setStyle(ButtonStyle.Secondary));
  if (t.isThread)
    btns.push(new ButtonBuilder()
      .setCustomId('cc_set_thread_parent')
      .setLabel('🔗 Set Parent Channel')
      .setStyle(ButtonStyle.Primary));

  btns.push(new ButtonBuilder()
    .setCustomId('cc_extras_next')
    .setLabel(t.isThread ? '✅ Create Thread' : 'Next: Permissions →')
    .setStyle(ButtonStyle.Success));
  btns.push(new ButtonBuilder()
    .setCustomId('cc_cancel')
    .setLabel('🗑️ Cancel')
    .setStyle(ButtonStyle.Danger));

  rows.push(new ActionRowBuilder().addComponents(btns));
  return { embeds: [embed], components: rows };
}

function buildPermsPage(session) {
  const t = getType(session.channelTypeValue);
  const fmt = (arr, p) => arr.length ? arr.map((id) => `<${p}${id}>`).join(' ') : '_(none)_';

  const embed = new EmbedBuilder()
    .setTitle('🔐 Create Channel — Step 3: Permissions')
    .setDescription(
      `**Type:** ${t.label} | **Name:** \`${session.name}\`\n\n` +
      'Add who **can** or **cannot** see this channel.\n' +
      'You can mention multiple users/roles at once. Press **✅ Create** when ready.'
    )
    .setColor(0x57f287)
    .addFields(
      { name: '👥 Allowed Users', value: fmt(session.allowedUsers, '@'),  inline: true },
      { name: '🏷️ Allowed Roles', value: fmt(session.allowedRoles, '@&'), inline: true },
      { name: '\u200b',           value: '\u200b',                         inline: true },
      { name: '🚫 Denied Users',  value: fmt(session.deniedUsers,  '@'),  inline: true },
      { name: '❌ Denied Roles',  value: fmt(session.deniedRoles,  '@&'), inline: true },
      { name: '\u200b',           value: '\u200b',                         inline: true },
    );

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cc_add_user') .setLabel('➕ Allow User') .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cc_add_role') .setLabel('➕ Allow Role') .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cc_deny_user').setLabel('🚫 Deny User') .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('cc_deny_role').setLabel('❌ Deny Role') .setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cc_create').setLabel('✅ Create Channel').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cc_cancel').setLabel('🗑️ Cancel')        .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function buildSuccessEmbed(channel, session, t, user) {
  return new EmbedBuilder()
    .setTitle('✅ Channel Created!')
    .setColor(0x57f287)
    .addFields(
      { name: 'Channel',          value: `${channel}`,                       inline: true  },
      { name: 'Type',             value: t.label,                             inline: true  },
      { name: 'Topic',            value: session.topic || '—',                inline: false },
      { name: '⏱️ Slowmode',      value: fmtSlowmode(session.slowmode),       inline: true  },
      { name: '🔞 NSFW',          value: session.nsfw ? 'Yes' : 'No',         inline: true  },
      { name: '📌 Position',      value: session.position !== null ? `#${session.position}` : 'Default', inline: true },
      { name: '👥 Allowed Users', value: fmtList(session.allowedUsers, '@'),  inline: true  },
      { name: '🏷️ Allowed Roles', value: fmtList(session.allowedRoles, '@&'), inline: true  },
      { name: '\u200b',           value: '\u200b',                             inline: true  },
      { name: '🚫 Denied Users',  value: fmtList(session.deniedUsers,  '@'),  inline: true  },
      { name: '❌ Denied Roles',  value: fmtList(session.deniedRoles,  '@&'), inline: true  },
      { name: '\u200b',           value: '\u200b',                             inline: true  },
    )
    .setFooter({ text: `Created by ${user.tag}` })
    .setTimestamp();
}

// ── Channel creation logic ────────────────────────────────────────────────────
async function doCreate(interaction, session) {
  const guild = interaction.guild;
  const t     = getType(session.channelTypeValue);

  // Threads
  if (t.isThread) {
    const parent = guild.channels.cache.get(session.categoryId);
    if (!parent) {
      await InteractionHelper.universalReply(interaction, {
        content: '❌ Parent channel not found. Make sure the ID is correct.',
        embeds: [], components: [],
      });
      return;
    }
    try {
      const thread = await parent.threads.create({
        name: session.name,
        type: t.type,
        rateLimitPerUser: session.slowmode || undefined,
      });
      await InteractionHelper.universalReply(interaction, {
        embeds: [buildSuccessEmbed(thread, session, t, interaction.user)],
        components: [],
      });
    } catch (err) {
      logger.error('createchannel thread error:', err);
      await handleInteractionError(interaction, err, { subtype: 'createchannel_failed' });
    }
    return;
  }

  // Normal channels + categories
  const overwrites = [];
  if (t.private || session.allowedUsers.length || session.allowedRoles.length)
    overwrites.push({ id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] });

  for (const id of session.allowedUsers)
    overwrites.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  for (const id of session.allowedRoles)
    overwrites.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  for (const id of session.deniedUsers)
    overwrites.push({ id, deny: [PermissionFlagsBits.ViewChannel] });
  for (const id of session.deniedRoles)
    overwrites.push({ id, deny: [PermissionFlagsBits.ViewChannel] });

  try {
    const channel = await guild.channels.create({
      name:                 session.name,
      type:                 t.type,
      topic:                session.topic || undefined,
      parent:               (!t.isCategory && session.categoryId) ? session.categoryId : undefined,
      nsfw:                 t.supportsNSFW ? session.nsfw : undefined,
      rateLimitPerUser:     t.supportsSlowmode ? session.slowmode : undefined,
      position:             session.position !== null ? session.position : undefined,
      permissionOverwrites: overwrites,
    });
    await InteractionHelper.universalReply(interaction, {
      embeds: [buildSuccessEmbed(channel, session, t, interaction.user)],
      components: [],
    });
  } catch (err) {
    logger.error('createchannel error:', err);
    await handleInteractionError(interaction, err, { subtype: 'createchannel_failed' });
  }
}

// ── Exported command ──────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('createchannel')
    .setDescription('Create any type of channel or category with full controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) =>
      o.setName('name')
        .setDescription('Channel / category name')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('topic')
        .setDescription('Topic or description (text & announcement channels)')
        .setRequired(false)
    )
    .addChannelOption((o) =>
      o.setName('category')
        .setDescription('Parent category to place the channel in (optional)')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    ),

  category: 'admin',

  // ── Step 1: command executed ───────────────────────────────────────────────
  async execute(interaction, config, client) {
    try {
      const rawName = interaction.options.getString('name');
      const name    = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '');
      const topic   = interaction.options.getString('topic') ?? '';
      const cat     = interaction.options.getChannel('category') ?? null;

      const session      = defaultSession();
      session.name       = name;
      session.topic      = topic;
      session.categoryId = cat?.id ?? null;
      sessions.set(interaction.user.id, session);

      const embed = new EmbedBuilder()
        .setTitle('📁 Create Channel — Step 1: Choose Type')
        .setDescription(
          `**Name:** \`${name}\`\n` +
          (topic ? `**Topic:** ${topic}\n` : '') +
          (cat   ? `**Category:** ${cat.name}\n` : '') +
          '\nSelect a channel type from the dropdown below.'
        )
        .setColor(0x5865f2);

      const typeRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('cc_type_select')
          .setPlaceholder('Select channel type…')
          .setMinValues(1).setMaxValues(1)
          .addOptions(
            CHANNEL_TYPES.map((t) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(t.label)
                .setDescription(t.description)
                .setValue(t.value)
            )
          )
      );

      await InteractionHelper.universalReply(interaction, {
        embeds: [embed],
        components: [typeRow],
        ephemeral: true,
      });
    } catch (error) {
      logger.error('createchannel execute error:', error);
      await handleInteractionError(interaction, error, { subtype: 'createchannel_failed' });
    }
  },

  // ── Button / select menu handler (called from interactions.js) ────────────
  async handleComponent(interaction) {
    const { customId, user } = interaction;
    const session = sessions.get(user.id);

    try {
      // Type selected
      if (customId === 'cc_type_select') {
        if (!session) return expiredReply(interaction);
        session.channelTypeValue = interaction.values[0];
        sessions.set(user.id, session);

        const t = getType(session.channelTypeValue);
        const hasExtras = t.supportsSlowmode || t.supportsNSFW || t.supportsPosition || t.isThread;

        if (!hasExtras) {
          await interaction.update(buildPermsPage(session));
        } else {
          await interaction.update(buildExtrasPage(session));
        }
        return;
      }

      // Slowmode
      if (customId === 'cc_slowmode_select') {
        if (!session) return expiredReply(interaction);
        session.slowmode = parseInt(interaction.values[0]);
        sessions.set(user.id, session);
        await interaction.update(buildExtrasPage(session));
        return;
      }

      // NSFW toggle
      if (customId === 'cc_nsfw_toggle') {
        if (!session) return expiredReply(interaction);
        session.nsfw = !session.nsfw;
        sessions.set(user.id, session);
        await interaction.update(buildExtrasPage(session));
        return;
      }

      // Set position modal
      if (customId === 'cc_set_position') {
        if (!session) return expiredReply(interaction);
        const modal = new ModalBuilder().setCustomId('cc_modal_position').setTitle('Set Channel Position');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('cc_input')
            .setLabel('Position number (0 = top of list)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 2')
            .setRequired(true)
        ));
        await interaction.showModal(modal);
        return;
      }

      // Set thread parent modal
      if (customId === 'cc_set_thread_parent') {
        if (!session) return expiredReply(interaction);
        const modal = new ModalBuilder().setCustomId('cc_modal_thread_parent').setTitle('Parent Channel for Thread');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('cc_input')
            .setLabel('Paste the parent channel ID')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 123456789012345678')
            .setRequired(true)
        ));
        await interaction.showModal(modal);
        return;
      }

      // Extras next
      if (customId === 'cc_extras_next') {
        if (!session) return expiredReply(interaction);
        const t = getType(session.channelTypeValue);
        if (t.isThread) {
          await interaction.deferUpdate();
          await doCreate(interaction, session);
          sessions.delete(user.id);
        } else {
          await interaction.update(buildPermsPage(session));
        }
        return;
      }

      // Permission buttons
      if (['cc_add_user', 'cc_add_role', 'cc_deny_user', 'cc_deny_role'].includes(customId)) {
        if (!session) return expiredReply(interaction);
        const labels = {
          cc_add_user:  ['Allow Users',  'Mention or paste user IDs — space-separated'],
          cc_add_role:  ['Allow Roles',  'Mention or paste role IDs — space-separated'],
          cc_deny_user: ['Deny Users',   'Mention or paste user IDs to BLOCK'],
          cc_deny_role: ['Deny Roles',   'Mention or paste role IDs to BLOCK'],
        };
        const [title, placeholder] = labels[customId];
        const modal = new ModalBuilder().setCustomId(`cc_modal_${customId}`).setTitle(title);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('cc_input')
            .setLabel(placeholder.substring(0, 45))
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(placeholder)
            .setRequired(true)
        ));
        await interaction.showModal(modal);
        return;
      }

      // Cancel
      if (customId === 'cc_cancel') {
        sessions.delete(user.id);
        await interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
        return;
      }

      // Create
      if (customId === 'cc_create') {
        if (!session) return expiredReply(interaction);
        await interaction.deferUpdate();
        await doCreate(interaction, session);
        sessions.delete(user.id);
        return;
      }

    } catch (error) {
      logger.error('createchannel component error:', error);
      await handleInteractionError(interaction, error, { subtype: 'createchannel_failed' });
    }
  },

  // ── Modal handler (called from interactions.js) ───────────────────────────
  async handleModal(interaction) {
    const { customId, user } = interaction;
    const session = sessions.get(user.id);

    try {
      if (!session) {
        return InteractionHelper.universalReply(interaction, {
          content: '⏱️ Session expired. Run `/createchannel` again.',
          ephemeral: true,
        });
      }

      const raw = interaction.fields.getTextInputValue('cc_input').trim();

      if (customId === 'cc_modal_position') {
        const pos = parseInt(raw);
        if (!isNaN(pos) && pos >= 0) session.position = pos;
        sessions.set(user.id, session);
        await interaction.update(buildExtrasPage(session));
        return;
      }

      if (customId === 'cc_modal_thread_parent') {
        session.categoryId = raw.replace(/\D/g, '');
        sessions.set(user.id, session);
        await interaction.update(buildExtrasPage(session));
        return;
      }

      // Permission modals
      const ids = [...raw.matchAll(/<@[!&]?(\d+)>|(\d{17,20})/g)].map((m) => m[1] ?? m[2]);
      const guild = interaction.guild;
      const action = customId.replace('cc_modal_', '');

      for (const id of ids) {
        if (action === 'cc_add_user') {
          const m = await guild.members.fetch(id).catch(() => null);
          if (m && !session.allowedUsers.includes(id)) session.allowedUsers.push(id);
        } else if (action === 'cc_add_role') {
          const r = guild.roles.cache.get(id);
          if (r && !session.allowedRoles.includes(id)) session.allowedRoles.push(id);
        } else if (action === 'cc_deny_user') {
          const m = await guild.members.fetch(id).catch(() => null);
          if (m && !session.deniedUsers.includes(id)) session.deniedUsers.push(id);
        } else if (action === 'cc_deny_role') {
          const r = guild.roles.cache.get(id);
          if (r && !session.deniedRoles.includes(id)) session.deniedRoles.push(id);
        }
      }

      sessions.set(user.id, session);
      await interaction.update(buildPermsPage(session));

    } catch (error) {
      logger.error('createchannel modal error:', error);
      await handleInteractionError(interaction, error, { subtype: 'createchannel_failed' });
    }
  },
};

// ── Add to your /help command ─────────────────────────────────────────────────
// Paste the field below wherever your help embed adds fields.
// ─────────────────────────────────────────────────────────────────────────────

// ❶ If your help uses embed.addFields():
helpEmbed.addFields({
  name: "📁 `/createchannel`",
  value: [
    "`/createchannel name:<name> [topic:<text>] [category:<#cat>]`",
    "Creates any type of channel or category in the server.",
    "",
    "**Channel types:** 💬 Text · 🔒 Private Text · 🔊 Voice · 📢 Announcement",
    "　　　　　　　　🗂️ Forum · 🎭 Stage · 🗃️ Category",
    "　　　　　　　　🧵 Thread · 🔐 Private Thread · 📰 News Thread",
    "",
    "**Settings per type:**",
    "• ⏱️ Slowmode (text / forum / threads)",
    "• 🔞 NSFW toggle (text / announcement)",
    "• 📌 Position in channel list",
    "• 👥 Allow / 🚫 Deny specific users & roles (bulk via mention or ID)",
    "",
    "_Requires **Manage Channels** permission._",
  ].join("\n"),
  inline: false,
});


// ❷ If you keep a commands array and map() it to fields:
{
  name: "📁 /createchannel",
  usage: "/createchannel name:<name> [topic:<text>] [category:<#cat>]",
  description: "Create any channel type (text, voice, forum, stage, category, threads) with slowmode, NSFW, position, and bulk user/role permissions.",
  permission: "Manage Channels",
  category: "Admin",   // ← change to match your category label
}


// ── interactionCreate wiring ──────────────────────────────────────────────────
// In your main interactionCreate event add these blocks:

const createChannelCmd = require("./commands/createchannel"); // adjust path

client.on("interactionCreate", async (interaction) => {
  // ... your existing routing ...

  // Slash command
  if (interaction.isChatInputCommand() && interaction.commandName === "createchannel") {
    await createChannelCmd.execute(interaction);
    return;
  }

  // Buttons + Select Menus (all prefixed cc_)
  if (interaction.isMessageComponent() && interaction.customId.startsWith("cc_")) {
    await createChannelCmd.handleComponent(interaction);
    return;
  }

  // Modals
  if (interaction.isModalSubmit() && interaction.customId.startsWith("cc_modal_")) {
    await createChannelCmd.handleModal(interaction);
    return;
  }
});

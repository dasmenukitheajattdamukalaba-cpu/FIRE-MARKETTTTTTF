
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ================= CONFIG =================

const PREFIX = ""; // No prefix, no slash commands

// Highest role first, lowest role last
const PROMOTION_ROLES = [
  "1535921357991317544", // Head Admin
  "1535921160133287946", // Admin
  "1555582030274764852", // Head Mod
  "1535920366550122596",  // Mod
  "1535922877499445289"   // Helper
];

const warnings = new Map();

const COLORS = {
  red: 0xFF0000,
  green: 0x00FF00,
  blue: 0x0000FF
};

function embed(title, description, color = COLORS.blue) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

function getDuration(text) {
  const match = text?.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  const duration = amount * multipliers[unit];

  if (duration < 1000 || duration > 28 * 86400000) {
    return null;
  }

  return duration;
}

function hasStaffPermission(member) {
  return member.permissions.has([
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageRoles
  ]);
}

function getTarget(message) {
  return message.mentions.members.first() || null;
}

function getRole(message, args) {
  const mentionedRole = message.mentions.roles.first();
  if (mentionedRole) return mentionedRole;

  const possibleId = args.find(arg => /^\d{17,20}$/.test(arg));
  if (!possibleId) return null;

  return message.guild.roles.cache.get(possibleId) || null;
}

async function getPromotionRoles(guild) {
  const roles = [];

  for (const roleId of PROMOTION_ROLES) {
    const role = await guild.roles.fetch(roleId).catch(() => null);

    if (!role) {
      throw new Error(`Promotion role ID ${roleId} was not found.`);
    }

    roles.push(role);
  }

  if (new Set(roles.map(role => role.id)).size !== roles.length) {
    throw new Error("Duplicate role IDs are present in PROMOTION_ROLES.");
  }

  // Check that the Discord role hierarchy matches the configured order.
  for (let i = 0; i < roles.length - 1; i++) {
    if (roles[i].position <= roles[i + 1].position) {
      throw new Error(
        `Role hierarchy mismatch: ${roles[i].name} must be above ${roles[i + 1].name}.`
      );
    }
  }

  return roles;
}

// ================= READY =================

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= MESSAGE COMMANDS =================

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;

  const args = content.split(/\s+/);
  const command = args.shift().toLowerCase();

  // Help and ping are available to everyone.
  if (command === "ping") {
    return message.reply(
      `🏓 Pong! ${client.ws.ping}ms`
    );
  }

  if (command === "help") {
    const helpText = [
      "**BLACK FIRE BOT — COMMANDS**",
      "",
      "**General**",
      "`help` — Show commands",
      "`ping` — Check bot latency",
      "",
      "**Moderation**",
      "`ban @user [reason]`",
      "`kick @user [reason]`",
      "`timeout @user 10m [reason]`",
      "`mute @user 10m [reason]`",
      "`untimeout @user`",
      "`unmute @user`",
      "`warn @user [reason]`",
      "`warnings @user`",
      "`clearwarnings @user`",
      "`purge 10`",
      "`lock` / `unlock`",
      "",
      "**Roles**",
      "`role @user @role` — Add role",
      "`rrole @user @role` — Remove role",
      "`promote @user` — Promote one level",
      "`demote @user` — Demote one level",
      "",
      "Commands need the relevant Discord permissions."
    ].join("\n");

    return message.reply({
      embeds: [embed("🔥 BLACK FIRE BOT", helpText)]
    });
  }

  // All commands below require staff permissions.
  if (!hasStaffPermission(message.member)) return;

  const target = getTarget(message);
  const reason = args.slice(1).join(" ") || "No reason provided";

  try {
    // ================= BAN =================
    if (command === "ban") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return message.reply("❌ You need the Ban Members permission.");
      }

      if (!target) return message.reply("❌ Mention a member to ban.");
      if (!target.bannable) {
        return message.reply("❌ I cannot ban this member. Check role hierarchy and my permissions.");
      }

      await target.ban({ reason: `${reason} | By ${message.author.tag}` });
      return message.reply({
        embeds: [embed("🔨 Member Banned", `${target.user.tag}\nReason: ${reason}`, COLORS.red)]
      });
    }

    // ================= KICK =================
    if (command === "kick") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return message.reply("❌ You need the Kick Members permission.");
      }

      if (!target) return message.reply("❌ Mention a member to kick.");
      if (!target.kickable) {
        return message.reply("❌ I cannot kick this member. Check role hierarchy and my permissions.");
      }

      await target.kick(`${reason} | By ${message.author.tag}`);
      return message.reply({
        embeds: [embed("👢 Member Kicked", `${target.user.tag}\nReason: ${reason}`, COLORS.red)]
      });
    }

    // ================= TIMEOUT / MUTE =================
    if (["timeout", "mute"].includes(command)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("❌ You need the Moderate Members permission.");
      }

      if (!target) return message.reply("❌ Mention a member.");
      const duration = getDuration(args[1]);

      if (!duration) {
        return message.reply("❌ Use a duration like `10m`, `2h`, or `1d` (maximum 28 days).");
      }

      if (!target.moderatable) {
        return message.reply("❌ I cannot timeout this member. Check role hierarchy and permissions.");
      }

      const timeoutReason = args.slice(2).join(" ") || "No reason provided";

      await target.timeout(duration, `${timeoutReason} | By ${message.author.tag}`);

      return message.reply({
        embeds: [
          embed(
            "🔇 Member Timed Out",
            `${target.user.tag}\nDuration: ${args[1]}\nReason: ${timeoutReason}`,
            COLORS.red
          )
        ]
      });
    }

    // ================= REMOVE TIMEOUT =================
    if (["untimeout", "unmute"].includes(command)) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("❌ You need the Moderate Members permission.");
      }

      if (!target) return message.reply("❌ Mention a member.");
      if (!target.moderatable) {
        return message.reply("❌ I cannot remove this member's timeout. Check role hierarchy.");
      }

      await target.timeout(null, `Timeout removed by ${message.author.tag}`);
      return message.reply(`✅ Timeout removed for ${target.user.tag}.`);
    }

    // ================= WARN =================
    if (command === "warn") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("❌ You need the Moderate Members permission.");
      }

      if (!target) return message.reply("❌ Mention a member to warn.");

      const key = `${message.guild.id}:${target.id}`;
      const list = warnings.get(key) || [];

      list.push({
        reason: args.slice(1).join(" ") || "No reason provided",
        moderator: message.author.tag,
        date: new Date().toISOString()
      });

      warnings.set(key, list);

      return message.reply({
        embeds: [
          embed(
            "⚠️ Warning Issued",
            `Member: ${target.user.tag}\nWarnings this session: ${list.length}\nReason: ${list[list.length - 1].reason}`,
            COLORS.red
          )
        ]
      });
    }

    // ================= VIEW WARNINGS =================
    if (command === "warnings") {
      if (!target) return message.reply("❌ Mention a member.");

      const list = warnings.get(`${message.guild.id}:${target.id}`) || [];

      if (!list.length) {
        return message.reply(`✅ ${target.user.tag} has no warnings stored by this bot session.`);
      }

      const description = list
        .map((warning, index) =>
          `**${index + 1}.** ${warning.reason}\nModerator: ${warning.moderator}`
        )
        .join("\n\n");

      return message.reply({
        embeds: [embed(`⚠️ Warnings: ${target.user.tag}`, description, COLORS.red)]
      });
    }

    // ================= CLEAR WARNINGS =================
    if (command === "clearwarnings") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("❌ You need the Moderate Members permission.");
      }

      if (!target) return message.reply("❌ Mention a member.");

      warnings.delete(`${message.guild.id}:${target.id}`);
      return message.reply(`✅ Cleared this session's warnings for ${target.user.tag}.`);
    }

    // ================= PURGE =================
    if (command === "purge") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("❌ You need the Manage Messages permission.");
      }

      const amount = Number(args[0]);

      if (!Number.isInteger(amount) || amount < 1 || amount > 99) {
        return message.reply("❌ Use `purge 1` to `purge 99`.");
      }

      const deleted = await message.channel.bulkDelete(amount + 1, true);
      const reply = await message.channel.send(`🧹 Deleted ${Math.max(0, deleted.size - 1)} messages.`);

      setTimeout(() => reply.delete().catch(() => {}), 4000);
      return;
    }

    // ================= LOCK =================
    if (command === "lock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("❌ You need the Manage Channels permission.");
      }

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { SendMessages: false }
      );

      return message.reply("🔒 Channel locked.");
    }

    // ================= UNLOCK =================
    if (command === "unlock") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("❌ You need the Manage Channels permission.");
      }

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { SendMessages: null }
      );

      return message.reply("🔓 Channel unlocked.");
    }

    // ================= ADD ROLE =================
    if (command === "role") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return message.reply("❌ You need the Manage Roles permission.");
      }

      if (!target) return message.reply("❌ Mention a member.");
      const role = getRole(message, args);

      if (!role) return message.reply("❌ Mention the role or provide its role ID.");
      if (role.managed || role.position >= message.guild.members.me.roles.highest.position) {
        return message.reply("❌ I cannot assign that role. Check the bot's role hierarchy.");
      }

      if (message.member.id !== message.guild.ownerId &&
          role.position >= message.member.roles.highest.position) {
        return message.reply("❌ You cannot assign a role equal to or above your highest role.");
      }

      await target.roles.add(role, `Role added by ${message.author.tag}`);
      return message.reply(`✅ Added **${role.name}** to ${target.user.tag}.`);
    }

    // ================= REMOVE ROLE =================
    if (command === "rrole") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return message.reply("❌ You need the Manage Roles permission.");
      }

      if (!target) return message.reply("❌ Mention a member.");
      const role = getRole(message, args);

      if (!role) return message.reply("❌ Mention the role or provide its role ID.");
      if (role.managed || role.position >= message.guild.members.me.roles.highest.position) {
        return message.reply("❌ I cannot remove that role. Check the bot's role hierarchy.");
      }

      if (message.member.id !== message.guild.ownerId &&
          role.position >= message.member.roles.highest.position) {
        return message.reply("❌ You cannot remove a role equal to or above your highest role.");
      }

      await target.roles.remove(role, `Role removed by ${message.author.tag}`);
      return message.reply(`✅ Removed **${role.name}** from ${target.user.tag}.`);
    }

    // ================= PROMOTE =================
    if (command === "promote") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return message.reply("❌ You need the Manage Roles permission.");
      }

      if (!target) return message.reply("❌ Mention the member to promote.");

      const roles = await getPromotionRoles(message.guild);

      if (message.guild.members.me.roles.highest.position <= roles[0].position) {
        return message.reply("❌ Move the bot's highest role above all five promotion roles.");
      }

      if (message.member.id !== message.guild.ownerId &&
          message.member.roles.highest.position <= roles[0].position) {
        return message.reply("❌ Your highest role must be above the promotion roles.");
      }

      const current = roles.filter(role => target.roles.cache.has(role.id));

      if (current.length !== 1) {
        return message.reply(
          `❌ ${target.user.tag} must have exactly one of the five promotion roles. Found: ${current.length}.`
        );
      }

      const index = roles.findIndex(role => role.id === current[0].id);

      if (index === 0) {
        return message.reply("❌ This member is already at the highest promotion role.");
      }

      const nextRole = roles[index - 1];

      if (nextRole.position >= message.guild.members.me.roles.highest.position) {
        return message.reply("❌ My highest role must be above the role I am assigning.");
      }

      if (message.guild.ownerId !== message.author.id &&
          nextRole.position >= message.member.roles.highest.position) {
        return message.reply("❌ You cannot promote someone to a role equal to or above your highest role.");
      }

      await target.roles.remove(current[0]);
      await target.roles.add(nextRole);

      return message.reply({
        embeds: [
          embed(
            "⬆️ Staff Promoted",
            `${target.user.tag}\n**${current[0].name}** → **${nextRole.name}**`,
            COLORS.green
          )
        ]
      });
    }

    // ================= DEMOTE =================
    if (command === "demote") {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return message.reply("❌ You need the Manage Roles permission.");
      }

      if (!target) return message.reply("❌ Mention the member to demote.");

      const roles = await getPromotionRoles(message.guild);

      if (message.guild.members.me.roles.highest.position <= roles[0].position) {
        return message.reply("❌ Move the bot's highest role above all five promotion roles.");
      }

      if (message.member.id !== message.guild.ownerId &&
          message.member.roles.highest.position <= roles[0].position) {
        return message.reply("❌ Your highest role must be above the promotion roles.");
      }

      const current = roles.filter(role => target.roles.cache.has(role.id));

      if (current.length !== 1) {
        return message.reply(
          `❌ ${target.user.tag} must have exactly one of the five promotion roles. Found: ${current.length}.`
        );
      }

      const index = roles.findIndex(role => role.id === current[0].id);

      if (index === roles.length - 1) {
        return message.reply("❌ This member is already at the lowest promotion role.");
      }

      const nextRole = roles[index + 1];

      if (nextRole.position >= message.guild.members.me.roles.highest.position) {
        return message.reply("❌ My highest role must be above the role I am assigning.");
      }

      if (message.guild.ownerId !== message.author.id &&
          nextRole.position >= message.member.roles.highest.position) {
        return message.reply("❌ You cannot demote someone to a role equal to or above your highest role.");
      }

      await target.roles.remove(current[0]);
      await target.roles.add(nextRole);

      return message.reply({
        embeds: [
          embed(
            "⬇️ Staff Demoted",
            `${target.user.tag}\n**${current[0].name}** → **${nextRole.name}**`,
            COLORS.red
          )
        ]
      });
    }

  } catch (error) {
    console.error(`Command "${command}" failed:`, error);

    const safeMessage = error.message?.includes("Promotion role ID")
      ? "❌ One of the configured promotion role IDs was not found in this server."
      : error.message?.includes("Role hierarchy mismatch")
        ? `❌ ${error.message}`
        : "❌ Command failed. Check the bot permissions, role hierarchy, and Railway logs.";

    return message.reply(safeMessage).catch(() => {});
  }
});

// ================= LOGIN =================

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing from Railway Variables.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("❌ Bot login failed. Check DISCORD_TOKEN in Railway Variables.", error);
  process.exit(1);
});
            

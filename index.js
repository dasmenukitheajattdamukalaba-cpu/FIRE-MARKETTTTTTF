
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const warnings = new Map();

const COLORS = {
  red: 0xff3030,
  green: 0x30ff80,
  blue: 0x3080ff
};

function replyEmbed(message, text, color = COLORS.blue) {
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(color)
        .setDescription(text)
        .setFooter({ text: "BLACK FIRE BOT" })
        .setTimestamp()
    ],
    allowedMentions: { repliedUser: false }
  });
}

function parseDuration(input) {
  const match = input.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const units = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  const duration = amount * units[match[2].toLowerCase()];
  return duration > 0 && duration <= 28 * 86400000
    ? duration
    : null;
}

async function getTarget(message, argument) {
  const id = argument?.match(/\d{17,20}/)?.[0];
  if (!id) return null;

  return message.guild.members.fetch(id).catch(() => null);
}

async function getRole(message, argument) {
  const id = argument?.match(/\d{17,20}/)?.[0];
  if (!id) return null;

  return message.guild.roles.fetch(id).catch(() => null);
}

client.once("ready", () => {
  console.log(`🔥 BLACK FIRE BOT online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  const args = content.split(/\s+/);
  const command = args[0].toLowerCase();

  const commands = [
    "help", "ping", "ban", "kick", "timeout", "mute",
    "untimeout", "unmute", "warn", "warnings", "clearwarnings",
    "purge", "lock", "unlock", "role", "rrole"
  ];

  if (!commands.includes(command)) return;

  try {
    // HELP COMMAND
    if (command === "help") {
      const help = new EmbedBuilder()
        .setColor(COLORS.red)
        .setTitle("🔥 BLACK FIRE BOT — HELP MENU")
        .setDescription(
          "Welcome to Black Fire Bot!\n" +
          "All commands work without a prefix or slash.\n\n" +
          "━━━━━━━━━━━━━━━━━━"
        )
        .addFields(
          {
            name: "⚙️ General Commands",
            value:
              "`help` — Show all commands\n" +
              "`ping` — Check bot latency"
          },
          {
            name: "🛡️ Moderation",
            value:
              "`ban @user [reason]` — Ban a member\n" +
              "`kick @user [reason]` — Kick a member\n" +
              "`timeout @user 10m [reason]` — Timeout\n" +
              "`mute @user 10m [reason]` — Timeout alias\n" +
              "`untimeout @user` — Remove timeout\n" +
              "`unmute @user` — Remove timeout\n" +
              "`warn @user [reason]` — Warn a member\n" +
              "`warnings @user` — View warnings\n" +
              "`clearwarnings @user` — Clear warnings"
          },
          {
            name: "🧹 Channel Management",
            value:
              "`purge 10` — Delete recent messages\n" +
              "`lock` — Lock current channel\n" +
              "`unlock` — Unlock current channel"
          },
          {
            name: "🎭 Role Management",
            value:
              "`role @user @role` — Give a role\n" +
              "`rrole @user @role` — Remove a role"
          },
          {
            name: "⏱️ Duration Format",
            value:
              "`30s` — 30 seconds\n" +
              "`10m` — 10 minutes\n" +
              "`2h` — 2 hours\n" +
              "`1d` — 1 day\n" +
              "Maximum timeout: 28 days"
          }
        )
        .setFooter({
          text: "BLACK FIRE BOT • Use commands responsibly"
        })
        .setTimestamp();

      return message.reply({
        embeds: [help],
        allowedMentions: { repliedUser: false }
      });
    }

    if (command === "ping") {
      return replyEmbed(
        message,
        `🏓 Pong! API latency: ${client.ws.ping}ms`,
        COLORS.green
      );
    }

    const member = message.member;
    const botMember = message.guild.members.me;

    const requirePermission = (permission) => {
      if (!member.permissions.has(permission)) {
        replyEmbed(message, "❌ You don't have permission to do that.", COLORS.red);
        return false;
      }
      return true;
    };

    const requireBotPermission = (permission) => {
      if (!botMember.permissions.has(permission)) {
        replyEmbed(message, "❌ I don't have the required server permission.", COLORS.red);
        return false;
      }
      return true;
    };

    const permissionMap = {
      ban: PermissionsBitField.Flags.BanMembers,
      kick: PermissionsBitField.Flags.KickMembers,
      timeout: PermissionsBitField.Flags.ModerateMembers,
      mute: PermissionsBitField.Flags.ModerateMembers,
      untimeout: PermissionsBitField.Flags.ModerateMembers,
      unmute: PermissionsBitField.Flags.ModerateMembers,
      warn: PermissionsBitField.Flags.ModerateMembers,
      warnings: PermissionsBitField.Flags.ModerateMembers,
      clearwarnings: PermissionsBitField.Flags.ModerateMembers,
      purge: PermissionsBitField.Flags.ManageMessages,
      lock: PermissionsBitField.Flags.ManageChannels,
      unlock: PermissionsBitField.Flags.ManageChannels,
      role: PermissionsBitField.Flags.ManageRoles,
      rrole: PermissionsBitField.Flags.ManageRoles
    };

    if (permissionMap[command]) {
      if (!requirePermission(permissionMap[command])) return;
    }

    if ([
      "ban", "kick", "timeout", "mute", "untimeout", "unmute",
      "warn", "warnings", "clearwarnings", "role", "rrole"
    ].includes(command)) {
      const target = await getTarget(message, args[1]);

      if (!target) {
        return replyEmbed(message, "❌ Mention a valid server member.", COLORS.red);
      }

      if (target.id === message.author.id || target.id === client.user.id) {
        return replyEmbed(message, "❌ You cannot target yourself or the bot.", COLORS.red);
      }

      if (
        target.roles.highest.position >= member.roles.highest.position &&
        message.guild.ownerId !== message.author.id
      ) {
        return replyEmbed(message, "❌ Your highest role must be above the target's role.", COLORS.red);
      }

      if (target.roles.highest.position >= botMember.roles.highest.position) {
        return replyEmbed(message, "❌ My highest role must be above the target's role.", COLORS.red);
      }

      const reason = args.slice(2).join(" ") || "No reason provided";

      if (command === "ban") {
        if (!requireBotPermission(PermissionsBitField.Flags.BanMembers)) return;
        await target.ban({ reason: `${reason} | By ${message.author.tag}` });
        return replyEmbed(message, `🔨 Banned **${target.user.tag}**.\nReason: ${reason}`, COLORS.green);
      }

      if (command === "kick") {
        if (!requireBotPermission(PermissionsBitField.Flags.KickMembers)) return;
        await target.kick(`${reason} | By ${message.author.tag}`);
        return replyEmbed(message, `👢 Kicked **${target.user.tag}**.\nReason: ${reason}`, COLORS.green);
      }

      if (["timeout", "mute"].includes(command)) {
        if (!requireBotPermission(PermissionsBitField.Flags.ModerateMembers)) return;

        const duration = parseDuration(args[2] || "");
        if (!duration) {
          return replyEmbed(message, "❌ Usage: `timeout @user 10m reason` (maximum 28 days).", COLORS.red);
        }

        const timeoutReason = args.slice(3).join(" ") || "No reason provided";
        await target.timeout(duration, `${timeoutReason} | By ${message.author.tag}`);
        return replyEmbed(message, `🔇 Timed out **${target.user.tag}** for **${args[2]}**.\nReason: ${timeoutReason}`, COLORS.green);
      }

      if (["untimeout", "unmute"].includes(command)) {
        if (!requireBotPermission(PermissionsBitField.Flags.ModerateMembers)) return;
        await target.timeout(null, `Timeout removed by ${message.author.tag}`);
        return replyEmbed(message, `🔊 Timeout removed for **${target.user.tag}**.`, COLORS.green);
      }

      if (command === "warn") {
        const key = `${message.guild.id}:${target.id}`;
        const list = warnings.get(key) || [];

        list.push({
          reason,
          moderator: message.author.tag,
          date: new Date().toISOString()
        });

        warnings.set(key, list);
        return replyEmbed(message, `⚠️ **${target.user.tag}** has ${list.length} warning(s).\nReason: ${reason}`, COLORS.green);
      }

      if (command === "warnings") {
        const list = warnings.get(`${message.guild.id}:${target.id}`) || [];
        const description = list.length
          ? list.map((w, i) => `**${i + 1}.** ${w.reason} — ${w.moderator}`).join("\n")
          : "No warnings found.";

        return replyEmbed(message, `Warnings for **${target.user.tag}**:\n${description}`);
      }

      if (command === "clearwarnings") {
        warnings.delete(`${message.guild.id}:${target.id}`);
        return replyEmbed(message, `🧹 Warnings cleared for **${target.user.tag}**.`, COLORS.green);
      }

      if (command === "role" || command === "rrole") {
        if (!requireBotPermission(PermissionsBitField.Flags.ManageRoles)) return;

        const role = await getRole(message, args[2]);
        if (!role) {
          return replyEmbed(message, "❌ Usage: `role @user @role` or `rrole @user @role`", COLORS.red);
        }

        if (
          role.managed ||
          role.id === message.guild.id ||
          role.position >= botMember.roles.highest.position
        ) {
          return replyEmbed(message, "❌ I cannot manage that role. Check its position.", COLORS.red);
        }

        if (command === "role") {
          await target.roles.add(role, `Role added by ${message.author.tag}`);
          return replyEmbed(message, `✅ Added **${role.name}** to **${target.user.tag}**.`, COLORS.green);
        }

        await target.roles.remove(role, `Role removed by ${message.author.tag}`);
        return replyEmbed(message, `✅ Removed **${role.name}** from **${target.user.tag}**.`, COLORS.green);
      }
    }

    if (command === "purge") {
      if (!requireBotPermission(PermissionsBitField.Flags.ManageMessages)) return;

      const amount = Number(args[1]);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        return replyEmbed(message, "❌ Usage: `purge 1-100`", COLORS.red);
      }

      const deleted = await message.channel.bulkDelete(amount, true);
      const confirmation = await message.channel.send(`🧹 Deleted ${deleted.size} message(s).`);
      setTimeout(() => confirmation.delete().catch(() => {}), 5000);
      return;
    }

    if (command === "lock" || command === "unlock") {
      if (!requireBotPermission(PermissionsBitField.Flags.ManageChannels)) return;

      const canSend = command === "unlock";

      await message.channel.permissionOverwrites.edit(
        message.guild.roles.everyone,
        { SendMessages: canSend ? null : false }
      );

      return replyEmbed(
        message,
        canSend ? "🔓 Channel unlocked." : "🔒 Channel locked.",
        COLORS.green
      );
    }
  } catch (error) {
    console.error("Command error:", error);

    if (error.code === 50013) {
      return replyEmbed(message, "❌ Missing permissions or role hierarchy issue.", COLORS.red);
    }

    return replyEmbed(message, "❌ Command failed. Check Railway logs.", COLORS.red);
  }
});

client.on("error", error => console.error("Discord client error:", error));
process.on("unhandledRejection", error => console.error("Unhandled rejection:", error));

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing from Railway Variables.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error("❌ Discord login failed:", error.message);
  process.exit(1);
});
      

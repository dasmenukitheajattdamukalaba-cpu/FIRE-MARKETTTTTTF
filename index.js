
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

// Warnings reset when the bot restarts.
const warnings = new Map();

const COLORS = {
  red: 0xff3030,
  green: 0x30ff80,
  blue: 0x3080ff
};

// Promotion track: HIGHEST to LOWEST.
const PROMOTION_TRACK_ROLE_NAMES = [
  "🍷HEAD ADMIN🍷",
  "💫ADMIN💫",
  "HEAD MODERATOR☠️",
  "🛠️MODERATOR🛠️",
  "🌛 HELPER",
  "Ticket handler 🎟️",
  "STAFF ⚕️"
];

const COMMANDS = [
  "help", "ping", "ban", "kick", "timeout", "mute",
  "untimeout", "unmute", "warn", "warnings", "clearwarnings",
  "purge", "lock", "unlock", "role", "rrole",
  "promote", "demote"
];

const STAFF_PERMISSIONS = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageRoles
];

function isStaff(member) {
  return STAFF_PERMISSIONS.some(permission =>
    member.permissions.has(permission)
  );
}

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

  return Number.isSafeInteger(duration) &&
    duration > 0 &&
    duration <= 28 * 86400000
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

function isGuildOwner(message) {
  return message.guild.ownerId === message.author.id;
}

function canManageTarget(message, target, botMember) {
  const member = message.member;

  if (target.id === message.guild.ownerId) return false;
  if (target.id === message.author.id) return false;
  if (target.id === client.user.id) return false;

  if (
    !isGuildOwner(message) &&
    target.roles.highest.comparePositionTo(member.roles.highest) >= 0
  ) {
    return false;
  }

  if (
    target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0
  ) {
    return false;
  }

  return true;
}

function getPromotionTrack(guild) {
  const track = [];

  for (const roleName of PROMOTION_TRACK_ROLE_NAMES) {
    const matches = guild.roles.cache.filter(
      role => role.name === roleName
    );

    if (matches.size !== 1) {
      return {
        error:
          `Role "${roleName}" was not found or its name is duplicated. ` +
          "Check the role names in index.js."
      };
    }

    const role = matches.first();

    if (role.managed || role.id === guild.id) {
      return {
        error: `Role "${roleName}" cannot be used in the promotion track.`
      };
    }

    track.push(role);
  }

  if (new Set(track.map(role => role.id)).size !== track.length) {
    return { error: "The promotion track contains duplicate roles." };
  }

  // Verify that the configured order matches Discord's hierarchy.
  for (let i = 0; i < track.length - 1; i++) {
    if (track[i].comparePositionTo(track[i + 1]) <= 0) {
      return {
        error:
          `Role order is incorrect: "${track[i].name}" must be above ` +
          `"${track[i + 1].name}" in Server Settings → Roles.`
      };
    }
  }

  return { track };
}

async function changeRank(message, target, direction, botMember) {
  if (!message.member.permissions.has(
    PermissionsBitField.Flags.ManageRoles
  )) {
    return replyEmbed(
      message,
      "❌ You need Manage Roles permission.",
      COLORS.red
    );
  }

  if (!botMember.permissions.has(
    PermissionsBitField.Flags.ManageRoles
  )) {
    return replyEmbed(
      message,
      "❌ I need Manage Roles permission.",
      COLORS.red
    );
  }

  if (!canManageTarget(message, target, botMember)) {
    return replyEmbed(
      message,
      "❌ Your role hierarchy or my role hierarchy prevents this action.",
      COLORS.red
    );
  }

  const result = getPromotionTrack(message.guild);

  if (result.error) {
    return replyEmbed(message, `❌ ${result.error}`, COLORS.red);
  }

  const track = result.track;

  const memberTrackRoles = track.filter(role =>
    target.roles.cache.has(role.id)
  );

  if (memberTrackRoles.length !== 1) {
    return replyEmbed(
      message,
      memberTrackRoles.length === 0
        ? "❌ This member has no role from the promotion track."
        : "❌ This member has multiple promotion-track roles. Fix their roles first.",
      COLORS.red
    );
  }

  const oldRole = memberTrackRoles[0];
  const oldIndex = track.findIndex(role => role.id === oldRole.id);

  const newIndex = direction === "promote"
    ? oldIndex - 1
    : oldIndex + 1;

  if (newIndex < 0 || newIndex >= track.length) {
    return replyEmbed(
      message,
      direction === "promote"
        ? "❌ This member already has the highest track role."
        : "❌ This member already has the lowest track role.",
      COLORS.red
    );
  }

  const newRole = track[newIndex];

  // Moderator must be above both roles unless they own the server.
  if (
    !isGuildOwner(message) &&
    (
      message.member.roles.highest.comparePositionTo(oldRole) <= 0 ||
      message.member.roles.highest.comparePositionTo(newRole) <= 0
    )
  ) {
    return replyEmbed(
      message,
      "❌ Your highest role must be above both roles involved.",
      COLORS.red
    );
  }

  // Bot must be above both roles.
  if (
    botMember.roles.highest.comparePositionTo(oldRole) <= 0 ||
    botMember.roles.highest.comparePositionTo(newRole) <= 0
  ) {
    return replyEmbed(
      message,
      "❌ Move my highest role above both promotion-track roles.",
      COLORS.red
    );
  }

  // Add the new role first.
  await target.roles.add(
    newRole,
    `${direction} by ${message.author.tag}`
  );

  try {
    await target.roles.remove(
      oldRole,
      `${direction} by ${message.author.tag}`
    );
  } catch (error) {
    // Best-effort rollback if the old role could not be removed.
    await target.roles.remove(newRole).catch(rollbackError => {
      console.error("Role rollback failed:", rollbackError);
    });

    throw error;
  }

  return replyEmbed(
    message,
    direction === "promote"
      ? `⬆️ **${target.user.tag}** has been promoted from **${oldRole.name}** to **${newRole.name}**.`
      : `⬇️ **${target.user.tag}** has been demoted from **${oldRole.name}** to **${newRole.name}**.`,
    COLORS.green
  );
}

client.once("ready", () => {
  console.log(`🔥 BLACK FIRE BOT online as ${client.user.tag}`);
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;

  // Prefix-free commands: first word is the command.
  const args = content.split(/\s+/);
  const command = args[0].toLowerCase();

  if (!COMMANDS.includes(command)) return;

  // Ordinary members receive no command or permission-error replies.
  if (!isStaff(message.member)) return;

  try {
    const member = message.member;
    const botMember = message.guild.members.me;

    if (!botMember) return;

    const requirePermission = permission => {
      if (!member.permissions.has(permission)) {
        replyEmbed(
          message,
          "❌ You don't have permission to do that.",
          COLORS.red
        );
        return false;
      }

      return true;
    };

    const requireBotPermission = permission => {
      if (!botMember.permissions.has(permission)) {
        replyEmbed(
          message,
          "❌ I don't have the required server permission.",
          COLORS.red
        );
        return false;
      }

      return true;
    };

    // HELP
    if (command === "help") {
      return replyEmbed(message, [
        "**🔥 BLACK FIRE BOT — COMMANDS**",
        "",
        "**General**",
        "`help` — Show all commands",
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
        "",
        "**Channel Management**",
        "`purge 10` — Delete recent messages",
        "`lock` — Lock the channel",
        "`unlock` — Unlock the channel",
        "",
        "**Role Management**",
        "`role @user @role` — Add a role",
        "`rrole @user @role` — Remove a role",
        "`promote @user` — Move up one track role",
        "`demote @user` — Move down one track role",
        "",
        "**Duration format:** `10s`, `10m`, `2h`, `1d`",
        "**Access:** Staff with the required Discord permissions."
      ].join("\n"));
    }

    // PING
    if (command === "ping") {
      return replyEmbed(
        message,
        `🏓 Pong! API latency: ${client.ws.ping}ms`,
        COLORS.green
      );
    }

    // COMMAND PERMISSIONS
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
      rrole: PermissionsBitField.Flags.ManageRoles,
      promote: PermissionsBitField.Flags.ManageRoles,
      demote: PermissionsBitField.Flags.ManageRoles
    };

    if (permissionMap[command]) {
      if (!requirePermission(permissionMap[command])) return;
    }

    // TARGET-BASED COMMANDS
    const targetCommands = [
      "ban", "kick", "timeout", "mute", "untimeout", "unmute",
      "warn", "warnings", "clearwarnings", "role", "rrole",
      "promote", "demote"
    ];

    if (targetCommands.includes(command)) {
      const target = await getTarget(message, args[1]);

      if (!target) {
        return replyEmbed(
          message,
          "❌ Mention a valid server member.",
          COLORS.red
        );
      }

      if (target.id === message.author.id) {
        return replyEmbed(
          message,
          "❌ You cannot target yourself.",
          COLORS.red
        );
      }

      if (target.id === client.user.id) {
        return replyEmbed(
          message,
          "❌ You cannot target the bot.",
          COLORS.red
        );
      }

      // PROMOTE / DEMOTE
      if (command === "promote" || command === "demote") {
        return await changeRank(
          message,
          target,
          command,
          botMember
        );
      }

      // Check moderator hierarchy.
      if (
        message.guild.ownerId !== message.author.id &&
        target.roles.highest.position >= member.roles.highest.position
      ) {
        return replyEmbed(
          message,
          "❌ Your highest role must be above the target's role.",
          COLORS.red
        );
      }

      // Check bot hierarchy for member moderation.
      if (
        target.roles.highest.position >= botMember.roles.highest.position
      ) {
        return replyEmbed(
          message,
          "❌ My highest role must be above the target's role.",
          COLORS.red
        );
      }

      const reason = args.slice(2).join(" ") || "No reason provided";

      // BAN
      if (command === "ban") {
        if (!requireBotPermission(
          PermissionsBitField.Flags.BanMembers
        )) return;

        await target.ban({
          reason: `${reason} | By ${message.author.tag}`
        });

        return replyEmbed(
          message,
          `🔨 ${target.user.tag} has been banned. Reason: ${reason}`,
          COLORS.green
        );
      }

      // KICK
      if (command === "kick") {
        if (!requireBotPermission(
          PermissionsBitField.Flags.KickMembers
        )) return;

        await target.kick(`${reason} | By ${message.author.tag}`);

        return replyEmbed(
          message,
          `👢 ${target.user.tag} has been kicked. Reason: ${reason}`,
          COLORS.green
        );
      }

      // TIMEOUT / MUTE
      if (["timeout", "mute"].includes(command)) {
        if (!requireBotPermission(
          PermissionsBitField.Flags.ModerateMembers
        )) return;

        const duration = parseDuration(args[2] || "");

        if (!duration) {
          return replyEmbed(
            message,
            "❌ Usage: `timeout @user 10m reason`\nDuration: `s`, `m`, `h`, `d`; maximum 28 days.",
            COLORS.red
          );
        }

        const timeoutReason =
          args.slice(3).join(" ") || "No reason provided";

        await target.timeout(
          duration,
          `${timeoutReason} | By ${message.author.tag}`
        );

        return replyEmbed(
          message,
          `🔇 ${target.user.tag} has been timed out for ${args[2]}. Reason: ${timeoutReason}`,
          COLORS.green
        );
      }

      // REMOVE TIMEOUT
      if (["untimeout", "unmute"].includes(command)) {
        if (!requireBotPermission(
          PermissionsBitField.Flags.ModerateMembers
        )) return;

        await target.timeout(
          null,
          `Timeout removed by ${message.author.tag}`
        );

        return replyEmbed(
          message,
          `🔊 Timeout removed for ${target.user.tag}.`,
          COLORS.green
        );
      }

      // WARN
      if (command === "warn") {
        const key = `${message.guild.id}:${target.id}`;
        const list = warnings.get(key) || [];

        list.push({
          reason,
          moderator: message.author.tag,
          date: new Date().toISOString()
        });

        warnings.set(key, list);

        return replyEmbed(
          message,
          `⚠️ ${target.user.tag} has been warned. Reason: ${reason}`,
          COLORS.green
        );
      }

      // VIEW WARNINGS
      if (command === "warnings") {
        const list =
          warnings.get(`${message.guild.id}:${target.id}`) || [];

        const description = list.length
          ? list.map((warning, index) =>
              `**${index + 1}.** ${warning.reason} — ${warning.moderator}`
            ).join("\n")
          : "No warnings found.";

        return replyEmbed(
          message,
          `Warnings for ${target.user.tag}:\n${description}`
        );
      }

      // CLEAR WARNINGS
      if (command === "clearwarnings") {
        warnings.delete(`${message.guild.id}:${target.id}`);

        return replyEmbed(
          message,
          `🧹 Warnings cleared for ${target.user.tag}.`,
          COLORS.green
        );
      }

      // ROLE ADD / REMOVE
      if (command === "role" || command === "rrole") {
        if (!requireBotPermission(
          PermissionsBitField.Flags.ManageRoles
        )) return;

        const role = await getRole(message, args[2]);

        if (!role) {
          return replyEmbed(
            message,
            "❌ Usage: `role @user @role` or `rrole @user @role`",
            COLORS.red
          );
        }

        if (role.managed || role.id === message.guild.id) {
          return replyEmbed(
            message,
            "❌ That role cannot be assigned or removed.",
            COLORS.red
          );
        }

        if (role.position >= botMember.roles.highest.position) {
          return replyEmbed(
            message,
            "❌ Move my highest role above the role I need to manage.",
            COLORS.red
          );
        }

        if (
          message.guild.ownerId !== message.author.id &&
          role.position >= member.roles.highest.position
        ) {
          return replyEmbed(
            message,
            "❌ Your highest role must be above the role you want to manage.",
            COLORS.red
          );
        }

        if (command === "role") {
          await target.roles.add(
            role,
            `Role added by ${message.author.tag}`
          );

          return replyEmbed(
            message,
            `✅ Added ${role.name} to ${target.user.tag}.`,
            COLORS.green
          );
        }

        await target.roles.remove(
          role,
          `Role removed by ${message.author.tag}`
        );

        return replyEmbed(
          message,
          `✅ Removed ${role.name} from ${target.user.tag}.`,
          COLORS.green
        );
      }
    }

    // PURGE
    if (command === "purge") {
      if (!requireBotPermission(
        PermissionsBitField.Flags.ManageMessages
      )) return;

      const amount = Number(args[1]);

      if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 100
      ) {
        return replyEmbed(
          message,
          "❌ Usage: `purge 1-100`",
          COLORS.red
        );
      }

      const deleted = await message.channel.bulkDelete(amount, true);

      const confirmation = await message.channel.send(
        `🧹 Deleted ${deleted.size} message(s).`
      );

      setTimeout(
        () => confirmation.delete().catch(() => {}),
        5000
      );

      return;
    }

    // LOCK / UNLOCK
    if (command === "lock" || command === "unlock") {
      if (!requireBotPermission(
        PermissionsBitField.Flags.ManageChannels
      )) return;

      const everyone = message.guild.roles.everyone;
      const shouldUnlock = command === "unlock";

      await message.channel.permissionOverwrites.edit(everyone, {
        SendMessages: shouldUnlock ? null : false
      });

      return replyEmbed(
        message,
        shouldUnlock
          ? "🔓 Channel unlocked."
          : "🔒 Channel locked.",
        COLORS.green
      );
    }

  } catch (error) {
    console.error("Command error:", error);

    if (error.code === 50013) {
      return replyEmbed(
        message,
        "❌ Missing Discord permissions or role hierarchy prevents this action.",
        COLORS.red
      );
    }

    if (error.code === 50035) {
      return replyEmbed(
        message,
        "❌ Invalid command arguments.",
        COLORS.red
      );
    }

    return replyEmbed(
      message,
      "❌ Command failed. Check Railway logs for details.",
      COLORS.red
    );
  }
});

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing from Railway Variables.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error(
    "❌ Bot login failed. Check DISCORD_TOKEN in Railway Variables.",
    error
  );
  process.exit(1);
});
          

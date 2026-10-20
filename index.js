const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DATA_FILE = path.join(__dirname, "bot-data.json");

const PROMOTION_ROLES = [
  "1535921357991317544", // Helper
  "1535921160133287946", // Mod
  "1555582030274764852", // Head Mod
  "1535920366550122596", // Admin
  "1535922877499445289"  // Head Admin
];

const LOG_CHANNEL_ID = "1562005508532215808"; // <-- apna log channel ID yahan daal

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Data load error:", error);
  }

  return { warnings: {}, temporaryRoles: [], caseCount: 0 };
}

const data = loadData();
data.warnings ||= {};
data.temporaryRoles ||= [];
data.caseCount ||= 0;

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function makeEmbed(title, description, color = 0xE53935) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

async function sendModLog(message, action, target, details = "") {
  try {
    const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    data.caseCount = (data.caseCount || 0) + 1;
    saveData();

    const targetText = target
      ? `${target} (${target.user ? target.user.tag : (target.tag || target.id)})`
      : "N/A";

    const embed = new EmbedBuilder()
      .setColor(0xE53935)
      .setTitle(`📋 Case #${data.caseCount} | ${action}`)
      .addFields(
        { name: "Moderator", value: `${message.author} (${message.author.tag})`, inline: true },
        { name: "Target", value: targetText, inline: true },
        { name: "Details", value: details || "No details provided" }
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Mod log error:", error);
  }
}

function parseDuration(text) {
  const match = String(text).match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multiplier = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  const result = amount * multiplier[unit];
  return Number.isFinite(result) && result > 0 ? result : null;
}

function naturalDuration(text) {
  const match = String(text).trim().match(
    /^(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)$/i
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  let multiplier = 1000;
  if (unit.startsWith("min")) multiplier = 60000;
  else if (unit.startsWith("h")) multiplier = 3600000;
  else if (unit.startsWith("d")) multiplier = 86400000;

  return amount * multiplier;
}

function getMember(message, text) {
  const id = String(text || "").match(/\d{17,20}/)?.[0];
  if (!id) return null;
  return message.guild.members.cache.get(id) || null;
}

function getRole(guild, roleName) {
  const cleanName = String(roleName || "")
    .replace(/<@&(\d+)>/g, "$1")
    .trim();

  const id = cleanName.match(/^\d{17,20}$/)?.[0];
  if (id) return guild.roles.cache.get(id) || null;

  return guild.roles.cache.find(
    role => role.name.toLowerCase() === cleanName.toLowerCase()
  ) || null;
}

function isStaff(message) {
  const permissions = message.member.permissions;

  return [
    PermissionsBitField.Flags.Administrator,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ModerateMembers,
    PermissionsBitField.Flags.BanMembers,
    PermissionsBitField.Flags.KickMembers,
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageChannels
  ].some(permission => permissions.has(permission));
}

function canModerateTarget(message, target) {
  if (!target) return false;
  if (target.id === message.author.id) return false;
  if (target.id === message.guild.ownerId) return false;

  if (
    message.author.id !== message.guild.ownerId &&
    target.roles.highest.position >= message.member.roles.highest.position
  ) {
    return false;
  }

  return true;
}

function warningKey(guildId, userId) {
  return `${guildId}_${userId}`;
}

function getWarnings(guildId, userId) {
  return data.warnings[warningKey(guildId, userId)] || [];
}

async function giveTemporaryRole(message, member, role, duration) {
  if (!message.member.permissions.has(
    PermissionsBitField.Flags.ManageRoles
  )) {
    return message.reply("❌ You need Manage Roles permission.");
  }

  if (!member || !role || !duration) {
    return message.reply("Usage: `temprole @user VIP 10d`");
  }

  if (
    role.managed ||
    role.position >= message.guild.members.me.roles.highest.position
  ) {
    return message.reply(
      "❌ I can't assign that role. Check my role hierarchy."
    );
  }

  await member.roles.add(role);

  data.temporaryRoles.push({
    guildId: message.guild.id,
    userId: member.id,
    roleId: role.id,
    expiresAt: Date.now() + duration
  });

  saveData();

  await sendModLog(message, "Temporary Role Added", member, `Role: ${role.name}\nDuration: ${Math.round(duration / 60000)} min`);

  return message.reply(`✅ Gave ${role} to ${member} temporarily.`);
}

async function removeExpiredRoles() {
  for (let i = data.temporaryRoles.length - 1; i >= 0; i--) {
    const item = data.temporaryRoles[i];

    if (item.expiresAt > Date.now()) continue;

    try {
      const guild = client.guilds.cache.get(item.guildId);

      if (guild) {
        const member = await guild.members.fetch(item.userId)
          .catch(() => null);

        if (member && member.roles.cache.has(item.roleId)) {
          await member.roles.remove(item.roleId).catch(console.error);
        }
      }
    } catch (error) {
      console.error("Temporary role expiry error:", error);
    }

    data.temporaryRoles.splice(i, 1);
    saveData();
  }
}

client.once("ready", () => {
  console.log(`${client.user.tag} is online!`);
  removeExpiredRoles();
  setInterval(removeExpiredRoles, 60000);
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;

  const args = content.split(/\s+/);
  const command = args.shift().toLowerCase();

  const naturalGive = content.match(
    /^give\s+<@!?(\d+)>\s+(.+?)\s+role\s+for\s+(\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?))$/i
  );

  const naturalRemove = content.match(
    /^remove\s+(.+?)\s+from\s+<@!?(\d+)>$/i
  );

  const naturalBan = content.match(
    /^ban\s+<@!?(\d+)>\s+for\s+(.+)$/i
  );

  const naturalTimeout = content.match(
    /^timeout\s+<@!?(\d+)>\s+for\s+(\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?))$/i
  );

  if (command === "help" || command === "commands") {
    return message.reply({
      embeds: [makeEmbed(
        "🔥 BLACK FIRE BOT",
        [
          "`help` — Show commands",
          "`ping` — Check bot response",
          "`userinfo @user` — User details",
          "`serverinfo` — Server details",
          "`say Your message` — Send a message as the bot",
          "`announce Your message` — Send an announcement embed",
          "`ban @user reason` — Ban a member",
          "`kick @user reason` — Kick a member",
          "`timeout @user 10m reason` — Timeout",
          "`untimeout @user` — Remove timeout",
          "`warn @user reason` — Warn a member",
          "`warnings @user` — View warnings",
          "`clearwarnings @user` — Clear warnings",
          "`purge 10` — Delete messages",
          "`lock` / `unlock` — Lock or unlock channel",
          "`role @user VIP` — Add a role",
          "`rrole @user VIP` — Remove a role",
          "`temprole @user VIP 10d` — Temporary role",
          "`promote @user` / `demote @user` — Staff roles",
          "",
          "**Natural language examples**",
          "`Give @user VIP role for 10 days`",
          "`Remove VIP from @user`",
          "`Ban @user for spamming`",
          "`Timeout @user for 10 minutes`"
        ].join("\n")
      )]
    });
  }

  if (command === "ping") {
    return message.reply(`🏓 Pong! ${client.ws.ping}ms`);
  }

  if (command === "userinfo") {
    const member = getMember(message, args[0]) || message.member;

    return message.reply({
      embeds: [makeEmbed(
        "👤 User Info",
        `**User:** ${member.user.tag}\n**ID:** ${member.id}\n**Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
      )]
    });
  }

  if (command === "serverinfo") {
    return message.reply({
      embeds: [makeEmbed(
        "🏠 Server Info",
        `**Name:** ${message.guild.name}\n**Members:** ${message.guild.memberCount}\n**Roles:** ${message.guild.roles.cache.size}\n**Channels:** ${message.guild.channels.cache.size}`
      )]
    });
  }

  // SAY COMMAND
  if (command === "say") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageMessages
    )) {
      return message.reply("❌ You need Manage Messages permission.");
    }

    const text = args.join(" ");
    if (!text) return message.reply("❌ Usage: `say Your message here`");

    await message.delete().catch(() => {});

    return message.channel.send({
      content: text,
      allowedMentions: { parse: [] }
    });
  }

  // ANNOUNCE COMMAND
  if (command === "announce") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageGuild
    )) {
      return message.reply("❌ You need Manage Server permission.");
    }

    const text = args.join(" ");
    if (!text) {
      return message.reply("❌ Usage: `announce Your announcement here`");
    }

    await message.delete().catch(() => {});

    const announcement = new EmbedBuilder()
      .setColor(0xE53935)
      .setTitle("📢 BLACK FIRE ANNOUNCEMENT")
      .setDescription(text)
      .setFooter({ text: `Announced by ${message.author.username}` })
      .setTimestamp();

    return message.channel.send({ embeds: [announcement] });
  }

  if (naturalGive) {
    if (!isStaff(message)) {
      return message.reply("❌ You don't have permission.");
    }

    const member = message.guild.members.cache.get(naturalGive[1]);
    const role = getRole(message.guild, naturalGive[2]);
    const duration = naturalDuration(naturalGive[3]);

    return giveTemporaryRole(message, member, role, duration);
  }

  if (naturalRemove) {
    if (!isStaff(message)) {
      return message.reply("❌ You don't have permission.");
    }

    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply("❌ You need Manage Roles permission.");
    }

    const member = message.guild.members.cache.get(naturalRemove[2]);
    const role = getRole(message.guild, naturalRemove[1]);

    if (!member || !role) {
      return message.reply("❌ Member or role not found.");
    }

    if (
      role.managed ||
      role.position >= message.guild.members.me.roles.highest.position
    ) {
      return message.reply("❌ I can't remove that role.");
    }

    await member.roles.remove(role);

    await sendModLog(message, "Role Removed", member, `Role: ${role.name}`);

    return message.reply(`✅ Removed ${role} from ${member}.`);
  }

  if (!isStaff(message)) return;

  if (command === "ban" || naturalBan) {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.BanMembers
    )) {
      return message.reply("❌ You need Ban Members permission.");
    }

    const targetId = naturalBan
      ? naturalBan[1]
      : args[0]?.match(/\d{17,20}/)?.[0];

    const target = targetId
      ? await message.guild.members.fetch(targetId).catch(() => null)
      : null;

    const reason = naturalBan
      ? naturalBan[2]
      : args.slice(1).join(" ") || "No reason provided";

    if (!target || !canModerateTarget(message, target)) {
      return message.reply("❌ Member not found or target is protected.");
    }

    await target.ban({ reason });

    await sendModLog(message, "Ban", target, `Reason: ${reason}`);

    return message.reply(`🔨 Banned **${target.user.tag}**. Reason: ${reason}`);
  }

  if (command === "kick") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.KickMembers
    )) {
      return message.reply("❌ You need Kick Members permission.");
    }

    const target = getMember(message, args[0]);
    const reason = args.slice(1).join(" ") || "No reason provided";

    if (!target || !canModerateTarget(message, target)) {
      return message.reply("❌ Member not found or target is protected.");
    }

    await target.kick(reason);

    await sendModLog(message, "Kick", target, `Reason: ${reason}`);

    return message.reply(`👢 Kicked **${target.user.tag}**. Reason: ${reason}`);
    }  if (command === "timeout" || command === "mute" || naturalTimeout) {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ModerateMembers
    )) {
      return message.reply("❌ You need Moderate Members permission.");
    }

    const targetId = naturalTimeout
      ? naturalTimeout[1]
      : args[0]?.match(/\d{17,20}/)?.[0];

    const target = targetId
      ? await message.guild.members.fetch(targetId).catch(() => null)
      : null;

    const durationText = naturalTimeout ? naturalTimeout[2] : args[1];
    const duration = naturalTimeout
      ? naturalDuration(durationText)
      : parseDuration(durationText);

    const reason = naturalTimeout
      ? "Timeout requested by staff"
      : args.slice(2).join(" ") || "No reason provided";

    if (!target || !canModerateTarget(message, target)) {
      return message.reply("❌ Member not found or target is protected.");
    }

    if (!duration || duration > 28 * 24 * 60 * 60 * 1000) {
      return message.reply("❌ Invalid duration. Example: `timeout @user 10m` (maximum 28 days).");
    }

    await target.timeout(duration, reason);

    await sendModLog(message, "Timeout", target, `Duration: ${Math.round(duration / 60000)} min\nReason: ${reason}`);

    return message.reply(`⏳ Timed out **${target.user.tag}**.`);
  }

  if (command === "untimeout" || command === "unmute") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ModerateMembers
    )) {
      return message.reply("❌ You need Moderate Members permission.");
    }

    const target = getMember(message, args[0]);

    if (!target || !canModerateTarget(message, target)) {
      return message.reply("❌ Member not found or target is protected.");
    }

    await target.timeout(null);

    await sendModLog(message, "Timeout Removed", target);

    return message.reply(`✅ Timeout removed for **${target.user.tag}**.`);
  }

  if (command === "warn") {
    const target = getMember(message, args[0]);
    const reason = args.slice(1).join(" ") || "No reason provided";

    if (!target || !canModerateTarget(message, target)) {
      return message.reply("❌ Member not found or target is protected.");
    }

    const key = warningKey(message.guild.id, target.id);
    data.warnings[key] ||= [];
    data.warnings[key].push({
      reason,
      moderator: message.author.id,
      date: Date.now()
    });

    saveData();

    await sendModLog(message, "Warn", target, `Reason: ${reason}\nTotal warnings: ${data.warnings[key].length}`);

    return message.reply(`⚠️ Warned ${target}. Total warnings: ${data.warnings[key].length}`);
  }

  if (command === "warnings") {
    const target = getMember(message, args[0]);
    if (!target) return message.reply("❌ Member not found.");

    const warnings = getWarnings(message.guild.id, target.id);

    return message.reply({
      embeds: [makeEmbed(
        `Warnings: ${target.user.tag}`,
        warnings.length
          ? warnings.map((w, i) =>
              `**${i + 1}.** ${w.reason} — <@${w.moderator}>`
            ).join("\n")
          : "No warnings found."
      )]
    });
  }

  if (command === "clearwarnings") {
    const target = getMember(message, args[0]);
    if (!target) return message.reply("❌ Member not found.");

    delete data.warnings[warningKey(message.guild.id, target.id)];
    saveData();

    await sendModLog(message, "Warnings Cleared", target);

    return message.reply(`✅ Cleared warnings for ${target}.`);
  }

  if (command === "purge" || command === "clear") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageMessages
    )) {
      return message.reply("❌ You need Manage Messages permission.");
    }

    const amount = Number(args[0]);

    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return message.reply("❌ Usage: `purge 10` (1–100 messages).");
    }

    const deleted = await message.channel.bulkDelete(amount, true);
    const reply = await message.channel.send(
      `🧹 Deleted ${deleted.size} messages.`
    );

    await sendModLog(message, "Purge", null, `Channel: ${message.channel}\nAmount: ${deleted.size}`);

    setTimeout(() => reply.delete().catch(() => {}), 4000);
    return;
  }

  if (command === "lock") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageChannels
    )) {
      return message.reply("❌ You need Manage Channels permission.");
    }

    await message.channel.permissionOverwrites.edit(
      message.guild.roles.everyone,
      { SendMessages: false }
    );

    await sendModLog(message, "Channel Locked", null, `Channel: ${message.channel}`);

    return message.reply("🔒 Channel locked.");
  }

  if (command === "unlock") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageChannels
    )) {
      return message.reply("❌ You need Manage Channels permission.");
    }

    await message.channel.permissionOverwrites.edit(
      message.guild.roles.everyone,
      { SendMessages: null }
    );

    await sendModLog(message, "Channel Unlocked", null, `Channel: ${message.channel}`);

    return message.reply("🔓 Channel unlocked.");
  }

  if (command === "temprole") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply("❌ You need Manage Roles permission.");
    }

    const member = getMember(message, args[0]);
    const duration = parseDuration(args[args.length - 1]);
    const roleName = args.slice(1, -1).join(" ");
    const role = getRole(message.guild, roleName);

    return giveTemporaryRole(message, member, role, duration);
  }

  if (command === "role" || command === "addrole") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply("❌ You need Manage Roles permission.");
    }

    const member = getMember(message, args[0]);
    const role = getRole(message.guild, args.slice(1).join(" "));

    if (!member || !role) {
      return message.reply("❌ Usage: `role @user VIP`");
    }

    if (
      role.managed ||
      role.position >= message.guild.members.me.roles.highest.position
    ) {
      return message.reply("❌ I can't assign that role.");
    }

    await member.roles.add(role);

    await sendModLog(message, "Role Added", member, `Role: ${role.name}`);

    return message.reply(`✅ Added ${role} to ${member}.`);
  }

  if (command === "rrole" || command === "removerole") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply("❌ You need Manage Roles permission.");
    }

    const member = getMember(message, args[0]);
    const role = getRole(message.guild, args.slice(1).join(" "));

    if (!member || !role) {
      return message.reply("❌ Usage: `rrole @user VIP`");
    }

    if (
      role.managed ||
      role.position >= message.guild.members.me.roles.highest.position
    ) {
      return message.reply("❌ I can't remove that role.");
    }

    await member.roles.remove(role);

    await sendModLog(message, "Role Removed", member, `Role: ${role.name}`);

    return message.reply(`✅ Removed ${role} from ${member}.`);
  }

  if (command === "promote" || command === "demote") {
    if (!message.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )) {
      return message.reply("❌ You need Manage Roles permission.");
    }

    const target = getMember(message, args[0]);

    if (!target || !canModerateTarget(message, target)) {
      return message.reply("❌ Member not found or target is protected.");
    }

    const roles = PROMOTION_ROLES.map(id =>
      message.guild.roles.cache.get(id)
    );

    if (roles.some(role => !role)) {
      return message.reply(
        "❌ One or more configured staff role IDs are missing from this server."
      );
    }

    const currentIndex = PROMOTION_ROLES.findIndex(id =>
      target.roles.cache.has(id)
    );

    if (command === "promote") {
      const nextIndex = currentIndex + 1;

      if (nextIndex >= PROMOTION_ROLES.length) {
        return message.reply(
          "❌ This member is already at the highest configured staff role."
        );
      }

      const nextRole = roles[nextIndex];

      if (
        nextRole.managed ||
        nextRole.position >= message.guild.members.me.roles.highest.position
      ) {
        return message.reply(
          "❌ Move my bot role above the staff roles first."
        );
      }

      if (currentIndex >= 0) {
        await target.roles.remove(roles[currentIndex]);
      }

      await target.roles.add(nextRole);

      await sendModLog(message, "Promoted", target, `New role: ${nextRole.name}`);

      return message.reply(
        `⬆️ Promoted ${target} to **${nextRole.name}**.`
      );
    }

    if (currentIndex <= 0) {
      return message.reply(
        "❌ This member has no configured role to demote further."
      );
    }

    const lowerRole = roles[currentIndex - 1];

    if (
      lowerRole.managed ||
      lowerRole.position >= message.guild.members.me.roles.highest.position
    ) {
      return message.reply(
        "❌ Move my bot role above the staff roles first."
      );
    }

    await target.roles.remove(roles[currentIndex]);
    await target.roles.add(lowerRole);

    await sendModLog(message, "Demoted", target, `New role: ${lowerRole.name}`);

    return message.reply(
      `⬇️ Demoted ${target} to **${lowerRole.name}**.`
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
  console.error("Missing DISCORD_TOKEN environment variable.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN)

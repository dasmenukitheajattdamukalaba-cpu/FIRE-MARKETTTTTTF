
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`🔥 BLACK FIRE BOT online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const msg = message.content.trim().toLowerCase();

  if (msg === "?help") {
    return message.reply(
      "🔥 BLACK FIRE BOT\n\n?help — Show commands\n?ping — Check bot status"
    );
  }

  if (msg === "?ping") {
    return message.reply("🏓 Pong! BLACK FIRE is online!");
  }

  if (msg === "hello" || msg === "hi") {
    return message.reply(`Hello ${message.author.username}! 🔥`);
  }
});

client.login(process.env.DISCORD_TOKEN);

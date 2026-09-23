require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
} = require('discord.js');
const { setupOtrCommunity } = require('./serverSetup');
const {
  setupColorRoles,
  handleColorReactionAdd,
  handleColorReactionRemove,
} = require('./colorRoles');

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Missing DISCORD_TOKEN.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('health')
    .setDescription('Check whether OTR Bot is online.'),
].map(command => command.toJSON());

client.once('clientReady', async () => {
  console.log(`OTR Bot online as ${client.user.tag}`);

  try {
    const guild = await setupOtrCommunity(client);

    if (guild) {
      await setupColorRoles(guild);
      await guild.commands.set(commands);
      console.log(`[commands] Registered /health in ${guild.name}.`);
    }
  } catch (error) {
    console.error('[startup] OTR setup failed:', error);
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    await handleColorReactionAdd(reaction, user);
  } catch (error) {
    console.error('[color-roles] Reaction add failed:', error);
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    await handleColorReactionRemove(reaction, user);
  } catch (error) {
    console.error('[color-roles] Reaction remove failed:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'health') {
    await interaction.reply({
      content: `OTR Bot is online. Ping: ${client.ws.ping}ms`,
      ephemeral: true,
    });
  }
});

client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

client.login(token);

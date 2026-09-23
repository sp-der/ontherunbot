const {
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

async function findTargetGuild(client) {
  const explicitGuildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  const targetName = String(process.env.OTR_GUILD_NAME || 'OTR').trim();

  if (explicitGuildId) {
    return client.guilds.fetch(explicitGuildId).catch(() => null);
  }

  await client.guilds.fetch();

  const cached = [...client.guilds.cache.values()];
  const exactNameMatches = cached.filter(
    guild => guild.name.toLowerCase() === targetName.toLowerCase(),
  );

  if (exactNameMatches.length === 1) return exactNameMatches[0];
  if (cached.length === 1) return cached[0];

  console.error(
    `[setup] Refusing to guess target server. Connected guilds: ${
      cached.map(g => `${g.name} (${g.id})`).join(', ') || 'none'
    }`,
  );
  return null;
}

async function ensureCategory(guild, name) {
  await guild.channels.fetch();

  let category = guild.channels.cache.find(
    ch => ch.type === ChannelType.GuildCategory && ch.name === name,
  );

  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      reason: 'OTR server community setup',
    });
    console.log(`[setup] Created category: ${name}`);
  } else {
    console.log(`[setup] Reusing category: ${name}`);
  }

  return category;
}

async function ensureChannel(guild, { name, type, parent }) {
  await guild.channels.fetch();

  let channel = guild.channels.cache.find(
    ch => ch.type === type && ch.name.toLowerCase() === name.toLowerCase(),
  );

  if (!channel) {
    channel = await guild.channels.create({
      name,
      type,
      parent: parent.id,
      reason: 'OTR server community setup',
    });
    console.log(`[setup] Created channel: ${name}`);
    return channel;
  }

  if (channel.parentId !== parent.id) {
    await channel.setParent(parent.id, { lockPermissions: false });
    console.log(`[setup] Moved existing channel into ${parent.name}: ${name}`);
  } else {
    console.log(`[setup] Reusing channel: ${name}`);
  }

  return channel;
}

async function setupOtrCommunity(client) {
  const enabled = String(process.env.ENABLE_SERVER_SETUP || '').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[setup] Server setup disabled.');
    return null;
  }

  const guild = await findTargetGuild(client);
  if (!guild) {
    console.error('[setup] OTR server not found. No changes made.');
    return null;
  }

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    console.error(
      `[setup] ${client.user.tag} does not have Manage Channels in ${guild.name}. No changes made.`,
    );
    return guild;
  }

  console.log(`[setup] Target server confirmed: ${guild.name} (${guild.id})`);

  const community = await ensureCategory(guild, 'OTR COMMUNITY');
  await ensureChannel(guild, {
    name: 'general',
    type: ChannelType.GuildText,
    parent: community,
  });
  await ensureChannel(guild, {
    name: 'trading',
    type: ChannelType.GuildText,
    parent: community,
  });
  await ensureChannel(guild, {
    name: 'gaming',
    type: ChannelType.GuildText,
    parent: community,
  });

  const voice = await ensureCategory(guild, 'VOICE');
  await ensureChannel(guild, {
    name: 'Gaming',
    type: ChannelType.GuildVoice,
    parent: voice,
  });
  await ensureChannel(guild, {
    name: 'Trading',
    type: ChannelType.GuildVoice,
    parent: voice,
  });
  await ensureChannel(guild, {
    name: 'Working',
    type: ChannelType.GuildVoice,
    parent: voice,
  });

  console.log('[setup] OTR community layout is ready.');
  return guild;
}

module.exports = { setupOtrCommunity };

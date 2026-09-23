const {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
} = require('discord.js');

const SELF_ROLES = [
  { name: 'Trader', emoji: '📈', group: 'INTERESTS' },
  { name: 'Gamer', emoji: '🎮', group: 'INTERESTS' },
  { name: 'Builder', emoji: '💻', group: 'INTERESTS' },
  { name: 'Trading Alerts', emoji: '🔔', group: 'PING ROLES' },
  { name: 'Gaming Alerts', emoji: '🕹️', group: 'PING ROLES' },
];

const SELECTOR_TITLE = 'Pick your OTR roles';

function isSelfRoleMessage(message) {
  if (!message || message.author?.id !== message.client.user?.id) return false;
  if (message.channel?.name?.toLowerCase() !== 'roles') return false;

  try {
    const serialized = JSON.stringify(
      message.components?.map(component =>
        typeof component.toJSON === 'function' ? component.toJSON() : component,
      ) || [],
    );
    return serialized.includes(SELECTOR_TITLE);
  } catch {
    return false;
  }
}

async function hydrateReaction(reaction) {
  if (reaction.partial) {
    await reaction.fetch();
  }

  if (reaction.message?.partial) {
    await reaction.message.fetch();
  }

  return reaction;
}

async function ensureSelfRoles(guild) {
  await guild.roles.fetch();

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Bot needs Manage Roles to configure self roles.');
  }

  const roles = [];

  for (const definition of SELF_ROLES) {
    let role = guild.roles.cache.find(
      candidate => !candidate.managed && candidate.name === definition.name,
    );

    if (!role) {
      role = await guild.roles.create({
        name: definition.name,
        color: 0,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: 'OTR self-assign role',
      });

      console.log(`[self-roles] Created role: ${definition.name}`);
    } else {
      const needsUpdate = role.color !== 0 || role.hoist || role.mentionable;

      if (needsUpdate) {
        role = await role.edit({
          color: 0,
          hoist: false,
          mentionable: false,
          reason: 'Keep OTR self roles colorless and unhoisted',
        });

        console.log(`[self-roles] Updated role: ${definition.name}`);
      } else {
        console.log(`[self-roles] Reusing role: ${definition.name}`);
      }
    }

    roles.push(role);
  }

  return roles;
}

function buildSelectorContainer() {
  const interests = SELF_ROLES
    .filter(role => role.group === 'INTERESTS')
    .map(role => `${role.emoji}  **${role.name}**`)
    .join('\n');

  const pings = SELF_ROLES
    .filter(role => role.group === 'PING ROLES')
    .map(role => `${role.emoji}  **${role.name}**`)
    .join('\n');

  const copy = [
    `## ${SELECTOR_TITLE}`,
    '',
    'React to grab the roles that fit you. You can choose as many as you want.',
    '',
    '**INTERESTS**',
    interests,
    '',
    '**PING ROLES**',
    pings,
    '',
    '*Remove your reaction anytime to remove that role.*',
  ].join('\n');

  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(copy),
    );
}

async function findOrCreateSelectorMessage(guild) {
  const channel = guild.channels.cache.find(
    candidate =>
      candidate.isTextBased?.() &&
      candidate.name?.toLowerCase() === 'roles',
  );

  if (!channel) {
    throw new Error('Could not find the #roles channel.');
  }

  const recent = await channel.messages.fetch({ limit: 50 });
  let message = recent.find(isSelfRoleMessage);

  if (!message) {
    message = await channel.send({
      components: [buildSelectorContainer()],
      flags: MessageFlags.IsComponentsV2,
    });

    console.log(`[self-roles] Posted selector message: ${message.id}`);
  } else {
    console.log(`[self-roles] Reusing selector message: ${message.id}`);
  }

  for (const definition of SELF_ROLES) {
    const existing = message.reactions.cache.find(
      reaction => reaction.emoji.name === definition.emoji,
    );

    if (!existing) {
      await message.react(definition.emoji);
    }
  }

  return message;
}

async function setupSelfRoles(guild) {
  await ensureSelfRoles(guild);
  await findOrCreateSelectorMessage(guild);
  console.log('[self-roles] Self-role system is ready.');
}

async function getMember(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  return guild.members.fetch(userId);
}

async function handleSelfRoleReactionAdd(reaction, user) {
  if (user.bot) return;

  await hydrateReaction(reaction);

  const message = reaction.message;
  if (!message.guild || !isSelfRoleMessage(message)) return;

  const selected = SELF_ROLES.find(
    definition => definition.emoji === reaction.emoji.name,
  );

  if (!selected) return;

  await message.guild.roles.fetch();

  const role = message.guild.roles.cache.find(
    candidate => !candidate.managed && candidate.name === selected.name,
  );

  if (!role) {
    console.warn(`[self-roles] Missing role for reaction: ${selected.name}`);
    return;
  }

  const member = await getMember(message.guild, user.id);

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(
      role,
      `Selected OTR self role: ${selected.name}`,
    );
  }

  console.log(
    `[self-roles] ${user.tag || user.id} selected ${selected.name}.`,
  );
}

async function handleSelfRoleReactionRemove(reaction, user) {
  if (user.bot) return;

  await hydrateReaction(reaction);

  const message = reaction.message;
  if (!message.guild || !isSelfRoleMessage(message)) return;

  const selected = SELF_ROLES.find(
    definition => definition.emoji === reaction.emoji.name,
  );

  if (!selected) return;

  await message.guild.roles.fetch();

  const role = message.guild.roles.cache.find(
    candidate => !candidate.managed && candidate.name === selected.name,
  );

  if (!role) return;

  const member = await getMember(message.guild, user.id);

  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(
      role,
      `Removed OTR self role: ${selected.name}`,
    );

    console.log(
      `[self-roles] ${user.tag || user.id} removed ${selected.name}.`,
    );
  }
}

module.exports = {
  SELF_ROLES,
  setupSelfRoles,
  handleSelfRoleReactionAdd,
  handleSelfRoleReactionRemove,
};

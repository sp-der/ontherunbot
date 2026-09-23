const {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  PermissionFlagsBits,
  TextDisplayBuilder,
} = require('discord.js');
const sharp = require('sharp');

const COLOR_ROLES = [
  { name: 'Red', emoji: '🔴', color: 0xed4245 },
  { name: 'Blue', emoji: '🔵', color: 0x3498db },
  { name: 'Green', emoji: '🟢', color: 0x57f287 },
  { name: 'Purple', emoji: '🟣', color: 0x9b59b6 },
  { name: 'Blurple', emoji: '🟦', color: 0x5865f2 },
  { name: 'Pink', emoji: '🩷', color: 0xeb459e },
];

const SELECTOR_TITLE = 'Choose your OTR color';

function isColorRoleMessage(message) {
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

async function ensureColorRoles(guild) {
  await guild.roles.fetch();

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Bot needs Manage Roles to configure color roles.');
  }

  const roles = [];

  for (const definition of COLOR_ROLES) {
    let role = guild.roles.cache.find(
      candidate => !candidate.managed && candidate.name === definition.name,
    );

    if (!role) {
      role = await guild.roles.create({
        name: definition.name,
        color: definition.color,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: 'OTR cosmetic color role',
      });

      console.log(`[color-roles] Created role: ${definition.name}`);
    } else {
      const needsUpdate =
        role.color !== definition.color ||
        role.hoist ||
        role.mentionable;

      if (needsUpdate) {
        role = await role.edit({
          color: definition.color,
          hoist: false,
          mentionable: false,
          reason: 'Keep OTR color roles cosmetic and unhoisted',
        });

        console.log(`[color-roles] Updated role: ${definition.name}`);
      } else {
        console.log(`[color-roles] Reusing role: ${definition.name}`);
      }
    }

    roles.push(role);
  }

  const topPosition = me.roles.highest.position - 1;

  if (topPosition > 0) {
    for (const role of roles) {
      try {
        await role.setPosition(topPosition, 'Keep OTR color roles above regular member roles');
      } catch (error) {
        console.warn(
          `[color-roles] Could not raise ${role.name} in role order: ${error.message}`,
        );
      }
    }
  }

  await guild.roles.fetch();
  return roles;
}

async function buildBanner(guild) {
  const width = 1200;
  const height = 300;
  const fallbackBackground = {
    create: {
      width,
      height,
      channels: 4,
      background: { r: 8, g: 9, b: 12, alpha: 1 },
    },
  };

  const iconUrl = guild.iconURL({
    extension: 'png',
    size: 1024,
    forceStatic: true,
  });

  if (!iconUrl) {
    const fallback = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#08090c"/>
        <rect y="${height - 8}" width="100%" height="8" fill="#5865F2"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
          fill="#ffffff" font-size="118" font-family="Arial, Helvetica, sans-serif"
          font-weight="700" letter-spacing="8">OTR</text>
      </svg>
    `);

    return sharp(fallback).png().toBuffer();
  }

  const response = await fetch(iconUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch OTR server icon: HTTP ${response.status}`);
  }

  const source = Buffer.from(await response.arrayBuffer());

  const background = await sharp(source)
    .resize(width, height, { fit: 'cover' })
    .blur(24)
    .modulate({ brightness: 0.38, saturation: 0.8 })
    .png()
    .toBuffer();

  const logo = await sharp(source)
    .resize(210, 210, { fit: 'contain' })
    .png()
    .toBuffer();

  const overlay = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#000000" fill-opacity="0.46"/>
      <rect y="${height - 8}" width="100%" height="8" fill="#5865F2"/>
    </svg>
  `);

  return sharp(background)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logo, left: Math.round((width - 210) / 2), top: 45 },
    ])
    .png()
    .toBuffer();
}

function buildSelectorContainer() {
  const choices = COLOR_ROLES
    .map(definition => `${definition.emoji}  **${definition.name}**`)
    .join('\n');

  const copy = [
    `## ${SELECTOR_TITLE}`,
    '',
    'React below to set the color of your name around OTR.',
    '',
    choices,
    '',
    '*Picking a new color automatically swaps out your old one.*',
  ].join('\n');

  return new ContainerBuilder()
    .setAccentColor(0x5865f2)
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL('attachment://otr-color-banner.png')
          .setDescription('OTR color roles banner'),
      ),
    )
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
  let message = recent.find(isColorRoleMessage);

  if (!message) {
    const banner = await buildBanner(guild);
    const attachment = new AttachmentBuilder(banner, {
      name: 'otr-color-banner.png',
    });

    message = await channel.send({
      components: [buildSelectorContainer()],
      files: [attachment],
      flags: MessageFlags.IsComponentsV2,
    });

    console.log(`[color-roles] Posted selector message: ${message.id}`);
  } else {
    console.log(`[color-roles] Reusing selector message: ${message.id}`);
  }

  for (const definition of COLOR_ROLES) {
    const existing = message.reactions.cache.find(
      reaction => reaction.emoji.name === definition.emoji,
    );

    if (!existing) {
      await message.react(definition.emoji);
    }
  }

  return message;
}

async function setupColorRoles(guild) {
  await ensureColorRoles(guild);
  await findOrCreateSelectorMessage(guild);
  console.log('[color-roles] Color role system is ready.');
}

async function getMember(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  return guild.members.fetch(userId);
}

async function handleColorReactionAdd(reaction, user) {
  if (user.bot) return;

  await hydrateReaction(reaction);

  const message = reaction.message;
  if (!message.guild || !isColorRoleMessage(message)) return;

  const selected = COLOR_ROLES.find(
    definition => definition.emoji === reaction.emoji.name,
  );

  if (!selected) return;

  await message.guild.roles.fetch();

  const selectedRole = message.guild.roles.cache.find(
    role => !role.managed && role.name === selected.name,
  );

  if (!selectedRole) {
    console.warn(`[color-roles] Missing role for reaction: ${selected.name}`);
    return;
  }

  const member = await getMember(message.guild, user.id);
  const colorRoleNames = new Set(COLOR_ROLES.map(definition => definition.name));

  const oldRoles = member.roles.cache.filter(
    role => colorRoleNames.has(role.name) && role.id !== selectedRole.id,
  );

  if (oldRoles.size) {
    await member.roles.remove(
      oldRoles,
      `Switch OTR color role to ${selected.name}`,
    );
  }

  if (!member.roles.cache.has(selectedRole.id)) {
    await member.roles.add(
      selectedRole,
      `Selected OTR color role: ${selected.name}`,
    );
  }

  for (const definition of COLOR_ROLES) {
    if (definition.emoji === selected.emoji) continue;

    const otherReaction = message.reactions.cache.find(
      candidate => candidate.emoji.name === definition.emoji,
    );

    if (otherReaction) {
      await otherReaction.users.remove(user.id).catch(() => null);
    }
  }

  console.log(
    `[color-roles] ${user.tag || user.id} selected ${selected.name}.`,
  );
}

async function handleColorReactionRemove(reaction, user) {
  if (user.bot) return;

  await hydrateReaction(reaction);

  const message = reaction.message;
  if (!message.guild || !isColorRoleMessage(message)) return;

  const selected = COLOR_ROLES.find(
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
      `Removed OTR color role: ${selected.name}`,
    );
    console.log(
      `[color-roles] ${user.tag || user.id} removed ${selected.name}.`,
    );
  }
}

module.exports = {
  COLOR_ROLES,
  setupColorRoles,
  handleColorReactionAdd,
  handleColorReactionRemove,
};

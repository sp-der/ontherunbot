const sharp = require('sharp');

async function buildOtrBanner(guild) {
  const width = 1200;
  const height = 300;

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

module.exports = { buildOtrBanner };

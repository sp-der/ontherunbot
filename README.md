# OTR Bot

OTR community Discord bot.

On startup, when `ENABLE_SERVER_SETUP=true`, the bot safely ensures this layout:

OTR COMMUNITY
- general
- trading
- gaming

VOICE
- Gaming
- Trading
- Working

The setup is idempotent: existing matching channels are reused rather than duplicated.
Welcome, joined, and roles are intentionally not configured yet.

Railway should provide:
- `DISCORD_TOKEN`
- `OTR_GUILD_NAME=OTR`
- `ENABLE_SERVER_SETUP=true`

The bot requires the Discord `Manage Channels` permission for the initial setup.

# OTR Bot

Discord bot for the **OTR community** (`sp-der/ontherunbot`), deployed from `main` on Railway. This is NOT Don's server.

## Existing features
- `#trading` market desk: hourly NQ, ES and Gold futures snapshot (Yahoo chart quotes, which may be delayed).
- Market movement thresholds are **disabled by default** to keep `#trading` uncluttered. The market dashboard still updates hourly, editing its existing message instead of creating new posts. Major economic and Fed policy pings remain enabled.
- Optional opt-in: set `ENABLE_MARKET_MOVEMENT_ALERTS=true` to restore 5-minute movement checks and threshold pings.
- Welcome/roles/channel setup and self-service color roles.

## New trading intelligence
- Market/economy headlines: CNBC market/economy RSS, with relevant keywords and original article links. Checks every **15 minutes**, max 3 new headlines per scan, without role pings.
- Official Federal Reserve monetary policy RSS. A significant Fed policy statement may ping **@Trader**.
- Official economic schedule: BLS calendar (CPI, NFP, PPI, JOLTS, ECI) and BEA JSON calendar (GDP and PCE). Times are converted from ET/UTC and rendered in Discord's viewer-local timezone.
- At **8:00 AM ET**, a daily rundown is posted on days with calendar events (no ping).
- Within **15 minutes before an event**, a reminder posts once. Only CPI/NFP/PPI/GDP/PCE ping @Trader.
- On first startup, old headlines are marked seen so the channel is not backfilled. Each post has an identifying marker and recent message checks to reduce duplicate posts after restarts.
- News feeds may lag and provider outages may occur; these are informational alerts, not real-time execution signals. No predicted impact, actual values or false release outcomes are invented.
- Does not use unauthorized scraping or require Finviz Elite/API. Finviz links are not passed off as a live feed.

## Configuration
Railway variables:
- `DISCORD_TOKEN` (required)
- `OTR_GUILD_NAME=OTR` or `DISCORD_GUILD_ID`
- `ENABLE_SERVER_SETUP=true` (existing server setup)
- `ENABLE_TRADING_INTELLIGENCE=true` (optional: enabled by default; set false to disable)
- `ENABLE_MARKET_MOVEMENT_ALERTS=false` (default; movement posts and pings only run when explicitly set to `true`)

Discord permissions: View Channel, Read Message History, Send Messages, Embed Links, Attach Files, and ability to mention the Trader role if you want role pings to work. The bot also needs Manage Channels / Manage Roles for existing server and role setup.

`npm run check` performs syntax checks and parser tests. The same check runs automatically before Railway starts the bot.

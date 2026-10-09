const { createHash } = require('node:crypto');
const { EmbedBuilder } = require('discord.js');

// Published feeds and subscription calendars. No scraping or paid key required.
const FEEDS = [
  { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', policy: true },
  { name: 'CNBC Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20409666' },
  { name: 'CNBC Economy', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html' },
];
const BLS_CALENDAR = 'https://www.bls.gov/schedule/news_release/bls.ics';
const BEA_CALENDAR = 'https://apps.bea.gov/API/signup/release_dates.json';
const NEWS_INTERVAL_MS = 15 * 60_000;
const CALENDAR_INTERVAL_MS = 5 * 60_000;
const CALENDAR_REFRESH_MS = 6 * 60 * 60_000;
const RELEVANT = /\b(?:fed|fomc|powell|inflation|cpi|ppi|payrolls|jobs report|jobs data|interest rates?|rate (?:cut|hike|decision)|treasury|bond yields?|nasdaq|s&p\s*500|wall street|stocks?|futures|gold|bullion|oil prices?|crude|dollar|recession|tariffs?|gdp|pce)\b/i;
const IMPORTANT_RELEASES = [
  { pattern: /consumer price index/i, label: 'CPI • Inflation', ping: true },
  { pattern: /employment situation/i, label: 'NFP • Jobs Report', ping: true },
  { pattern: /producer price index/i, label: 'PPI • Inflation', ping: true },
  { pattern: /job openings and labor turnover/i, label: 'JOLTS • Job Openings', ping: false },
  { pattern: /employment cost index/i, label: 'Employment Cost Index', ping: false },
];

const seenNews = new Set();
const sentMarkers = new Set();
let calendarEvents = [];
let calendarUpdatedAt = 0;
let started = false;
let newsBusy = false;
let calendarBusy = false;

function xmlDecode(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function xmlField(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\\/${tag}>`, 'i'));
  return match ? xmlDecode(match[1].trim()) : '';
}

function parseRss(xml, source) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(match => {
    const item = match[1];
    const title = xmlField(item, 'title').replace(/\s+/g, ' ').trim();
    const link = xmlField(item, 'link').trim();
    const published = Date.parse(xmlField(item, 'pubDate'));
    if (!title || !Number.isFinite(published)) return null;
    try { if (new URL(link).protocol !== 'https:') return null; } catch { return null; }
    const id = createHash('sha256').update(link).digest('hex').slice(0, 16);
    return { id, title, link, published, source: source.name, policy: Boolean(source.policy) };
  }).filter(Boolean);
}

function newYorkOffsetMillis(utcApprox) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(utcApprox));
  const zone = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT';
  const match = zone.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0)) * 60_000;
}

function parseIcsDate(value) {
  const match = value.match(/(?:^|:)(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
  if (!match) return null;
  const [, y, m, d, h, minute, second, utc] = match;
  const millis = Date.UTC(+y, +m - 1, +d, +h, +minute, +second);
  const time = utc ? millis : millis - newYorkOffsetMillis(millis);
  return Number.isFinite(time) ? time : null;
}

function parseBlsCalendar(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  return [...unfolded.matchAll(/BEGIN:VEVENT\s*([\s\S]*?)END:VEVENT/g)].map(match => {
    const lines = match[1].split(/\r?\n/);
    const start = lines.find(line => line.startsWith('DTSTART'));
    const summary = lines.find(line => line.startsWith('SUMMARY:'));
    if (!start || !summary) return null;
    const at = parseIcsDate(start);
    const name = summary.slice(8).replace(/\\[,;]/g, ',').replace(/\\n/gi, ' ');
    const relevant = IMPORTANT_RELEASES.find(release => release.pattern.test(name));
    if (!relevant || !at) return null;
    const id = createHash('sha256').update(`${name}:${at}`).digest('hex').slice(0, 12);
    return { id, name: relevant.label, original: name, at, ping: relevant.ping, source: 'BLS', url: BLS_CALENDAR };
  }).filter(Boolean).sort((a, b) => a.at - b.at);
}

function parseBeaCalendar(payload) {
  const categories = [
    { key: 'Gross Domestic Product', label: 'GDP • Growth', ping: true },
    { key: 'Personal Income and Outlays', label: 'PCE • Inflation', ping: true },
  ];
  const events = [];
  for (const category of categories) {
    const dates = payload?.[category.key]?.release_dates;
    if (!Array.isArray(dates)) continue;
    for (const date of new Set(dates)) {
      const at = Date.parse(date);
      if (!Number.isFinite(at)) continue;
      const id = createHash('sha256').update(`${category.key}:${at}`).digest('hex').slice(0, 12);
      events.push({ id, name: category.label, original: category.key, at, ping: category.ping, source: 'BEA', url: 'https://www.bea.gov/news/schedule' });
    }
  }
  return events;
}

async function getText(url) {
  const result = await fetch(url, { headers: { 'User-Agent': 'OTRDiscordMarketDesk/1.0', Accept: 'application/rss+xml, application/xml, text/xml, text/calendar, */*' }, signal: AbortSignal.timeout(12000) });
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  const body = await result.text();
  if (body.length > 3_000_000) throw new Error('Feed exceeds size limit');
  return body;
}

function stamp(ms) { return `<t:${Math.floor(ms / 1000)}:F>`; }
function shortStamp(ms) { return `<t:${Math.floor(ms / 1000)}:R>`; }
function markerPresent(message, marker) {
  return message.embeds?.some(embed => embed.footer?.text?.includes(marker)) || false;
}
async function postOnce(channel, marker, payload) {
  if (sentMarkers.has(marker)) return false;
  const recent = await channel.messages.fetch({ limit: 100 });
  if (recent.some(message => message.author?.id === channel.client.user.id && markerPresent(message, marker))) {
    sentMarkers.add(marker);
    return false;
  }
  await channel.send(payload);
  sentMarkers.add(marker);
  return true;
}
function getTraderRole(guild) {
  return guild.roles.cache.find(role => !role.managed && role.name === 'Trader');
}
function mentionFor(role, shouldPing) {
  return shouldPing && role ? { content: `<@&${role.id}>`, allowedMentions: { roles: [role.id] } } : { allowedMentions: { parse: [] } };
}

async function scanNews(channel, role) {
  if (newsBusy) return;
  newsBusy = true;
  try {
    const responses = await Promise.allSettled(FEEDS.map(async feed => parseRss(await getText(feed.url), feed)));
    const items = responses.flatMap((response, i) => {
      if (response.status === 'fulfilled') return response.value;
      console.warn(`[intel] ${FEEDS[i].name} unavailable: ${response.reason.message}`);
      return [];
    });
    const recent = items.filter(item => item.published >= Date.now() - 3 * 60 * 60_000 && item.published <= Date.now() + 60_000 && (item.policy || RELEVANT.test(item.title)));
    // Prime new deployments without flooding the channel with old headlines.
    if (!scanNews.primed) {
      if (responses.some(response => response.status === 'fulfilled')) {
        recent.forEach(item => seenNews.add(item.id));
        scanNews.primed = true;
      }
      return;
    }
    const fresh = recent.filter(item => !seenNews.has(item.id)).sort((a, b) => a.published - b.published);
    fresh.forEach(item => seenNews.add(item.id));
    while (seenNews.size > 500) seenNews.delete(seenNews.values().next().value);
    for (const item of fresh.slice(-3)) {
      const policyAlert = item.policy && /(?:fomc|federal open market|target range|policy decision|federal funds rate)/i.test(item.title);
      const marker = `OTR_NEWS:${item.id}`;
      const embed = new EmbedBuilder()
        .setColor(policyAlert ? 0xf0b429 : 0x5865f2)
        .setTitle(policyAlert ? '🚨 Federal Reserve Policy Update' : '📰 OTR Market News')
        .setDescription(`**${item.title.slice(0, 250)}**\n[Read original story](${item.link})`)
        .addFields({ name: 'Source', value: item.source, inline: true }, { name: 'Published', value: shortStamp(item.published), inline: true })
        .setFooter({ text: `OTR Trading Intelligence • ${marker}` });
      await postOnce(channel, marker, { ...mentionFor(role, policyAlert), embeds: [embed] });
    }
  } finally { newsBusy = false; }
}

async function refreshCalendar() {
  if (Date.now() - calendarUpdatedAt < CALENDAR_REFRESH_MS) return;
  const results = await Promise.allSettled([
    getText(BLS_CALENDAR).then(parseBlsCalendar),
    getText(BEA_CALENDAR).then(text => parseBeaCalendar(JSON.parse(text))),
  ]);
  const events = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    console.warn(`[intel] ${index ? 'BEA' : 'BLS'} calendar unavailable: ${result.reason.message}`);
    return [];
  });
  if (!events.length) throw new Error('No official calendar events available');
  calendarEvents = events.sort((a, b) => a.at - b.at);
  calendarUpdatedAt = Date.now();
  console.log(`[intel] Loaded ${events.length} official economic releases.`);
}

function easternClock(date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

async function scanCalendar(channel, role) {
  if (calendarBusy) return;
  calendarBusy = true;
  try {
    try { await refreshCalendar(); } catch (error) { console.warn(`[intel] Calendar unavailable: ${error.message}`); }
    const now = Date.now();
    const clock = easternClock(new Date(now));
    // Daily 8:00–8:14 ET rundown without a role mention.
    if (clock.hour === '08' && Number(clock.minute) < 15) {
      const dayKey = `${clock.year}-${clock.month}-${clock.day}`;
      const todays = calendarEvents.filter(event => {
        const local = easternClock(new Date(event.at));
        return `${local.year}-${local.month}-${local.day}` === dayKey;
      });
      if (todays.length) {
        const marker = `OTR_CAL_DAY:${dayKey}`;
        const embed = new EmbedBuilder().setTitle('📅 OTR Economic Calendar • Today')
          .setColor(0x5865f2)
          .setDescription(todays.map(event => `• **${event.name}** • ${stamp(event.at)} ${event.ping ? '🔴 High impact' : '🟠 Watch'}`).join('\n'))
          .setFooter({ text: `Sources: BLS / BEA • ${marker}` });
        await postOnce(channel, marker, { embeds: [embed], allowedMentions: { parse: [] } });
      }
    }
    for (const event of calendarEvents) {
      const remaining = event.at - now;
      if (remaining < 0 || remaining > 15 * 60_000) continue;
      const marker = `OTR_CAL_ALERT:${event.id}`;
      const embed = new EmbedBuilder()
        .setTitle(`⏰ Economic Release Soon: ${event.name}`)
        .setDescription(`**${event.original.slice(0, 200)}**\nScheduled for ${stamp(event.at)} (${shortStamp(event.at)}).\nExpect possible volatility in **Gold, NQ and ES**. This is a schedule reminder, not released data.`)
        .setColor(event.ping ? 0xed4245 : 0xf0b429)
        .setFooter({ text: `Source: ${event.source} • Times subject to change • ${marker}` });
      await postOnce(channel, marker, { ...mentionFor(role, event.ping), embeds: [embed] });
    }
  } finally { calendarBusy = false; }
}

async function startTradingIntelligence(guild) {
  if (started || process.env.ENABLE_TRADING_INTELLIGENCE === 'false') return;
  await guild.channels.fetch();
  await guild.roles.fetch();
  const channel = guild.channels.cache.find(c => c.isTextBased?.() && c.name?.toLowerCase() === 'trading');
  if (!channel) { console.warn('[intel] #trading not found; intelligence disabled'); return; }
  started = true;
  const role = getTraderRole(guild);
  await Promise.allSettled([scanNews(channel, role), scanCalendar(channel, role)]);
  setInterval(() => scanNews(channel, role).catch(e => console.error('[intel] News scan failed:', e)), NEWS_INTERVAL_MS);
  setInterval(() => scanCalendar(channel, role).catch(e => console.error('[intel] Calendar scan failed:', e)), CALENDAR_INTERVAL_MS);
  console.log('[intel] Active: news 15m, calendar 5m, BLS/BEA releases, selective Trader pings.');
}

module.exports = { startTradingIntelligence, parseRss, parseBlsCalendar, parseBeaCalendar, easternClock };

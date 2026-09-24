const {
  EmbedBuilder,
} = require('discord.js');

const MARKET_SYMBOLS = [
  {
    key: 'NQ',
    symbol: 'NQ=F',
    label: 'NQ Futures',
    shortLabel: 'NQ',
  },
  {
    key: 'ES',
    symbol: 'ES=F',
    label: 'S&P Futures',
    shortLabel: 'ES',
  },
  {
    key: 'GC',
    symbol: 'GC=F',
    label: 'Gold Futures',
    shortLabel: 'Gold',
  },
];

const ALERT_THRESHOLDS = [0.5, 1.0, 1.5];
const ALERT_POLL_MS = 5 * 60 * 1000;
const DASHBOARD_MARKER = 'OTR_MARKET_DASHBOARD';

const alertState = new Map();
let hourlyTimeout = null;
let hourlyInterval = null;
let alertInterval = null;

function formatNumber(value) {
  if (!Number.isFinite(value)) return 'N/A';

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSigned(value, suffix = '') {
  if (!Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}${suffix}`;
}

function movementEmoji(percent) {
  if (!Number.isFinite(percent) || percent === 0) return '⚪';
  return percent > 0 ? '🟢' : '🔴';
}

async function fetchYahooChart(symbol) {
  const encoded = encodeURIComponent(symbol);
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=5m&range=1d&includePrePost=true`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?interval=5m&range=1d&includePrePost=true`,
  ];

  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 OTR-Market-Desk/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const result = payload?.chart?.result?.[0];

      if (!result?.meta) {
        throw new Error('Missing quote metadata');
      }

      const meta = result.meta;
      const closes = result.indicators?.quote?.[0]?.close || [];
      const lastClose = [...closes].reverse().find(Number.isFinite);

      const price = Number.isFinite(meta.regularMarketPrice)
        ? meta.regularMarketPrice
        : lastClose;

      const previousClose = Number.isFinite(meta.previousClose)
        ? meta.previousClose
        : meta.chartPreviousClose;

      if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose === 0) {
        throw new Error('Quote did not contain usable price/reference data');
      }

      const change = price - previousClose;
      const percent = (change / previousClose) * 100;

      return {
        price,
        previousClose,
        change,
        percent,
        currency: meta.currency || 'USD',
        marketState: meta.marketState || null,
        exchangeName: meta.fullExchangeName || meta.exchangeName || null,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Quote request failed');
}

async function fetchMarketQuotes() {
  return Promise.all(
    MARKET_SYMBOLS.map(async market => {
      try {
        const quote = await fetchYahooChart(market.symbol);
        return { ...market, ...quote, ok: true };
      } catch (error) {
        console.error(
          `[market] Failed to fetch ${market.symbol}: ${error.message}`,
        );

        return {
          ...market,
          ok: false,
          error: error.message,
        };
      }
    }),
  );
}

function buildDashboardEmbed(guild, quotes) {
  const now = Math.floor(Date.now() / 1000);
  const icon = guild.iconURL({
    extension: 'png',
    size: 256,
    forceStatic: true,
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 OTR Market Desk')
    .setDescription(
      [
        'Hourly futures snapshot for the OTR trading room.',
        `Last refreshed <t:${now}:R> • <t:${now}:t>`,
      ].join('\n'),
    )
    .setFooter({
      text: `${DASHBOARD_MARKER} • Alerts at ±0.50%, ±1.00%, ±1.50% vs previous close • Quotes may be delayed`,
    })
    .setTimestamp();

  if (icon) {
    embed.setThumbnail(icon);
  }

  for (const quote of quotes) {
    if (!quote.ok) {
      embed.addFields({
        name: quote.label,
        value: '⚠️ Data temporarily unavailable',
        inline: true,
      });
      continue;
    }

    const emoji = movementEmoji(quote.percent);
    embed.addFields({
      name: quote.label,
      value: [
        `**${formatNumber(quote.price)}**`,
        `${emoji} ${formatSigned(quote.change)} (${formatSigned(quote.percent, '%')})`,
        `Prev close: ${formatNumber(quote.previousClose)}`,
      ].join('\n'),
      inline: true,
    });
  }

  return embed;
}

function isDashboardMessage(message) {
  if (!message || message.author?.id !== message.client.user?.id) return false;

  return message.embeds?.some(
    embed => embed.footer?.text?.includes(DASHBOARD_MARKER),
  );
}

async function getTradingChannel(guild) {
  await guild.channels.fetch();

  return guild.channels.cache.find(
    channel =>
      channel.isTextBased?.() &&
      channel.name?.toLowerCase() === 'trading',
  );
}

async function findDashboardMessage(channel) {
  const recent = await channel.messages.fetch({ limit: 100 });
  return recent.find(isDashboardMessage) || null;
}

async function updateDashboard(guild, suppliedQuotes = null) {
  const channel = await getTradingChannel(guild);

  if (!channel) {
    throw new Error('Could not find #trading for market dashboard.');
  }

  const quotes = suppliedQuotes || await fetchMarketQuotes();

  if (!quotes.some(quote => quote.ok)) {
    console.warn('[market] Dashboard refresh skipped because every quote failed.');
    return;
  }

  const embed = buildDashboardEmbed(guild, quotes);
  const existing = await findDashboardMessage(channel);

  if (existing) {
    await existing.edit({ embeds: [embed] });
    console.log(`[market] Dashboard refreshed: ${existing.id}`);
  } else {
    const sent = await channel.send({ embeds: [embed] });
    console.log(`[market] Dashboard posted: ${sent.id}`);
  }
}

function stateForQuote(quote) {
  const referenceKey = `${quote.symbol}:${quote.previousClose}`;
  let state = alertState.get(quote.key);

  if (!state || state.referenceKey !== referenceKey) {
    state = {
      referenceKey,
      initialized: false,
      up: new Set(),
      down: new Set(),
    };
    alertState.set(quote.key, state);
  }

  return state;
}

function primeThresholdState(state, percent) {
  const directionSet = percent >= 0 ? state.up : state.down;
  const magnitude = Math.abs(percent);

  for (const threshold of ALERT_THRESHOLDS) {
    if (magnitude >= threshold) {
      directionSet.add(threshold);
    }
  }

  state.initialized = true;
}

function nextCrossedThreshold(state, percent) {
  const directionSet = percent >= 0 ? state.up : state.down;
  const magnitude = Math.abs(percent);

  const newlyCrossed = ALERT_THRESHOLDS.filter(
    threshold => magnitude >= threshold && !directionSet.has(threshold),
  );

  if (!newlyCrossed.length) return null;

  const highest = Math.max(...newlyCrossed);

  for (const threshold of ALERT_THRESHOLDS) {
    if (threshold <= highest) {
      directionSet.add(threshold);
    }
  }

  return highest;
}

function buildAlertEmbed(quote, threshold) {
  const up = quote.percent > 0;
  const direction = up ? 'up' : 'down';
  const color = up ? 0x57f287 : 0xed4245;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`🚨 ${quote.shortLabel} Movement Alert`)
    .setDescription(
      `**${quote.label}** crossed the **${up ? '+' : '-'}${threshold.toFixed(2)}%** session threshold.`,
    )
    .addFields(
      {
        name: 'Current',
        value: formatNumber(quote.price),
        inline: true,
      },
      {
        name: 'Move',
        value: `${formatSigned(quote.change)} (${formatSigned(quote.percent, '%')})`,
        inline: true,
      },
      {
        name: 'Previous close',
        value: formatNumber(quote.previousClose),
        inline: true,
      },
    )
    .setFooter({
      text: `OTR Market Alert • ${direction} threshold only pings once per session`,
    })
    .setTimestamp();
}

async function checkMarketAlerts(guild, suppliedQuotes = null, initializeOnly = false) {
  const channel = await getTradingChannel(guild);

  if (!channel) {
    throw new Error('Could not find #trading for market alerts.');
  }

  await guild.roles.fetch();

  const traderRole = guild.roles.cache.find(
    role => !role.managed && role.name === 'Trader',
  );

  if (!traderRole) {
    console.warn('[market] Trader role not found; alert pings are disabled.');
  }

  const quotes = suppliedQuotes || await fetchMarketQuotes();

  for (const quote of quotes) {
    if (!quote.ok) continue;

    const state = stateForQuote(quote);

    if (!state.initialized || initializeOnly) {
      primeThresholdState(state, quote.percent);
      continue;
    }

    const crossed = nextCrossedThreshold(state, quote.percent);
    if (!crossed) continue;

    const embed = buildAlertEmbed(quote, crossed);

    await channel.send({
      content: traderRole ? `<@&${traderRole.id}>` : undefined,
      embeds: [embed],
      allowedMentions: traderRole
        ? { roles: [traderRole.id] }
        : { parse: [] },
    });

    console.log(
      `[market] Alert sent: ${quote.key} ${formatSigned(quote.percent, '%')} crossed ${crossed.toFixed(2)}%.`,
    );
  }
}

function scheduleHourlyDashboard(guild) {
  const now = Date.now();
  const nextHour = Math.ceil(now / (60 * 60 * 1000)) * 60 * 60 * 1000;
  const delay = Math.max(5000, nextHour - now + 10000);

  hourlyTimeout = setTimeout(async () => {
    try {
      await updateDashboard(guild);
    } catch (error) {
      console.error('[market] Hourly dashboard update failed:', error);
    }

    hourlyInterval = setInterval(async () => {
      try {
        await updateDashboard(guild);
      } catch (error) {
        console.error('[market] Hourly dashboard update failed:', error);
      }
    }, 60 * 60 * 1000);
  }, delay);
}

async function startMarketDesk(guild) {
  if (hourlyTimeout || hourlyInterval || alertInterval) {
    console.log('[market] Market desk already scheduled.');
    return;
  }

  const initialQuotes = await fetchMarketQuotes();

  await updateDashboard(guild, initialQuotes);
  await checkMarketAlerts(guild, initialQuotes, true);

  scheduleHourlyDashboard(guild);

  alertInterval = setInterval(async () => {
    try {
      await checkMarketAlerts(guild);
    } catch (error) {
      console.error('[market] Alert check failed:', error);
    }
  }, ALERT_POLL_MS);

  console.log('[market] Market desk is ready: hourly dashboard + 5-minute alert checks.');
}

module.exports = {
  MARKET_SYMBOLS,
  ALERT_THRESHOLDS,
  startMarketDesk,
  updateDashboard,
  checkMarketAlerts,
};

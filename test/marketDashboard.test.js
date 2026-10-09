const { test } = require('node:test');
const assert = require('node:assert/strict');
const { movementAlertsEnabled, checkMarketAlerts } = require('../src/marketDashboard');

test('market movement notifications default to off', () => {
  const original = process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
  delete process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
  try {
    assert.equal(movementAlertsEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
    else process.env.ENABLE_MARKET_MOVEMENT_ALERTS = original;
  }
});

test('explicit opt-in is required for movement alerts', () => {
  const original = process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
  try {
    process.env.ENABLE_MARKET_MOVEMENT_ALERTS = 'false';
    assert.equal(movementAlertsEnabled(), false);
    process.env.ENABLE_MARKET_MOVEMENT_ALERTS = 'true';
    assert.equal(movementAlertsEnabled(), true);
    process.env.ENABLE_MARKET_MOVEMENT_ALERTS = 'TRUE';
    assert.equal(movementAlertsEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
    else process.env.ENABLE_MARKET_MOVEMENT_ALERTS = original;
  }
});

test('disabled alert check does not access Discord channels or fetch quotes', async () => {
  const original = process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
  process.env.ENABLE_MARKET_MOVEMENT_ALERTS = 'false';
  try {
    const unreachableGuild = { channels: { fetch() { throw new Error('Discord should not be touched'); } } };
    await assert.doesNotReject(checkMarketAlerts(unreachableGuild));
  } finally {
    if (original === undefined) delete process.env.ENABLE_MARKET_MOVEMENT_ALERTS;
    else process.env.ENABLE_MARKET_MOVEMENT_ALERTS = original;
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRss, parseBlsCalendar, parseBeaCalendar, easternClock } = require('../src/tradingIntelligence');

test('RSS parser handles CDATA, links and rejects invalid URLs', () => {
  const rss = `<rss><channel>
    <item><title><![CDATA[Fed &amp; markets]]></title><link>https://www.federalreserve.gov/release</link><pubDate>Thu, 08 Oct 2026 15:00:00 GMT</pubDate></item>
    <item><title>Bad</title><link>javascript:alert(1)</link><pubDate>Thu, 08 Oct 2026 15:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = parseRss(rss, { name: 'Federal Reserve', policy: true });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Fed & markets');
  assert.equal(items[0].policy, true);
  assert.match(items[0].id, /^[a-f0-9]{16}$/);
});

test('BLS parser uses daylight time and filters important events', () => {
  const ics = 'BEGIN:VEVENT\nSUMMARY:Consumer Price Index for September 2026\nDTSTART;TZID=America/New_York:20261014T083000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Minor Release\nDTSTART;TZID=America/New_York:20261015T083000\nEND:VEVENT';
  const items = parseBlsCalendar(ics);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'CPI • Inflation');
  assert.equal(items[0].ping, true);
  assert.equal(new Date(items[0].at).toISOString(), '2026-10-14T12:30:00.000Z');
});

test('BLS parser handles standard-time offset and folded lines', () => {
  const ics = 'BEGIN:VEVENT\nSUMMARY:Employment Situa\n tion for January 2027\nDTSTART:20270205T083000\nEND:VEVENT';
  const [item] = parseBlsCalendar(ics);
  assert.equal(item.name, 'NFP • Jobs Report');
  assert.equal(new Date(item.at).toISOString(), '2027-02-05T13:30:00.000Z');
});

test('Eastern date formatting is server-timezone independent', () => {
  const clock = easternClock(new Date('2026-10-14T12:05:00.000Z'));
  assert.equal(clock.hour, '08');
  assert.equal(clock.minute, '05');
});

test('BEA calendar parses GDP/PCE and deduplicates dates', () => {
  const items = parseBeaCalendar({
    'Gross Domestic Product': { release_dates: ['2026-10-29T12:30:00+00:00', '2026-10-29T12:30:00+00:00'] },
    'Personal Income and Outlays': { release_dates: ['2026-10-29T12:30:00+00:00'] },
    'Other': { release_dates: ['2026-10-29T12:30:00+00:00'] },
  });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.name), ['GDP • Growth', 'PCE • Inflation']);
});

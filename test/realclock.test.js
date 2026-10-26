// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout) and a
// real local HTTP server playing the device: the reads really start, at 0,
// the interval and twice the interval, with a bounded number of timers. The
// time is sped up 100 times (30 s of the interval are 300 ms) but it is the
// real clock: it moves between any two reads of it. Run 20 times, with wide
// margins: late under load, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PureEnergieApp } from '../src/app.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { info, meter } from './fixtures/net2grid.js';

const SPEED = 100;
const RUNS = 20;

async function oneRun(server, port) {
  let timersSet = 0;
  const timers = {
    setTimeout(fn, ms) {
      timersSet += 1;
      return setTimeout(fn, Math.max(0, ms) / SPEED);
    },
    clearTimeout: (id) => clearTimeout(id),
  };
  const gladys = createFakeGladys({ selector: 'pure-energie', config: {} });
  await gladys.connect();
  const quiet = () => {};
  const app = new PureEnergieApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: () => Date.now() * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    store: createMemoryStore(),
  });
  // The method that runs once a read is decided (not the requests: their latency blurs the period).
  const reads = [];
  const readAll = app.readAll.bind(app);
  app.readAll = (...args) => {
    reads.push(performance.now() * SPEED);
    return readAll(...args);
  };
  const started = performance.now() * SPEED;
  await app.start({ address: `127.0.0.1:${port}` });
  const deadline = started + POLL_INTERVAL;
  while (reads.length === 0 && performance.now() * SPEED < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const until = (reads[0] ?? started) + 2.5 * POLL_INTERVAL;
  while (performance.now() * SPEED < until) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await app.stop();
  const at = reads.map((t) => Math.round(t - started));
  assert.equal(reads.length, 3, `reads at ${at}`);
  assert.ok(reads[0] - started < POLL_INTERVAL / 2, `the first read at once: ${at}`);
  for (let i = 1; i < reads.length; i += 1) {
    const gap = reads[i] - reads[i - 1];
    assert.ok(gap >= 0.99 * POLL_INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * POLL_INTERVAL, `on time: ${at}`);
  }
  assert.ok(timersSet <= 10, `${timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
}

test(`real clock: reads at 0, the interval and twice the interval, ${RUNS} runs`, async () => {
  const server = createServer((req, res) => {
    const body =
      req.url === '/info'
        ? info()
        : req.url === '/meter/now'
          ? meter({ t: Date.now() })
          : undefined;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const runs = Array.from({ length: RUNS }, () => oneRun(server, port));
    await Promise.all(runs);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

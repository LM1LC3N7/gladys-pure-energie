// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted device and a virtual clock.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { PureEnergieApp } from '../../src/app.js';
import { ORDER, buildDevice } from '../../src/devices.js';
import { Net2GridClient } from '../../src/net2grid/client.js';
import { ADDRESS, ID, NOW, info, json, meter } from '../fixtures/net2grid.js';
import { createFetch, timeoutError } from './fakeNet.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'pure-energie';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const F = (key, id = ID) => `ext:${SELECTOR}:meter:${id}:${key}`;
export const CONFIG = { address: ADDRESS };

/** The device as the user created it, the index Gladys holds when given. */
export function created({ id = ID, index, keys = ORDER } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, { id, model: 'SBWF3102' }, new Set(keys), ADDRESS);
  if (index) {
    const feature = device.features.find((f) => f.external_id === F('consumption_index', id));
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

/** The answers of a default device, by path, at the device time `t` (ms). */
export const defaults = {
  '/info': () => info(),
  // The device dates its values with the time of the read (it renews them every second).
  '/meter/now': (t) => meter({ t }),
};

/**
 * The device: `world(path, t, init)` -> an answer object | 'timeout' |
 * a Response | undefined (404).
 */
export function createDevice(world = (path, t) => defaults[path]?.(t)) {
  const dev = { world, clock: { now: NOW } };
  dev.net = createFetch(async ({ path, init }) => {
    // An answer may be a promise: a slow page, released by the test.
    const answer = await dev.world(path, dev.clock.now, init);
    if (answer === 'timeout') throw timeoutError();
    if (answer instanceof Response) return answer;
    if (answer === undefined) return new Response('not found', { status: 404 });
    return json(answer);
  });
  return dev;
}

export async function setup({
  devices: known = [],
  store,
  now = NOW,
  dev = createDevice(),
  config = CONFIG,
  wall = { offset: 0 },
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices: known });
  await gladys.connect();
  const { clock, timers, advance } = createFakeClock(now);
  let drift = 0;
  dev.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const { createMemoryStore } = await import('../../src/store.js');
  const kept = store ?? createMemoryStore();
  const app = new PureEnergieApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    // The wall clock may be set apart from the monotonic one (`wall.offset`);
    // it moves too between two reads of it.
    now: () => clock.now + wall.offset + (drift += 0.001),
    // A real monotonic clock moves between two reads of it: 1 µs per call
    // here, so that a decision reading the clock twice is caught.
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store: kept,
    clientFactory: (options) => new Net2GridClient({ ...options, fetchImpl: dev.net.fetch }),
  });
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  const wait = async (ms) => {
    await advance(ms);
    await app.idle();
  };
  return { app, gladys, clock, store: kept, dev, start, wait, advance, lines };
}

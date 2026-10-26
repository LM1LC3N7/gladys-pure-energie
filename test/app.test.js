// -----------------------------------------------------------------------------
// The app end to end against the SDK's fake Gladys, a scripted NET2GRID
// device and a virtual clock (that moves at every read of it): discovery,
// states, the guarded index, freshness, identity, the pace, late answers,
// pauses, /data, buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import {
  ADDRESS,
  ID,
  NOW,
  OTHER_ID,
  OTHER_RAW_ID,
  info,
  json,
  meter,
} from './fixtures/net2grid.js';
import {
  CONFIG,
  F,
  HOUR,
  MINUTE,
  SECOND,
  created,
  createDevice,
  defaults,
  setup,
} from './helpers/app.js';

const statesOf = (gladys, key, id) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F(key, id)).map((s) => s.state);
const status = (s) => s.gladys.fake.connectionStatus;
const pathsOf = (dev) => dev.net.calls.map((c) => c.path);

/** A device whose answers come from `defaults`, overridden by `answers`. */
const deviceWith = (answers) =>
  createDevice((path, t, init) => {
    const own = answers[path] ?? defaults[path];
    return own?.(t, init);
  });

test('without a device: it is offered in Discovery, the status says so', async () => {
  const s = await setup();
  await s.start();
  assert.deepEqual(pathsOf(s.dev), ['/info', '/meter/now', '/info']);
  const [device] = s.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, `ext:pure-energie:meter:${ID}`);
  assert.equal(device.name, 'Pure Energie SBWF3102 3795');
  assert.deepEqual(
    device.features.map((f) => [f.external_id.split(':').at(-1), f.category, f.type, f.unit]),
    [
      ['power', 'energy-sensor', 'power', 'watt'],
      ['consumption_index', 'energy-sensor', 'index', 'kilowatt-hour'],
      ['injection_index', 'unknown', 'decimal', undefined],
    ],
  );
  assert.equal(device.features[0].min, -10_000_000, 'the power is signed');
  assert.deepEqual(
    device.params.map((p) => p.name),
    ['address', 'net2grid_id', 'model', 'firmware'],
  );
  assert.equal(status(s).connected, true);
  assert.match(status(s).message.en, /Create its device from the "Discover" tab/);
  assert.equal(s.gladys.fake.states.length, 0);
});

test('a created device: the power every 30 s, the indexes once a minute', async () => {
  let wh = 9_000_000;
  const dev = deviceWith({ '/meter/now': (t) => meter({ t, imported: wh, power: -800 }) });
  const s = await setup({ devices: [created()], dev });
  await s.start();
  assert.deepEqual(statesOf(s.gladys, 'power'), [-800]);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000]);
  assert.deepEqual(statesOf(s.gladys, 'injection_index'), [21_214.589]);
  wh = 9_000_500;
  await s.wait(30 * SECOND);
  assert.equal(s.dev.net.calls.length, 6, 'one read every 30 s');
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000], 'not before a minute');
  await s.wait(30 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'consumption_index'), [9000, 9000.5]);
  assert.match(status(s).message.en, new RegExp(`Connected to .*SBWF3102 ${ID} \\(${ADDRESS}\\)`));
  assert.doesNotMatch(status(s).message.en, /Create its device/);
  assert.equal(s.gladys.fake.sceneEvents.length, 0);
});

test('the index: never 0, a jump held until the user accepts it in two clicks', async () => {
  let wh = 9_000_000;
  const dev = deviceWith({ '/meter/now': (t) => meter({ t, imported: wh }) });
  const s = await setup({ devices: [created({ index: { value: 9000, at: NOW - MINUTE } })], dev });
  await s.start();
  wh = 0;
  await s.wait(MINUTE);
  wh = 19_000_000;
  await s.wait(MINUTE);
  await s.wait(MINUTE);
  const published = statesOf(s.gladys, 'consumption_index');
  assert.ok(!published.includes(0));
  assert.ok(!published.includes(19_000));
  assert.match(status(s).message.en, /it jumped from 9000 to 19000 kWh/);
  assert.equal(s.store.data.indexes[F('consumption_index')].held.to, 19_000);
  const first = await s.app.acceptHeldIndex();
  assert.match(
    first.en,
    /A second click accepts this value.*at most 8\.833 kWh.*from 9000 to 19000/,
  );
  await s.wait(MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(19_000), 'one click takes nothing');
  const ack = await s.app.acceptHeldIndex();
  assert.match(ack.en, /Accepted: index 19000 kWh/);
  await s.wait(MINUTE);
  assert.equal(statesOf(s.gladys, 'consumption_index').at(-1), 19_000);
  assert.doesNotMatch(status(s).message.en, /jumped/);
  assert.equal(
    (await s.app.acceptHeldIndex()).en,
    'No consumption index is held back: nothing to accept.',
  );
});

test('the second click too soon, too late or after the value changed accepts nothing', async () => {
  let wh = 9_000_000;
  const dev = deviceWith({ '/meter/now': (t) => meter({ t, imported: wh }) });
  const s = await setup({ devices: [created({ index: { value: 9000, at: NOW - MINUTE } })], dev });
  await s.start();
  wh = 19_000_000;
  await s.wait(MINUTE);
  await s.app.acceptHeldIndex();
  const soon = await s.app.acceptHeldIndex();
  assert.match(soon.en, /A second click accepts/, 'too soon: listed again');
  await s.wait(6 * MINUTE);
  const late = await s.app.acceptHeldIndex();
  assert.match(late.en, /A second click accepts/, 'too late: listed again');
  wh = 5_000_000;
  await s.wait(MINUTE);
  const changed = await s.app.acceptHeldIndex();
  assert.match(changed.en, /Not accepted: the held value changed/);
  await s.wait(MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(19_000));
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(5000));
});

test('a held index survives a restart; saving the configuration accepts nothing', async () => {
  const store = createMemoryStore();
  const dev = deviceWith({ '/meter/now': (t) => meter({ t, imported: 500_000 }) });
  const device = created({ index: { value: 9000, at: NOW - MINUTE } });
  let s = await setup({ devices: [device], dev, store });
  await s.start();
  await s.app.start(CONFIG);
  await s.wait(MINUTE);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(500));
  await s.app.stop();
  s = await setup({ devices: [device], dev, store, now: s.clock.now + MINUTE });
  await s.start();
  assert.match(status(s).message.en, /dropped from 9000 to 500 kWh/);
  assert.ok(!statesOf(s.gladys, 'consumption_index').includes(500));
});

test('the pace: never two reads less than 30 s apart, whatever asks', async () => {
  const store = createMemoryStore();
  const dev = createDevice();
  const s = await setup({ dev, store });
  await s.start();
  const one = dev.net.calls.length;
  await s.app.start(CONFIG);
  await s.app.scan();
  await s.app.start(await s.gladys.getConfig());
  await s.app.onDeviceCreated(created());
  await s.app.onDeviceUpdated(created());
  await s.app.acceptHeldIndex();
  const test1 = await s.app.testConnection();
  assert.match(test1.en, /Last read .* ago.*Next read in 30 s/);
  await s.wait(29 * SECOND);
  assert.equal(dev.net.calls.length, one, 'a reconnection, a save, a scan, the test: no read');
  await s.wait(SECOND);
  assert.equal(dev.net.calls.length, 2 * one);
  // A restart of the container 2 s after a read: the time is in /data.
  await s.app.stop();
  const again = await setup({ dev, store, now: s.clock.now + 2 * SECOND });
  await again.start();
  assert.equal(dev.net.calls.length, 2 * one);
  assert.ok(store.data.lastAttemptAt <= s.clock.now + 1);
  await again.wait(29 * SECOND);
  assert.equal(dev.net.calls.length, 3 * one, 'the interval counted from the read before');
});

test('the pace holds when the wall clock jumps; /data dates never in the future', async () => {
  const wall = { offset: 0 };
  const store = createMemoryStore();
  const s = await setup({ store, wall });
  await s.start();
  const one = s.dev.net.calls.length;
  wall.offset = -2 * HOUR;
  await s.wait(30 * SECOND);
  assert.equal(s.dev.net.calls.length, 2 * one, 'a clock set back stops nothing');
  wall.offset = 5 * HOUR;
  await s.wait(10 * SECOND);
  assert.equal(s.dev.net.calls.length, 2 * one, 'a clock set forward hurries nothing');
  await s.wait(20 * SECOND);
  assert.equal(s.dev.net.calls.length, 3 * one);
  // A restart with /data dated in the future (the clock was ahead): brought to now.
  await s.app.stop();
  wall.offset = 0;
  const again = await setup({ store, wall, dev: s.dev, now: s.clock.now });
  await again.start();
  assert.equal(s.dev.net.calls.length, 4 * one, 'a future date is not a recent read');
});

test('freshness: a reading whose time has not moved is never published again', async () => {
  let t = NOW;
  let power = 500;
  const dev = deviceWith({ '/meter/now': () => meter({ t, power }) });
  const s = await setup({ devices: [created()], dev });
  await s.start();
  assert.deepEqual(statesOf(s.gladys, 'power'), [500]);
  power = 900; // a value changed under the same time: not a new reading
  await s.wait(15 * MINUTE);
  assert.deepEqual(statesOf(s.gladys, 'power'), [500], 'nothing, not even the heartbeat');
  assert.doesNotMatch(status(s).message.en, /not given new values/);
  t = NOW + 16 * MINUTE;
  await s.wait(30 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [500, 900]);
  await s.wait(2 * HOUR);
  assert.match(status(s).message.en, /has not given new values for 2 h or more/);
  assert.equal(status(s).connected, true);
  const told = await (async () => {
    await s.wait(30 * SECOND);
    return s.app.testConnection();
  })();
  assert.match(told.en, /power \?.*values not renewed/);
  t = NOW + 3 * HOUR;
  power = 1000;
  await s.wait(30 * SECOND);
  assert.doesNotMatch(status(s).message.en, /not given new values/);
  assert.equal(statesOf(s.gladys, 'power').length, 3);
});

test('freshness: nothing old is sent at a restart, a reconnection or a device created', async () => {
  const store = createMemoryStore();
  const t = NOW;
  const dev = deviceWith({ '/meter/now': () => meter({ t }) });
  let s = await setup({ devices: [created()], dev, store });
  await s.start();
  assert.equal(statesOf(s.gladys, 'power').length, 1);
  assert.match(store.data.fresh.mark, /^t\d{13}$/);
  // Reconnection to Gladys: the published states are forgotten, the old reading stays old.
  await s.app.start(await s.gladys.getConfig());
  await s.wait(30 * SECOND);
  await s.app.onDeviceCreated(created());
  await s.wait(30 * SECOND);
  assert.equal(statesOf(s.gladys, 'power').length, 1);
  await s.app.stop();
  // A restart of the container: the time of the values is in /data.
  s = await setup({ devices: [created()], dev, store, now: s.clock.now + MINUTE });
  await s.start();
  assert.equal(s.gladys.fake.states.length, 0, 'the same reading after a restart: not sent');
  // A future date in /data is not valid: the reading counts as new.
  store.data.fresh.at = s.clock.now + HOUR;
  const s2 = await setup({ devices: [created()], dev, store, now: s.clock.now + MINUTE });
  await s2.start();
  assert.equal(statesOf(s2.gladys, 'power').length, 1);
});

test('freshness without a time of reading: a fingerprint of the values', async () => {
  let power = 400;
  const noTime = (t) => {
    const m = meter({ t, power });
    for (const key of ['power', 'import', 'export']) delete m.elec[key].now.time;
    return m;
  };
  const dev = deviceWith({ '/meter/now': noTime });
  const s = await setup({ devices: [created()], dev });
  await s.start();
  await s.wait(30 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [400]);
  assert.match(s.store.data.fresh.mark, /^f[0-9a-f]{8}$/);
  power = 410;
  await s.wait(30 * SECOND);
  assert.deepEqual(statesOf(s.gladys, 'power'), [400, 410]);
});

test('identity: another id during the read, or none, publishes nothing', async () => {
  let calls = 0;
  let mode = 'swap';
  const dev = deviceWith({
    '/info': () => {
      calls += 1;
      if (mode === 'swap') return info(calls % 2 === 0 ? OTHER_RAW_ID : undefined);
      if (mode === 'none') return { ...info(), id: '' };
      return info();
    },
  });
  const s = await setup({ devices: [created()], dev });
  await s.start();
  assert.equal(s.gladys.fake.states.length, 0);
  assert.match(status(s).message.en, /another device answered during the read, nothing published/);
  mode = 'none';
  await s.wait(30 * SECOND);
  assert.equal(s.gladys.fake.states.length, 0);
  assert.match(status(s).message.en, /its id cannot be read, nothing published/);
  assert.equal(s.gladys.fake.discoveredDevices.length, 0, 'no device without an id');
  mode = 'ok';
  await s.wait(10 * MINUTE);
  assert.equal(statesOf(s.gladys, 'power').length, 1);
});

test('identity: another device at the address gets its own device', async () => {
  let id = undefined;
  const dev = deviceWith({ '/info': () => info(id) });
  const s = await setup({ devices: [created()], dev });
  await s.start();
  assert.equal(statesOf(s.gladys, 'power').length, 1);
  id = OTHER_RAW_ID;
  await s.wait(30 * SECOND);
  assert.equal(statesOf(s.gladys, 'power').length, 1, 'the old device gets nothing more');
  assert.equal(statesOf(s.gladys, 'power', OTHER_ID).length, 0, 'not created yet');
  assert.equal(
    s.gladys.fake.discoveredDevices.at(-1).external_id,
    `ext:pure-energie:meter:${OTHER_ID}`,
  );
  assert.match(
    status(s).message.en,
    new RegExp(`Another device answers at this address \\(id ${OTHER_ID}\\)`),
  );
});

test('a late answer of an old address publishes nothing and sets no status', async () => {
  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  const dev = deviceWith({ '/meter/now': (t) => slow.then(() => meter({ t })) });
  const s = await setup({ dev, devices: [created()] });
  await s.app.start(CONFIG);
  // Not awaited: the timer runs the read, which waits for the held answer.
  const running = s.advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pathsOf(dev), ['/info', '/meter/now']);
  await s.app.start({ address: '192.168.1.61' });
  const statuses = s.gladys.fake.connectionStatuses.length;
  release();
  await running;
  await s.app.idle();
  assert.equal(s.gladys.fake.states.length, 0);
  assert.equal(s.gladys.fake.connectionStatuses.length, statuses);
  assert.equal(dev.net.calls.length, 2, 'the old read stops, the new one waits for its turn');
  assert.match(status(s).message.en, /Waiting for the first answer .* 192\.168\.1\.61/);
});

test('429 or 5xx: a pause kept in /data, never faster, kept by a reconnection', async () => {
  const store = createMemoryStore();
  let answer = () => json('', { status: 429, headers: { 'retry-after': '300' } });
  const dev = deviceWith({ '/info': () => answer() });
  const s = await setup({ dev, store });
  await s.start();
  assert.match(status(s).message.en, /asks to wait \(too many requests\).*5 min/);
  assert.equal(store.data.pause.code, 'rate_limited');
  await s.app.start(await s.gladys.getConfig());
  assert.equal((await s.app.testConnection()).en, status(s).message.en);
  await s.wait(4 * MINUTE);
  assert.equal(dev.net.calls.length, 1);
  answer = () => json('', { status: 503 });
  await s.wait(MINUTE);
  assert.equal(dev.net.calls.length, 2);
  assert.match(status(s).message.en, /error of the device/);
  await s.app.stop();
  // A restart: the pause is in /data.
  const again = await setup({ dev, store, now: s.clock.now + 10 * SECOND });
  await again.start();
  assert.equal(dev.net.calls.length, 2);
  answer = () => info();
  await again.wait(2 * MINUTE);
  assert.equal(dev.net.calls.length, 5);
  assert.equal(store.data.pause, null);
  // Another address ends a pause.
  answer = () => json('', { status: 500 });
  await again.wait(30 * SECOND);
  assert.ok(again.app.pause);
  await again.app.start({ address: '192.168.1.61' });
  assert.equal(again.app.pause, undefined);
});

test('an unreachable device: retries doubled, the status says so', async () => {
  const dev = deviceWith({ '/info': () => 'timeout' });
  const s = await setup({ dev });
  await s.start();
  assert.match(status(s).message.en, /could not be read \(no answer\): new try in 30 s/);
  await s.wait(30 * SECOND);
  assert.match(status(s).message.en, /new try in 1 min/);
  await s.wait(MINUTE);
  assert.equal(dev.net.calls.length, 3);
  assert.equal(status(s).connected, false);
});

test('not a NET2GRID device, or a meter reading not ok: refused, nothing published', async () => {
  const dev = deviceWith({ '/meter/now': () => ({ hello: 'world' }) });
  const s = await setup({ dev, devices: [created()] });
  await s.start();
  assert.match(status(s).message.en, /not an answer of a NET2GRID meter reader/);
  const dev2 = deviceWith({ '/meter/now': () => ({ status: 'error', elec: {} }) });
  const s2 = await setup({ dev: dev2, devices: [created()] });
  await s2.start();
  assert.match(status(s2).message.en, /its meter reading is not ok/);
  assert.equal(s.gladys.fake.states.length + s2.gladys.fake.states.length, 0);
});

test('an index in an unknown unit is never sent; the power still is', async () => {
  const dev = deviceWith({
    '/meter/now': (t) => {
      const m = meter({ t });
      m.elec.import.now.unit = 'MWh';
      return m;
    },
  });
  const s = await setup({ dev, devices: [created()] });
  await s.start();
  assert.equal(statesOf(s.gladys, 'consumption_index').length, 0);
  assert.equal(statesOf(s.gladys, 'power').length, 1);
  assert.match(status(s).message.en, /a unit this integration does not read/);
});

test('/data unreadable: never written over, said in the status', async () => {
  const store = createMemoryStore();
  store.save({ unreadable: true });
  let saves = 0;
  const watched = {
    load: () => store.load(),
    async save(data) {
      saves += 1;
      return store.save(data);
    },
  };
  const s = await setup({ store: watched, devices: [created()] });
  await s.start();
  await s.app.onDeviceCreated(created());
  await s.wait(MINUTE);
  await s.app.stop();
  assert.equal(saves, 0);
  assert.match(status(s).message.en, /cannot be read: it is left as it is/);
  assert.equal(s.dev.net.calls.length, 9, 'the reads go on');
  assert.equal(statesOf(s.gladys, 'power').length, 1);
});

test('/data not writable: the values go on', async () => {
  const store = {
    load: () => ({}),
    save: async () => {
      throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
    },
  };
  const s = await setup({ store, devices: [created()] });
  await s.start();
  assert.equal(statesOf(s.gladys, 'consumption_index').length, 1);
  assert.ok(
    s.lines.some((l) => /Saving the pure-energie state in \/data failed \(EROFS\)/.test(l)),
  );
});

test('a device created: its index state is cleared, by the form of its id alone', async () => {
  const store = createMemoryStore({
    indexes: {
      [F('consumption_index')]: {
        last: { value: 9000, at: NOW - HOUR },
        held: { direction: 'up', from: 9000, to: 99_000, threshold: 99_000, at: NOW },
      },
    },
  });
  const s = await setup({ store });
  await s.app.onDeviceCreated({ external_id: `ext:pure-energie:meter:${ID}` });
  assert.equal(store.data.indexes[F('consumption_index')], undefined);
  await s.app.onDeviceCreated({ external_id: 'ext:pure-energie:meter:..' });
  await s.app.onDeviceCreated({ external_id: 'ext:other:meter:abc' });
});

test('every connection publishes the status and the Discovery list again', async () => {
  const s = await setup();
  await s.start();
  const statuses = s.gladys.fake.connectionStatuses.length;
  const discoveries = s.gladys.fake.bodies('POST', '/discovered_device').length;
  // What index.js does on every `connected`.
  await s.app.start(await s.gladys.getConfig());
  await s.app.idle();
  assert.equal(s.gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(s.gladys.fake.bodies('POST', '/discovered_device').length, discoveries + 1);
});

test('a restart offers the device seen before the first read', async () => {
  const store = createMemoryStore();
  const s = await setup({ store });
  await s.start();
  await s.app.stop();
  const dev = deviceWith({ '/info': () => 'timeout' });
  const again = await setup({ store, dev, now: s.clock.now + MINUTE });
  await again.start();
  assert.equal(again.gladys.fake.discoveredDevices[0].external_id, `ext:pure-energie:meter:${ID}`);
});

test('the configuration: empty, a bad address', async () => {
  const s = await setup({ config: {} });
  await s.start();
  assert.match(status(s).message.en, /Enter the address/);
  await s.app.start({ address: '255.255.255.255' });
  assert.match(status(s).message.en, /The address is not valid/);
  assert.match((await s.app.testConnection()).en, /The address is not valid/);
  assert.equal(s.dev.net.calls.length, 0);
});

test('the test button: reads when due, otherwise tells the last read', async () => {
  const s = await setup({ devices: [created()] });
  await s.app.start({ address: 'x..y' });
  const s2 = await setup({ devices: [created()] });
  const first = await (async () => {
    await s2.app.start(CONFIG);
    return s2.app.testConnection();
  })();
  assert.match(
    first.en,
    /^Read now: SBWF3102 84df0c1199993795, power 338 W, consumption index 17762\.055 kWh, injection 21214\.589 kWh\. Next read in 30 s\.$/,
  );
  assert.match(first.fr, /^Lu à l’instant : SBWF3102/);
  const again = await s2.app.testConnection();
  assert.match(again.en, /^Last read 1 s ago/);
  assert.match(status(s).message.en, /The address is not valid/);
});

test('the test button answers within its delay; a read running is never doubled', async () => {
  const dev = createDevice();
  const s = await setup({ dev });
  dev.net.hold = true;
  await s.app.start(CONFIG);
  const running = s.advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  const told = await s.app.testConnection();
  assert.match(told.en, /No read yet/);
  assert.equal(dev.net.calls.length, 1);
  dev.net.hold = false;
  dev.net.release();
  await running;
  await s.app.idle();
  assert.equal(dev.net.calls.length, 3);
});

test('the test button: a device that never answers gets "slow" within 45 s', async () => {
  const never = new Promise(() => {});
  const dev = deviceWith({ '/info': () => never });
  const s = await setup({ dev });
  await s.app.start(CONFIG);
  // The scheduled read is taken away: the button makes the read.
  s.app.timers.clearTimeout(s.app.timer);
  s.app.timer = undefined;
  const told = s.app.testConnection();
  await new Promise((resolve) => setImmediate(resolve));
  const late = s.advance(45 * SECOND);
  assert.match((await told).en, /slow to answer/);
  await late;
});

test('a clean stop writes /data and waits for the read running (bounded)', async () => {
  const store = createMemoryStore();
  const dev = createDevice();
  const s = await setup({ dev, store });
  dev.net.hold = true;
  await s.app.start(CONFIG);
  const running = s.advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = s.app.stop();
  await new Promise((resolve) => setImmediate(resolve));
  const waited = s.advance(5 * SECOND);
  await stopping;
  assert.ok(Number.isFinite(store.data.lastAttemptAt));
  dev.net.hold = false;
  dev.net.release();
  await running;
  await waited;
  await s.app.idle();
  assert.equal(s.gladys.fake.states.length, 0, 'nothing after the stop');
});

test('the index state is in /data before Gladys gets the index', async () => {
  const store = createMemoryStore();
  let seen;
  const s = await setup({ store, devices: [created()] });
  const publish = s.gladys.publishChangedStates.bind(s.gladys);
  s.gladys.publishChangedStates = async (states, options) => {
    seen ??= store.data.indexes?.[F('consumption_index')]?.last?.value;
    return publish(states, options);
  };
  await s.start();
  assert.equal(seen, 17_762.055);
});

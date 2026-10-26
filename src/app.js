// -----------------------------------------------------------------------------
// The integration itself: the Pure Energie (NET2GRID) meter reader read
// through its local HTTP API, one Gladys device, the consumption index checked
// by its guard and published once a minute, the freshness of the values, the
// pauses kept in /data, the test and accept buttons. index.js only wires the
// SDK handlers to it. Read-only: nothing is ever sent to the device but GET
// requests.
//
// One read = `/info` (the identity of the device), `/meter/now` (its values),
// then `/info` again: the values go to the device of the id read before AND
// after them, never to another one; an id that cannot be read is never
// "another device" (nothing is published, tried again later).
//
// Freshness: the device dates its values (Unix seconds). A read whose date
// and values have not moved since the last one publishes nothing (an old
// value is never sent as new, not even after a restart: the mark is kept in
// /data per device); not moved for FROZEN_AFTER, the status says so.
// Without a date, the fingerprint of the values alone stands for it.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container: the
// time of the last read is kept in /data). Structure taken from gladys-iskra
// (approved).
//
// A read belongs to its session (the client of one address): when it
// changes, a late answer of the old one publishes nothing and sets no status
// (checked after every await).
//
// Two clocks: `now` (wall clock) dates what /data keeps; `monotonic` paces
// the reads, the pauses and the freshness, so that a wall clock set back or
// forward never stops nor hurries them. The index guard gets the wall clock
// at start plus the monotonic time since (`guardNow`): a wall clock moved by
// NTP in the session never widens its margin.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig } from './config.js';
import {
  ACCEPT_CONFIRM_AFTER,
  ACCEPT_CONFIRM_WITHIN,
  FROZEN_AFTER,
  INDEX_INTERVAL,
  INDEX_SLACK_KWH,
  PAUSE_MAX,
  PAUSE_MIN,
  POLL_INTERVAL,
  RETRY_MAX,
  RETRY_MIN,
  STATE_HEARTBEAT,
  STOP_WAIT,
  TEST_ANSWER_WITHIN,
} from './constants.js';
import {
  FEATURE,
  buildDevice,
  capabilitiesOf,
  capabilitiesOfDevice,
  ids,
  indexStates,
  liveStates,
  round,
  union,
  validKeys,
} from './devices.js';
import { DeviceError, Net2GridClient } from './net2grid/client.js';
import { idOf } from './net2grid/model.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };

/** At most this many index states kept in /data (one per device seen). */
const MAX_KEPT_INDEXES = 16;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._/+-]{0,31}$/;
const labelOrUndefined = (value) =>
  typeof value === 'string' && LABEL.test(value) ? value : undefined;
const MARK = /^(?:t\d{13})?f[0-9a-f]{8}$/;
/** At most this many devices keep the mark of their last values in /data. */
const MAX_KEPT_MARKS = 8;

/** The fingerprint of the values of a reading: 8 hex digits. */
export const fingerprintOf = (reading) =>
  createHash('sha256')
    .update(
      JSON.stringify([reading.power ?? null, reading.imported ?? null, reading.exported ?? null]),
    )
    .digest('hex')
    .slice(0, 8);

/**
 * What tells a new reading: its time and a fingerprint of its values (the
 * fingerprint alone without a time). A device clock stuck on one date while
 * the values move still gives new readings; a frozen copy does not.
 */
export const markOf = (reading) =>
  `${reading.sourceAt !== undefined ? `t${String(reading.sourceAt).padStart(13, '0')}` : ''}f${fingerprintOf(reading)}`;

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    feature?.last_value !== '' &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/**
 * A pause read back from /data: `{ until, count, code, status }`. In memory
 * it ends at a monotonic `due` (its rest capped to PAUSE_MAX from now).
 */
function validPause(pause, now, mono) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** Plain objects under string keys only (no prototype key). */
function plainEntries(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return [];
  }
  return Object.entries(object).filter(
    ([key, value]) =>
      key !== '__proto__' && value && typeof value === 'object' && !Array.isArray(value),
  );
}

/** The device kept in /data: `{ id, model, manufacturer, firmware, keys }`, or undefined. */
function keptMeter(meter) {
  const id = idOf(meter?.id);
  if (!id || id !== meter.id) {
    return undefined;
  }
  return {
    id,
    model: labelOrUndefined(meter.model),
    manufacturer: labelOrUndefined(meter.manufacturer),
    firmware: labelOrUndefined(meter.firmware),
    keys: validKeys(meter.keys),
  };
}

/**
 * The marks of the last values kept in /data, by device id: `{ mark, at }`,
 * `at` the wall time the mark last changed, brought onto the monotonic
 * clock. A date in the future (a clock behind /data after a restart, a
 * Raspberry Pi without RTC) keeps the mark: only its age is lost, counted
 * from now. The mark comes from the device, not from our clock.
 */
function keptMarks(marks, now, mono) {
  const kept = new Map();
  for (const [id, value] of plainEntries(marks)) {
    if (idOf(id) !== id || typeof value.mark !== 'string' || !MARK.test(value.mark)) {
      continue;
    }
    const at = finite(value.at) && value.at <= now ? value.at : now;
    kept.set(id, { mark: value.mark, at, mono: mono - (now - at) });
  }
  return new Map([...kept].slice(-MAX_KEPT_MARKS));
}

export class PureEnergieApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'pure-energie' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new Net2GridClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    /** /data: the guards, the device, the date of its values, the pause, the last read. */
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** `{ client, discovered }` of the current address; replaced when it changes. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;
    /** The first click of "Accept the held index": `{ at, listedAt, list }`, in memory only. */
    this.pendingAccept = undefined;

    const kept = store.load();
    /** /data exists but cannot be read: never written over (what it holds may matter). */
    this.storeUnreadable = kept.unreadable === true;
    const at = now();
    const mono = monotonic();
    this.pause = validPause(kept.pause, at, mono);
    /** The device seen, kept so that it is offered at a restart. */
    this.meter = keptMeter(kept.meter);
    /** By device id: the mark of its last values (src/app.js markOf), its wall and monotonic age. */
    this.marks = keptMarks(kept.marks, at, mono);
    /** The wall clock at start and the monotonic clock then: the time of the index guard. */
    this.wallBase = at;
    this.monoBase = mono;
    // The last read before a restart: the next one never comes sooner than
    // the interval. A date in the future is not valid (no read known).
    this.lastAttemptAt =
      finite(kept.lastAttemptAt) && kept.lastAttemptAt <= at ? kept.lastAttemptAt : undefined;
    /** Monotonic time of the last read started. */
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : mono - (at - this.lastAttemptAt);
    /** By index feature external id. */
    this.guards = new Map();
    this.guardKw = undefined;
    this.resetReads();
  }

  /** What belongs to one address: forgotten when it changes. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'error', ... }`. */
    this.outcome = undefined;
    /** Wrong answers and unreachable device: retries doubled, in memory. */
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    /** Monotonic time the indexes were last published. */
    this.lastIndexAt = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  /**
   * Every connection to Gladys: started from the configuration the SDK has
   * just read (`gladys.config`, refreshed before `connected`), never from a
   * second request that could fail alone.
   */
  onConnected() {
    const config = this.gladys.config;
    return this.start(config && typeof config === 'object' ? config : {});
  }

  /**
   * Stops the reads, waits (bounded) for the one running, and writes /data:
   * the time of the last read and what was seen since the last save are
   * never lost by a clean stop.
   */
  stop() {
    return this.serialize(async () => {
      this.doStop();
      // Written first: Docker stops the container 10 s after asking.
      await this.saveState();
      if (this.busy) {
        let timer;
        await Promise.race([
          this.busy.catch(() => {}),
          new Promise((resolve) => {
            timer = this.timers.setTimeout(resolve, STOP_WAIT);
          }),
        ]);
        this.timers.clearTimeout(timer);
      }
      await this.saveState();
    });
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first ||
      config.address !== this.config.address ||
      config.invalidAddress !== this.config.invalidAddress;
    this.config = config;
    if (this.guardKw !== config.maxKw) {
      // Another margin: the guards are built again from /data (saved first).
      await this.saveState();
      this.guards.clear();
      this.guardKw = config.maxKw;
    }
    if (changed) {
      this.session = {
        client: isComplete(config) ? this.clientFactory({ address: config.address }) : undefined,
        discovered: false,
      };
      // A list of the first click belongs to its session.
      this.pendingAccept = undefined;
      if (!first) {
        this.resetReads();
        if (this.pause) {
          // Another address: a pause asked by the old one ends; the pace does not.
          this.pause = undefined;
          await this.saveState();
        }
      }
    }
    this.running = true;
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read that brings new ones).
    this.lastStatus = undefined;
    this.lastIndexAt = undefined;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.updateStatus();
      return;
    }
    await this.discover();
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // --- Pace ------------------------------------------------------------------

  /** The rest of the pause (ms, monotonic), capped to PAUSE_MAX at every use; 0 when none. */
  pauseLeft(mono) {
    if (!this.pause) {
      return 0;
    }
    return Math.min(Math.max(0, this.pause.due - mono), PAUSE_MAX);
  }

  /** The monotonic time from which the next read may start, from the caller's instant `mono` (the clock is read once per decision). */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + POLL_INTERVAL;
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, this.nextTryAt);
    }
    return Math.max(due, mono + this.pauseLeft(mono));
  }

  /** One timer: the next read when it is due. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client) {
      return;
    }
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`pure-energie: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick() {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read() {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      return;
    }
    /** Another address (or a stop) during an await: this read gives up, silently. */
    const gone = () => session !== this.session || !this.running;
    this.lastReadAt = mono;
    // Kept BEFORE the request, at every read: a restart during it never
    // reads again sooner.
    this.lastAttemptAt = this.now();
    await this.saveState();
    if (gone()) return;
    let result;
    try {
      result = await this.readAll(client, gone);
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono, gone);
      return;
    }
    if (gone() || !result) return;
    await this.succeeded(result, mono, gone);
  }

  /**
   * The identity, the values, the identity again: the values belong to the
   * id read on both sides of them. Throws a DeviceError otherwise.
   */
  async readAll(client, gone) {
    const before = await client.info();
    if (gone()) return undefined;
    if (!before.id) {
      throw new DeviceError('no_identity');
    }
    const reading = await client.meter();
    if (gone()) return undefined;
    const after = await client.info();
    if (gone()) return undefined;
    if (!after.id) {
      throw new DeviceError('no_identity');
    }
    if (after.id !== before.id) {
      throw new DeviceError('identity_changed');
    }
    return { info: before, reading };
  }

  // --- Outcomes ----------------------------------------------------------------

  async succeeded({ info, reading }, mono, gone) {
    // An answer: a pause asked before and the retries are over.
    this.pause = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    let grew = !this.session.discovered;
    if (this.meter && this.meter.id !== info.id) {
      // Another device at this address: it gets its own device; the old one
      // keeps its history and gets nothing more from here.
      this.logger.warn('pure-energie: another NET2GRID device answers at this address');
      this.meter = undefined;
    }
    if (!this.meter) {
      this.meter = { id: info.id, keys: new Set() };
      grew = true;
    }
    const meter = this.meter;
    meter.model = info.model ?? meter.model;
    meter.manufacturer = info.manufacturer ?? meter.manufacturer;
    meter.firmware = info.firmware ?? meter.firmware;
    const keys = union(
      meter.keys,
      capabilitiesOfDevice(this.createdDevice()),
      capabilitiesOf(reading),
    );
    if (keys.size !== meter.keys.size) {
      grew = true;
    }
    meter.keys = keys;
    this.followFreshness(meter, reading, mono);
    this.outcome = { at: mono, kind: 'reading', info, reading };
    if (grew) {
      this.session.discovered = true;
      await this.discover();
      if (gone()) return;
    }
    if (reading.isNew) {
      await this.publish(reading, mono, gone);
      if (gone()) return;
    }
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  /**
   * The mark of the values (time and fingerprint), kept in /data per device
   * with the wall time it last changed: a reading is new only when it moved;
   * unchanged for FROZEN_AFTER, the values are frozen. After a restart, the
   * same mark keeps its age (counted from the restart when /data is dated
   * in the future); a device that comes back keeps its own mark.
   */
  followFreshness(meter, reading, mono) {
    const mark = markOf(reading);
    const known = this.marks.get(meter.id);
    if (!known || known.mark !== mark) {
      this.marks.delete(meter.id);
      this.marks.set(meter.id, { mark, at: this.now(), mono });
      while (this.marks.size > MAX_KEPT_MARKS) {
        this.marks.delete(this.marks.keys().next().value);
      }
      reading.isNew = true;
      reading.frozen = false;
      return;
    }
    reading.isNew = false;
    reading.frozen = mono - known.mono >= FROZEN_AFTER;
  }

  /** The time given to the index guard: the wall clock at start plus the monotonic time since. */
  guardNow(mono = this.monotonic()) {
    return this.wallBase + (mono - this.monoBase);
  }

  /** The created devices of this integration (the SDK keeps gladys.devices up to date). */
  ourDevices() {
    const prefix = ids(this.gladys, 'X').device.slice(0, -1);
    return (this.gladys.devices ?? []).filter((d) => String(d.external_id).startsWith(prefix));
  }

  async failed(err, mono, gone) {
    const code = err?.code ?? 'error';
    const now = this.now();
    // The pause and the next try count from the failure, not from the start
    // of the read (a slow device would shorten them).
    const at = this.monotonic();
    // Our own words only (DeviceError codes): never a text of the device.
    this.logger.warn(
      `pure-energie read failed: ${code}${Number.isInteger(err?.status) ? ` ${err.status}` : ''}`,
    );
    this.outcome = { at: mono, kind: 'error', err };
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = {
        until: now + wait,
        due: at + wait,
        count: Math.min(count, 32),
        code,
        status: Number.isInteger(err.status) ? err.status : null,
      };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    // Retries doubled (never faster than the interval).
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.lastError = err;
    this.nextTryAt = at + wait;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = this.config.address;
    if (!this.session?.client) {
      return [false, this.config.invalidAddress ? T.badAddress : T.incomplete];
    }
    const mono = this.monotonic();
    const notes = this.heldNotes();
    const left = this.pauseLeft(mono);
    if (left > 0) {
      return [false, T.paused(address, this.pause, left, notes)];
    }
    if (this.lastError && this.failures > 0) {
      const wait = Math.max(0, (this.nextTryAt ?? 0) - mono);
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.outcome?.kind === 'reading') {
      const { info, reading } = this.outcome;
      const extra = [];
      if (!this.createdDevice()) {
        // Another device of ours exists: the meter reader at this address changed.
        extra.push(this.ourDevices().length > 0 ? T.notes.otherDevice(info.id) : T.notes.noDevice);
      }
      if (this.storeUnreadable) extra.push(T.notes.storeUnreadable);
      if (reading.frozen) extra.push(T.notes.frozen(FROZEN_AFTER));
      if (reading.unitUnknown) extra.push(T.notes.unitUnknown);
      else if (reading.imported === undefined) extra.push(T.notes.noImport);
      return [true, T.ok(address, info, [...extra, ...notes])];
    }
    return [false, T.waiting(address, notes)];
  }

  /** The index held back, `[{ id, direction, from, to, threshold }]` (0 or 1 entry). */
  heldList() {
    const held = this.currentGuard()?.held;
    if (!held) {
      return [];
    }
    return [
      {
        id: ids(this.gladys, this.meter.id).feature(FEATURE.CONSUMPTION_INDEX),
        direction: held.direction,
        from: held.from,
        to: held.to,
        threshold: held.threshold,
      },
    ];
  }

  /** The index held back, for every status (the user must see it while waiting). */
  heldNotes() {
    const [held] = this.heldList();
    return held ? [T.notes.held(held)] : [];
  }

  // --- /data -------------------------------------------------------------------------

  /** Keeps the device, the date of its values, the pause, the last read and the guards. */
  async saveState() {
    // A file that cannot be read (at start or since) is never written over:
    // written again only once it reads back (fixed or removed by the user).
    const loaded = this.store.load();
    if (loaded.unreadable === true) {
      if (!this.storeUnreadable) {
        this.storeUnreadable = true;
        this.logger.warn('pure-energie: the state file in /data cannot be read, left as it is');
      }
      return;
    }
    if (this.storeUnreadable) {
      this.storeUnreadable = false;
      this.savedKey = undefined;
    }
    const indexes = {};
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    // Never overwrite an index state not loaded yet: merged with /data.
    const kept = Object.fromEntries(plainEntries(loaded.indexes));
    for (const id of Object.keys(indexes)) delete kept[id];
    const merged = Object.entries({ ...kept, ...indexes }).slice(-MAX_KEPT_INDEXES);
    const m = this.meter;
    const p = this.pause;
    const state = {
      meter: m
        ? {
            id: m.id,
            model: m.model ?? null,
            manufacturer: m.manufacturer ?? null,
            firmware: m.firmware ?? null,
            keys: [...m.keys],
          }
        : null,
      marks: Object.fromEntries([...this.marks].map(([id, m]) => [id, { mark: m.mark, at: m.at }])),
      pause: p ? { until: p.until, count: p.count, code: p.code, status: p.status } : null,
      lastAttemptAt: this.lastAttemptAt ?? null,
      indexes: Object.fromEntries(merged),
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
    } catch (err) {
      this.logger.warn(`Saving the pure-energie state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /** The created Gladys device of the meter, undefined until the user creates it. */
  createdDevice(id = this.meter?.id) {
    if (!id) {
      return undefined;
    }
    const externalId = ids(this.gladys, id).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  /** The NET2GRID id of an external id of ours (its form only), or undefined. */
  idOfExternal(externalId) {
    const prefix = ids(this.gladys, 'X').device.slice(0, -1);
    if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
      return undefined;
    }
    const id = externalId.slice(prefix.length);
    return idOf(id) === id ? id : undefined;
  }

  async discover() {
    if (!this.session?.client || !this.meter) {
      return;
    }
    const keys = union(this.meter.keys, capabilitiesOfDevice(this.createdDevice()));
    if (keys.size === 0) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([buildDevice(this.gladys, this.meter, keys, this.config.address)])
      .catch((err) => this.logger.warn(`Publishing the pure-energie device failed (${err?.name})`));
  }

  /** The Discover tab asks: the known device, never a read (the next one comes at its time). */
  async scan() {
    await this.discover();
  }

  async onDeviceCreated(device) {
    // Recognized by the form of its external id alone: a new device has no
    // reference of its index yet (nor a state kept for a deleted device).
    const id = this.idOfExternal(device?.external_id);
    if (!id) {
      return;
    }
    const indexId = ids(this.gladys, id).feature(FEATURE.CONSUMPTION_INDEX);
    this.guards.delete(indexId);
    this.pendingAccept = undefined;
    const kept = this.store.load();
    const indexes = Object.fromEntries(plainEntries(kept.indexes));
    delete indexes[indexId];
    await (
      kept.unreadable === true ? Promise.resolve() : this.store.save({ ...kept, indexes })
    ).catch((err) =>
      this.logger.warn(`Clearing the pure-energie index state failed (${err?.code ?? 'error'})`),
    );
    this.savedKey = undefined;
    await this.saveState();
    // Its values at the next read bringing new ones (never an old one now).
    this.lastIndexAt = undefined;
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    if (this.idOfExternal(device?.external_id)) {
      // New features (Update in Discovery): their indexes at the next read.
      this.lastIndexAt = undefined;
      await this.updateStatus();
    }
  }

  // --- Values ------------------------------------------------------------------------

  /** The guard of the index of a created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = Object.fromEntries(plainEntries(this.store.load().indexes))[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved, this.guardNow(), {
          maxKw: this.config.maxKw,
          slackKwh: INDEX_SLACK_KWH,
        }),
      );
    }
    return this.guards.get(id);
  }

  /** The guard of the meter when its device is created. */
  currentGuard() {
    const created = this.createdDevice();
    return created
      ? this.guardOf(created, ids(this.gladys, this.meter.id).feature(FEATURE.CONSUMPTION_INDEX))
      : undefined;
  }

  /** The states of a new reading: the power every time, the indexes once a minute. */
  async publish(reading, mono, gone) {
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    if (this.lastIndexAt !== undefined && mono < this.lastIndexAt) {
      this.lastIndexAt = undefined;
    }
    const indexDue = this.lastIndexAt === undefined || mono - this.lastIndexAt >= INDEX_INTERVAL;
    const external = ids(this.gladys, this.meter.id);
    const states = liveStates(external, reading);
    if (indexDue) {
      this.lastIndexAt = mono;
      const id = external.feature(FEATURE.CONSUMPTION_INDEX);
      const guard = this.guardOf(created, id);
      const total = finite(reading.imported) ? round(reading.imported, 3) : undefined;
      const plausible = total !== undefined && guard.accept(total, this.guardNow(mono));
      if (total !== undefined && !plausible && guard.held) {
        this.logger.warn(
          `pure-energie consumption index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta for the core).
      const index = plausible ? total : guard.held ? guard.last?.value : undefined;
      reading.published = index;
      states.push(...indexStates(external, index, reading.exported));
      // The guard is in /data BEFORE Gladys gets the values: a crash in
      // between never sends an index /data does not know.
      await this.saveState();
      if (gone()) return;
    }
    // Only the features the created device has (they are fixed at its creation).
    const features = created.features ? new Set(created.features.map((f) => f.external_id)) : null;
    const allowed = features
      ? states.filter((s) => features.has(s.device_feature_external_id))
      : states;
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the pure-energie values failed (${err?.name})`));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks (as gladys-iskra, approved): the
   * first shows the index held and accepts nothing; the second, 3 s to 5 min
   * later in the same session, accepts exactly what the first showed, only
   * when the held value still shows the same jump or drop (the same
   * direction and starting value, the value shown or what the meter may have
   * measured since, src/guard.js). A save of the form never accepts.
   */
  async acceptHeldIndex() {
    const list = this.heldList();
    const mono = this.monotonic();
    // Session time (never the wall clock moved by NTP meanwhile): the margin
    // between the clicks is the time that really passed.
    const now = this.guardNow(mono);
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    const elapsed = pending ? mono - pending.at : undefined;
    if (
      !pending ||
      pending.session !== this.session ||
      elapsed > ACCEPT_CONFIRM_WITHIN ||
      elapsed < ACCEPT_CONFIRM_AFTER
    ) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list, session: this.session };
      // The most the meter may add between the clicks: maxKw over the window, plus the slack.
      const margin = (this.config.maxKw * ACCEPT_CONFIRM_WITHIN) / 3_600_000 + INDEX_SLACK_KWH;
      return T.accept.confirm(list[0], ACCEPT_CONFIRM_WITHIN, margin);
    }
    const [entry] = pending.list;
    const guard = this.guards.get(entry.id);
    const held = guard?.held;
    const margin = guard ? guard.margin(pending.listedAt, now) : 0;
    const same =
      held &&
      held.direction === entry.direction &&
      held.from === entry.from &&
      (entry.direction === 'up'
        ? held.threshold === entry.threshold && held.to >= entry.to && held.to - entry.to <= margin
        : Math.abs(held.to - entry.to) <= margin);
    if (same && guard.acceptHeld()) {
      this.logger.info(
        `pure-energie consumption index ${entry.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
      );
      // Published at the next new reading (never a read sooner than the interval).
      this.lastIndexAt = undefined;
      return T.accept.done(held.to);
    }
    return held ? T.accept.changed : T.accept.nothing;
  }

  /**
   * The test button: never a read sooner than the pace allows. When a read
   * is due, this click makes it; otherwise it tells the last one.
   */
  async testConnection() {
    if (!this.session?.client) {
      return this.currentStatus()[1];
    }
    const mono = this.monotonic();
    if (this.pauseLeft(mono) > 0) {
      return this.currentStatus()[1];
    }
    if (this.busy || this.dueAt(mono) > mono) {
      return this.describeOutcome(undefined, mono);
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.tick().then(() => this.describeOutcome(mono)), late]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  /**
   * The last read in words, and the time to the next one. `since`: when this
   * click started a read; a read from then on is told as "read now". The
   * index shown is the one sent to Gladys, or the value held back, said so.
   */
  describeOutcome(since, mono = this.monotonic()) {
    const next = Math.max(0, this.dueAt(mono) - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return T.test.notYet(next, POLL_INTERVAL);
    }
    const ago =
      since !== undefined && outcome.at >= since ? undefined : Math.max(0, mono - outcome.at);
    if (outcome.kind === 'reading') {
      const { info, reading } = outcome;
      const held = this.currentGuard()?.held;
      return T.test.reading(
        info,
        {
          power: reading.frozen ? undefined : reading.power,
          index: held ? held.to : (reading.published ?? reading.imported),
          held: Boolean(held),
          injection: reading.exported,
          frozen: Boolean(reading.frozen),
        },
        ago,
        next,
      );
    }
    return T.test.failed(this.config.address, outcome.err, ago, next);
  }
}

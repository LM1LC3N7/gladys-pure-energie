// -----------------------------------------------------------------------------
// The answers of the local HTTP API of a NET2GRID device (the Pure Energie
// meter reader, SBWF3102 and its kin) -> values. Pure. Ported from the
// gridnet library (Klaas Schoute, MIT, see THIRD_PARTY_NOTICES.md),
// src/gridnet/models.py:
// - `GET /info`: `{ id: "84df:0c11:9999:3795", mf: "NET2GRID", model:
//   "SBWF3102", fw: "1.6.16", hw: 1, batch: "SBP-HMX-210318" }`;
// - `GET /meter/now`: `{ status: "ok", elec: { power: { now: { value, unit:
//   "W", time } }, import: { now: { value, unit: "Wh", time } }, export:
//   { now: { value, unit: "Wh", time } } }, gas: {} }`, the power signed
//   (below 0 while injecting), the indexes in Wh, `time` in Unix seconds.
// Changed here: every value is read against a strict pattern and bounds; an
// energy without a known unit is never used (never guessed: an index is
// billed); a counter at 0 is "not available"; only own keys are read;
// nothing is read as 0 by default. The minimum and maximum power and the gas
// part are not read.
// -----------------------------------------------------------------------------

import { INDEX_MAX, POWER_MAX } from '../constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/** A short text from the device, trimmed, or undefined. */
const text = (raw, max = 32) =>
  typeof raw === 'string' && raw.length <= max * 4 && raw.trim().length <= max
    ? raw.trim()
    : undefined;

/** A model, firmware or maker we show: printable, no free text. */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._/+-]{0,31}$/;
const labelOf = (raw) => {
  const value = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : text(raw);
  return value !== undefined && LABEL.test(value) ? value : undefined;
};

/** The NET2GRID id: groups of hex digits, separated by ":" or "-" (or none). */
const ID = /^[0-9a-f]{2,8}(?:[:-]?[0-9a-f]{2,8}){0,7}$/i;

/**
 * The identity of the device: its id, hex digits only, lower case (8 to 32
 * of them, not only zeros), or undefined when it cannot be read.
 */
export function idOf(raw) {
  // A control byte (CR, LF...) is never trimmed away: such an id is unreadable.
  // eslint-disable-next-line no-control-regex
  if (typeof raw === 'string' && /[\u0000-\u001f\u007f]/.test(raw)) {
    return undefined;
  }
  const value = text(raw, 64);
  if (value === undefined || !ID.test(value)) {
    return undefined;
  }
  const hex = value.replace(/[:-]/g, '').toLowerCase();
  return hex.length >= 8 && hex.length <= 32 && !/^0+$/.test(hex) ? hex : undefined;
}

/**
 * The device (`GET /info`): `{ id, model, manufacturer, firmware, hardware }`,
 * `id` undefined when it cannot be read (never "another device"). Undefined
 * when the answer is not an object at all.
 */
export function parseInfo(payload) {
  if (!isObject(payload)) {
    return undefined;
  }
  return {
    id: idOf(own(payload, 'id')),
    model: labelOf(own(payload, 'model')),
    manufacturer: labelOf(own(payload, 'mf')),
    firmware: labelOf(own(payload, 'fw')),
    hardware: labelOf(own(payload, 'hw')),
  };
}

const NUMBER = /^-?\d{1,12}(?:\.\d{1,9})?$/;

/** A number given as a number or a strict numeric string, else undefined ("" is never 0). */
export function numberOf(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string' && raw.length <= 32 && NUMBER.test(raw.trim())) {
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/** The units read, to W and kWh. */
const POWER = { W: 1, kW: 1e3 };
const ENERGY_TO_KWH = { Wh: 1e-3, kWh: 1 };

/** Unix seconds of a reading, as ms, between 2001 and 2286; else undefined. */
function timeOf(raw) {
  const value = numberOf(raw);
  return value !== undefined && Number.isInteger(value) && value >= 1e9 && value < 1e10
    ? value * 1000
    : undefined;
}

/** `{ value, unit, time }` of `elec.<name>.now`, the unit as given ('' when none). */
function nowOf(elec, name) {
  const now = own(own(elec, name), 'now');
  if (!isObject(now)) {
    return undefined;
  }
  const unit = own(now, 'unit');
  return {
    value: numberOf(own(now, 'value')),
    unit:
      typeof unit === 'string' && unit.length <= 8 ? unit.trim() : unit === undefined ? '' : null,
    time: timeOf(own(now, 'time')),
  };
}

/** The power in W (signed): W when no unit is given (as gridnet), bounded. */
function powerOf(now) {
  if (!now || now.value === undefined || now.unit === null) {
    return undefined;
  }
  const unit = now.unit === '' ? 'W' : now.unit;
  const factor = Object.hasOwn(POWER, unit) ? POWER[unit] : undefined;
  const value = factor === undefined ? undefined : now.value * factor;
  return value !== undefined && value >= -POWER_MAX && value <= POWER_MAX ? value : undefined;
}

/** A counter in kWh: its unit must be given and known; 0 or below is "not available". */
function counterOf(now) {
  const factor =
    now && typeof now.unit === 'string' && Object.hasOwn(ENERGY_TO_KWH, now.unit)
      ? ENERGY_TO_KWH[now.unit]
      : undefined;
  if (factor === undefined || now.value === undefined) {
    return undefined;
  }
  const value = now.value * factor;
  return Number.isFinite(value) && value > 0 && value <= INDEX_MAX ? value : undefined;
}

/**
 * The meter (`GET /meter/now`): `{ power, imported, exported, sourceAt,
 * unitUnknown }` (W, kWh, kWh, ms), each value undefined when absent or not
 * valid; `{ status }` when the device says its status is not "ok"; undefined
 * when it is not an answer of a NET2GRID device (no `elec` object).
 */
export function parseMeter(payload) {
  const elec = own(payload, 'elec');
  if (!isObject(elec)) {
    return undefined;
  }
  const status = own(payload, 'status');
  if (status !== undefined && status !== 'ok') {
    return { status: 'not_ok' };
  }
  const power = nowOf(elec, 'power');
  const imported = nowOf(elec, 'import');
  const exported = nowOf(elec, 'export');
  const times = [power?.time, imported?.time, exported?.time].filter((t) => t !== undefined);
  const counter = (now) =>
    now !== undefined &&
    now.value !== undefined &&
    !(typeof now.unit === 'string' && Object.hasOwn(ENERGY_TO_KWH, now.unit));
  return {
    power: powerOf(power),
    imported: counterOf(imported),
    exported: counterOf(exported),
    sourceAt: times.length > 0 ? Math.max(...times) : undefined,
    /** A counter given with a unit we do not read (or none): never guessed. */
    unitUnknown: counter(imported) || counter(exported),
  };
}

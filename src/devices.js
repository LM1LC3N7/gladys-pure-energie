// -----------------------------------------------------------------------------
// The Gladys device of the Pure Energie (NET2GRID) meter reader and its
// states. Pure.
//
// External id (forever): meter:<id>, the hex digits of the NET2GRID id of the
// device (src/net2grid/model.js idOf). Feature keys (forever): see FEATURE.
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service), as in gladys-p1-monitor and gladys-iskra:
// - `consumption_index` (the import counter of the electricity meter) is the
//   ONLY energy-sensor / index feature: the core derives the consumption and
//   its cost from its deltas, by itself. It passes the guard of
//   src/guard.js: never 0, a drop or a jump held until the user accepts it;
// - the injection (the export counter) is NEVER in an energy-sensor index
//   nor `energy` (it would be billed as consumption): a plain sensor, kWh in
//   the name;
// - `power` (the power of the meter, signed: below 0 while injecting) is the
//   only energy-sensor / power feature;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W and kWh for energy-sensor, none
//   for unknown (the unit is then in the name).
//
// The features follow what the device showed: the set only grows, and always
// holds the features of the created device, so a device published again
// never loses one (an "Update" in Discovery would drop its history).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, INDEX_MAX, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  CONSUMPTION_INDEX: 'consumption_index',
  INJECTION_INDEX: 'injection_index',
};

/** Every feature key, in the order of the device. */
export const ORDER = [FEATURE.POWER, FEATURE.CONSUMPTION_INDEX, FEATURE.INJECTION_INDEX];
const KNOWN = new Set(ORDER);

/** The external ids of the device with this NET2GRID id. */
export const ids = (gladys, id) => gladys.externalIds(EXTERNAL_ID_TYPE, id);

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: INDEX_MAX,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** The definition of each feature key. */
const DEFINITIONS = {
  [FEATURE.POWER]: (e) =>
    feature(e, FEATURE.POWER, 'Power', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, {
      unit: U.WATT,
      min: -POWER_MAX,
      max: POWER_MAX,
    }),
  [FEATURE.CONSUMPTION_INDEX]: (e) =>
    feature(
      e,
      FEATURE.CONSUMPTION_INDEX,
      'Consumption index',
      C.ENERGY_SENSOR,
      T.ENERGY_SENSOR.INDEX,
      { unit: U.KILOWATT_HOUR },
    ),
  // A value shown, never summed nor billed: no energy category, no unit (it is in the name).
  [FEATURE.INJECTION_INDEX]: (e) =>
    feature(e, FEATURE.INJECTION_INDEX, 'Injection index (kWh)', C.UNKNOWN, T.SENSOR.DECIMAL),
};

/**
 * The device. `meter`: `{ id, model, manufacturer, firmware }`; `keys`: the
 * feature keys to give it (a Set). The features are fixed when the user
 * creates it.
 */
export function buildDevice(gladys, meter, keys, address) {
  const external = ids(gladys, meter.id);
  const params = [
    { name: 'address', value: address },
    { name: 'net2grid_id', value: meter.id },
  ];
  if (meter.model) params.push({ name: 'model', value: meter.model });
  if (meter.firmware) params.push({ name: 'firmware', value: meter.firmware });
  return {
    name: `Pure Energie ${meter.model ?? 'NET2GRID'} ${meter.id.slice(-4)}`,
    external_id: external.device,
    features: ORDER.filter((key) => keys.has(key)).map((key) => DEFINITIONS[key](external)),
    params,
  };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The feature keys a reading shows (a value present). `reading`: src/net2grid/model.js parseMeter. */
export function capabilitiesOf(reading) {
  const keys = new Set();
  if (isNumber(reading?.power)) keys.add(FEATURE.POWER);
  if (isNumber(reading?.imported)) keys.add(FEATURE.CONSUMPTION_INDEX);
  if (isNumber(reading?.exported)) keys.add(FEATURE.INJECTION_INDEX);
  return keys;
}

/** The feature keys a CREATED device carries: never fewer when it is published again. */
export function capabilitiesOfDevice(device) {
  return new Set(
    (device?.features ?? [])
      .map((f) => String(f.external_id).split(':').at(-1))
      .filter((key) => KNOWN.has(key)),
  );
}

/** Keys read back from /data: known keys only. */
export const validKeys = (keys) =>
  new Set(Array.isArray(keys) ? keys.filter((key) => KNOWN.has(key)) : []);

export const union = (...sets) => new Set(sets.flatMap((s) => [...(s ?? [])]));

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

/** A counter: never 0 (nor below), whatever the device said. */
const counterState = (external, key, value) =>
  isNumber(value) && value > 0 ? state(external, key, value, 3) : [];

/** The power, every new reading. */
export const liveStates = (external, reading) => state(external, FEATURE.POWER, reading.power, 0);

/**
 * The indexes, once a minute at most. `consumptionIndex` is the value the
 * IndexGuard let through (undefined: not published this time). The
 * injection is a plain sensor, never published at 0.
 */
export function indexStates(external, consumptionIndex, injection) {
  return [
    ...counterState(external, FEATURE.CONSUMPTION_INDEX, consumptionIndex),
    ...counterState(external, FEATURE.INJECTION_INDEX, injection),
  ];
}

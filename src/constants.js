// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the meter: `meter:<id>`, the NET2GRID id the device
 * gives on its `/info` page (`84df:0c11:9999:3795`), its hex digits only
 * (`84df0c1199993795`): a new IP address keeps the device and its history.
 */
export const EXTERNAL_ID_TYPE = 'meter';

// --- The local HTTP API of the NET2GRID device (as the gridnet library reads it) -----
export const PATHS = {
  /** The device itself: `{ id, mf, model, fw, hw, batch }`. */
  INFO: '/info',
  /** The meter: `{ status, elec: { power, import, export }, gas }`. */
  METER: '/meter/now',
};

/** The library waits 10 s for an answer; so do we, the body included. */
export const HTTP_TIMEOUT = 10_000;
/** An answer of the device is a few hundred bytes: more is not a NET2GRID answer. */
export const MAX_BODY_BYTES = 64 * 1024;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** One read every 30 s (as Home Assistant), never faster, whatever asks for it. */
export const POLL_INTERVAL = 30 * SECOND;
/** The indexes are published (and their guard kept in /data) once a minute at most. */
export const INDEX_INTERVAL = MINUTE;
/** An unreachable device or a wrong answer: tries after 30 s, doubled up to 10 minutes. */
export const RETRY_MIN = 30 * SECOND;
export const RETRY_MAX = 10 * MINUTE;
/** HTTP 429 or 5xx of the device: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay (the manifest gives it 60 s). */
export const TEST_ANSWER_WITHIN = 45 * SECOND;
/** A stop saves /data, then waits for the read running at most this long and saves again. */
export const STOP_WAIT = 5 * SECOND;

// --- Freshness -----------------------------------------------------------------------
/**
 * The time of reading the device gives with its values: unchanged since the
 * last read, nothing is published (never an old value sent as new); unchanged
 * for this long, the status says the values are frozen.
 */
export const FROZEN_AFTER = 2 * HOUR;

// --- Plausibility of the consumption index (the one Gladys bills) -------------------
/**
 * The margin of the guard of src/guard.js: a home never draws more than this
 * on average between two published indexes. A configuration field
 * (`max_power_kw`) sets it, within these bounds.
 */
export const INDEX_MAX_KW_DEFAULT = 100;
export const INDEX_MAX_KW_MIN = 1;
export const INDEX_MAX_KW_MAX = 2000;
/** kWh always accepted on top of maxKw x hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/** An index above this (kWh) is a glitch: not published. */
export const INDEX_MAX = 1_000_000_000;
/** A power above this (W), either way, is a glitch: not published. */
export const POWER_MAX = 10_000_000;
/** "Accept the held index": the second click comes 3 s to 5 min after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;

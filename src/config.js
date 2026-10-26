// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized: the
// address of the NET2GRID device and the margin of the index guard. The
// address parser comes from gladys-iskra / gladys-p1-monitor (approved).
// -----------------------------------------------------------------------------

import { INDEX_MAX_KW_DEFAULT, INDEX_MAX_KW_MAX, INDEX_MAX_KW_MIN } from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const INVALID = { error: 'invalid' };

/**
 * Whether a host may be one device: never "any" (0.0.0.0, ::), a broadcast
 * (255.255.255.255) nor a multicast address (224.0.0.0/4, ff00::/8); an IPv4
 * address with a number above 255 is not one either. Host names pass.
 */
export function unicast(host) {
  const h = host.toLowerCase();
  if (h.includes(':')) {
    return !/^[0:]+$/.test(h) && !h.startsWith('ff');
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) {
    return !/^[\d.]+$/.test(h);
  }
  const octets = h.split('.').map(Number);
  return octets.every((o) => o <= 255) && octets[0] !== 0 && octets[0] < 224;
}

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port. A pasted URL ("http://192.168.1.30/meter/now") is reduced
 * to its host and port.
 * @returns {{ address: string } | { error: 'invalid' }} `address` is '' when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { address: '' };
  }
  // A control byte (CR, LF...) never belongs in an address.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    return INVALID;
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent around.
  if (text.includes('@')) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return unicast(bracketed[1])
      ? withPort(`[${bracketed[1].toLowerCase()}]`, bracketed[2])
      : INVALID;
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return unicast(text) ? withPort(`[${text.toLowerCase()}]`, undefined) : INVALID;
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label)) || !unicast(host)) {
    return INVALID;
  }
  return withPort(host.toLowerCase(), match[2]);
}

/** Whether a canonical IPv6 address (URL form) may be one device, its mapped IPv4 checked too. */
function unicast6(h) {
  if (!unicast(h)) {
    return false;
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (!mapped) {
    return true;
  }
  const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return unicast([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
}

/**
 * The host as fetch will reach it (WHATWG URL): an IPv4 address only in its
 * plain dotted form (never 0xe0000001, 0x0, 010.0.0.1, which a URL turns
 * into another address), checked again once canonical. Undefined otherwise.
 */
function canonical(host) {
  let hostname;
  try {
    hostname = new URL(`http://${host}/`).hostname;
  } catch {
    return undefined;
  }
  if (hostname.startsWith('[')) {
    return unicast6(hostname.slice(1, -1)) ? hostname : undefined;
  }
  return hostname === host && unicast(hostname) ? hostname : undefined;
}

function withPort(raw, port) {
  const host = canonical(raw);
  if (host === undefined) {
    return INVALID;
  }
  if (port === undefined) {
    return { address: host };
  }
  const number = Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: number === 80 ? host : `${host}:${number}` };
}

/** The margin of the guard in kW: a number within the bounds, else the default. */
function maxKwOf(raw) {
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^\d{1,4}(?:\.\d{1,3})?$/.test(raw.trim())
        ? Number(raw.trim())
        : NaN;
  return Number.isFinite(value) && value >= INDEX_MAX_KW_MIN && value <= INDEX_MAX_KW_MAX
    ? value
    : INDEX_MAX_KW_DEFAULT;
}

export function normalizeConfig(raw = {}) {
  // An address longer than any host name is refused before any parsing.
  const value = typeof raw?.address === 'string' && raw.address.length <= 300 ? raw.address : '';
  const parsed = parseAddress(value);
  return {
    address: parsed.error ? '' : parsed.address,
    invalidAddress:
      Boolean(parsed.error) ||
      (typeof raw?.address === 'string' && value === '' && raw.address !== ''),
    maxKw: maxKwOf(raw?.max_power_kw),
  };
}

/** Whether the form is complete enough to read the device. */
export const isComplete = (config) => Boolean(config.address);

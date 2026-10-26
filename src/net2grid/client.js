// -----------------------------------------------------------------------------
// The only network access: GET requests to the local HTTP API of a NET2GRID
// device (the Pure Energie meter reader), plain HTTP on the home network, no
// key, no cloud (as the gridnet library, src/gridnet/gridnet.py, see
// THIRD_PARTY_NOTICES.md). Read-only: only GET, the device is never commanded.
//
// Bounded: one request at a time, 10 s for the whole answer (the body
// included), 64 KiB at most, read into one buffer allocated once, never a
// redirect followed. Node's own fetch: no User-Agent of ours, no imitation.
//
// Errors carry our own codes, never a text of the device nor a URL.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY_BYTES, PATHS } from '../constants.js';
import { parseInfo, parseMeter } from './model.js';

export class DeviceError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'redirect'|'not_found'|'server'|'rate_limited'|
   *   'too_large'|'not_json'|'unknown_answer'|'not_ok'|'no_identity'|'identity_changed'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'DeviceError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof DeviceError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new DeviceError(timeout ? 'timeout' : 'unreachable');
}

/**
 * The body, up to `limit` bytes, copied into a single buffer allocated once
 * (no list of chunks, no concatenation): a longer one is not a device answer.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (size + value.byteLength > limit) {
        throw new DeviceError('too_large');
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return new TextDecoder('utf-8').decode(buffer.subarray(0, size));
}

/** The body of an answer we do not read: let go. */
const drop = async (response) => {
  try {
    await response.body?.cancel?.();
  } catch {
    // Nothing to do: the answer is refused anyway.
  }
};

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string' || raw.length > 64) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

export class Net2GridClient {
  constructor({
    address,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  }) {
    this.address = address;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
    /** Requests one after the other, never two at once (a small device). */
    this.queue = Promise.resolve();
  }

  /** GET of a page: its JSON, bounded. */
  get(path) {
    const run = async () => {
      let text;
      try {
        const response = await this.fetch(`http://${this.address}${path}`, {
          method: 'GET',
          // As gridnet asks; the device answers JSON.
          headers: { Accept: 'application/json, text/plain, */*' },
          // A redirect is never followed: the requests stay on this address.
          redirect: 'manual',
          // The whole answer, the body included, within the timeout.
          signal: AbortSignal.timeout(this.timeout),
        });
        const status = response.status;
        if (status === 429 || status >= 500) {
          await drop(response);
          throw new DeviceError(status === 429 ? 'rate_limited' : 'server', {
            status,
            retryAfter: retryAfterOf(response, this.now),
          });
        }
        if (status === 404) {
          await drop(response);
          throw new DeviceError('not_found', { status });
        }
        if (status >= 300 && status < 400) {
          await drop(response);
          throw new DeviceError('redirect', { status });
        }
        if (status < 200 || status >= 300) {
          // 401 and 403 too: the API has no login, it is not ours.
          await drop(response);
          throw new DeviceError('http', { status });
        }
        text = await readBounded(response, MAX_BODY_BYTES);
      } catch (err) {
        throw networkError(err);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new DeviceError('not_json');
      }
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** Reads a page and parses it; `unknown_answer` when it is not what the page should be. */
  async read(path, parse) {
    const value = parse(await this.get(path));
    if (value === undefined) {
      throw new DeviceError('unknown_answer');
    }
    return value;
  }

  /** The device: `{ id, model, manufacturer, firmware, hardware }` (src/net2grid/model.js). */
  info() {
    return this.read(PATHS.INFO, parseInfo);
  }

  /** The meter: `{ power, imported, exported, sourceAt, unitUnknown }`; `not_ok` from its status. */
  async meter() {
    const value = await this.read(PATHS.METER, parseMeter);
    if (value.status) {
      throw new DeviceError('not_ok');
    }
    return value;
  }
}

// -----------------------------------------------------------------------------
// The only network access: GET requests to the device, bounded, our error
// codes, no header of ours but Accept.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Net2GridClient } from '../src/net2grid/client.js';
import { ID, info, json, meter } from './fixtures/net2grid.js';
import { createFetch, refusedError, streamOf, timeoutError } from './helpers/fakeNet.js';

const client = (handler) => {
  const net = createFetch(handler);
  return {
    net,
    client: new Net2GridClient({ address: '192.168.1.60:8080', fetchImpl: net.fetch }),
  };
};

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected an error');
};

test('GET of each page at the address, no redirect followed, a timeout, no User-Agent', async () => {
  const pages = { '/info': info(), '/meter/now': meter() };
  const { net, client: c } = client(({ path }) => json(pages[path]));
  assert.equal((await c.info()).id, ID);
  const reading = await c.meter();
  assert.equal(reading.power, 338);
  assert.equal(reading.imported, 17_762.055);
  assert.deepEqual(
    net.calls.map((call) => call.path),
    Object.keys(pages),
  );
  for (const call of net.calls) {
    assert.equal(call.host, '192.168.1.60:8080');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'manual');
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(call.init.headers), ['Accept']);
  }
});

test('our error codes, never a text of the device', async () => {
  const cases = [
    [() => json('nope', { status: 404 }), 'not_found'],
    [() => json('secret text', { status: 403 }), 'http'],
    [() => json('secret text', { status: 401 }), 'http'],
    [() => json('', { status: 302, headers: { location: 'http://elsewhere/' } }), 'redirect'],
    [() => json('', { status: 418 }), 'http'],
    [() => json('', { status: 500 }), 'server'],
    [() => json('', { status: 429, headers: { 'retry-after': '120' } }), 'rate_limited'],
    [() => new Response('<html>secret</html>'), 'not_json'],
    [() => json({ hello: 'world' }), 'unknown_answer'],
    [() => json({ status: 'error secret', elec: {} }), 'not_ok'],
    [
      () => {
        throw timeoutError();
      },
      'timeout',
    ],
    [
      () => {
        throw refusedError();
      },
      'unreachable',
    ],
  ];
  for (const [handler, code] of cases) {
    const err = await codeOf(client(handler).client.meter());
    assert.equal(err.code, code);
    assert.ok(!/secret|html|elsewhere|192\.168/.test(err.message), err.message);
  }
  const limited = await codeOf(
    client(() => json('', { status: 429, headers: { 'retry-after': '120' } })).client.info(),
  );
  assert.equal(limited.retryAfter, 120_000);
  const dated = await codeOf(
    client(() =>
      json('', {
        status: 503,
        headers: {
          'retry-after': 'Thu, 01 Jan 2015 00:05:00 GMT',
          date: 'Thu, 01 Jan 2015 00:00:00 GMT',
        },
      }),
    ).client.info(),
  );
  assert.equal(dated.retryAfter, 300_000, 'against the clock of the device');
  // /info answering something that is not an object: not a NET2GRID device.
  assert.equal((await codeOf(client(() => json([1, 2])).client.info())).code, 'unknown_answer');
});

test('a hostile answer is cut at 64 KiB, before it is read in full', async () => {
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024).fill(0x31));
    },
  });
  const err = await codeOf(client(() => new Response(body, { status: 200 })).client.meter());
  assert.equal(err.code, 'too_large');
  assert.ok(pulled <= 70, `${pulled} chunks pulled`);
  const err2 = await codeOf(
    client(() => new Response(streamOf(10_000, 1024), { status: 200 })).client.info(),
  );
  assert.equal(err2.code, 'too_large');
});

test('one request at a time', async () => {
  const { net, client: c } = client(() => json(info()));
  net.hold = true;
  const a = c.info();
  const b = c.info();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.calls.length, 1);
  net.hold = false;
  net.release();
  await a;
  await b;
  assert.equal(net.calls.length, 2);
});

// -----------------------------------------------------------------------------
// The configuration: the address (one unicast host) and the margin.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComplete, normalizeConfig, parseAddress } from '../src/config.js';

test('the address: IP, host, port, pasted URL; a login in it is refused', () => {
  assert.deepEqual(parseAddress(' 192.168.1.60 '), { address: '192.168.1.60' });
  assert.deepEqual(parseAddress('http://192.168.1.60:80/meter/now'), { address: '192.168.1.60' });
  assert.deepEqual(parseAddress('pure.local:8080'), { address: 'pure.local:8080' });
  assert.deepEqual(parseAddress('fe80::1'), { address: '[fe80::1]' });
  assert.deepEqual(parseAddress('http://admin:pw@192.168.1.60'), { error: 'invalid' });
  assert.deepEqual(parseAddress('a b'), { error: 'invalid' });
  assert.deepEqual(parseAddress('a\r\nb'), { error: 'invalid' });
  assert.deepEqual(parseAddress('1.2.3.4:70000'), { error: 'invalid' });
});

test('the address: never any, broadcast or multicast; IPv4 numbers within 255', () => {
  for (const bad of [
    '0.0.0.0',
    '0.1.2.3',
    '255.255.255.255',
    '224.0.0.251',
    '239.255.255.250',
    '240.0.0.1',
    '[ff02::1]',
    'ff02::fb',
    '::',
    '[::]:80',
    '999.1.1.1',
    '1.2.3',
    '0xe0000001',
    '0xe0.0.0.1',
    '0xffffffff',
    '0x0',
    '010.0.0.1',
    '[::ffff:224.0.0.1]',
    '[::ffff:0.0.0.0]',
    'foo.123',
  ]) {
    assert.deepEqual(parseAddress(bad), { error: 'invalid' }, bad);
  }
  assert.deepEqual(parseAddress('10.0.0.255'), { address: '10.0.0.255' });
});

test('the configuration: complete with an address; a bad one is said so', () => {
  assert.equal(isComplete(normalizeConfig({ address: '192.168.1.60' })), true);
  assert.equal(isComplete(normalizeConfig({})), false);
  const bad = normalizeConfig({ address: '224.0.0.1' });
  assert.equal(bad.address, '');
  assert.equal(bad.invalidAddress, true);
  assert.equal(normalizeConfig({ address: 'x'.repeat(400) }).invalidAddress, true);
});

test('the margin of the guard: bounded, else 100 kW', () => {
  assert.equal(normalizeConfig({}).maxKw, 100);
  assert.equal(normalizeConfig({ max_power_kw: 250 }).maxKw, 250);
  assert.equal(normalizeConfig({ max_power_kw: '43.5' }).maxKw, 43.5);
  for (const bad of [0, -5, 5000, '', 'x', null, NaN]) {
    assert.equal(normalizeConfig({ max_power_kw: bad }).maxKw, 100, String(bad));
  }
});

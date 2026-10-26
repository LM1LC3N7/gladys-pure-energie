// -----------------------------------------------------------------------------
// The answers of the device -> values (src/net2grid/model.js), pure.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idOf, numberOf, parseInfo, parseMeter } from '../src/net2grid/model.js';
import { ID, NOW, RAW_ID, info, meter } from './fixtures/net2grid.js';

test('the id: hex digits only, lower case; anything else unreadable', () => {
  assert.equal(idOf(RAW_ID), ID);
  assert.equal(idOf(' 84DF-0C11-9999-3795 '), ID);
  assert.equal(idOf('84df0c1199993795'), ID);
  for (const bad of [
    undefined,
    null,
    '',
    12345678,
    '0000:0000:0000:0000',
    '84df:0c11:9999:37zz',
    '84df:0c11/9999',
    '..',
    '84df:0c11:9999:3795\r\n',
    'ab',
    'a'.repeat(40),
    '84df::0c11',
  ]) {
    assert.equal(idOf(bad), undefined, String(bad));
  }
});

test('the id is read in linear time, whatever the device sends', () => {
  const hostile = `${'a'.repeat(40)}g`;
  const started = performance.now();
  for (let i = 0; i < 200; i += 1) {
    assert.equal(idOf(hostile), undefined);
    assert.equal(idOf(`${'ab:'.repeat(21)}g`), undefined);
  }
  assert.ok(performance.now() - started < 200, `${performance.now() - started} ms`);
  assert.equal(idOf('84df0c11-9999:3795'), ID);
  assert.equal(idOf('84df0c1199993795abcd0000ffffeeee'), '84df0c1199993795abcd0000ffffeeee');
  assert.equal(idOf('84df0c1199993795abcd0000ffffeeee00'), undefined);
});

test('the device page: the id, model and firmware checked; no id is unreadable, not another', () => {
  assert.deepEqual(parseInfo(info()), {
    id: ID,
    model: 'SBWF3102',
    manufacturer: 'NET2GRID',
    firmware: '1.6.16',
    hardware: '1',
  });
  const noId = parseInfo({ ...info(), id: undefined });
  assert.equal(noId.id, undefined);
  assert.equal(parseInfo({ ...info(), model: '<script>' }).model, undefined);
  assert.equal(parseInfo('text'), undefined);
  assert.equal(parseInfo([info()]), undefined);
  // Own keys only: a prototype key is never read.
  const proto = JSON.parse('{"__proto__": {"id": "84df:0c11:9999:3795"}}');
  assert.equal(parseInfo(proto).id, undefined);
});

test('numbers: a number or a strict numeric string, never "" read as 0', () => {
  assert.equal(numberOf(12), 12);
  assert.equal(numberOf(' -7.5 '), -7.5);
  for (const bad of ['', ' ', '1e3', '0x10', null, undefined, NaN, Infinity, '12 W', true]) {
    assert.equal(numberOf(bad), undefined, String(bad));
  }
});

test('the meter: signed W, indexes in kWh, the time of reading', () => {
  const reading = parseMeter(meter({ power: -1200 }));
  assert.equal(reading.power, -1200);
  assert.equal(reading.imported, 17_762.055);
  assert.equal(reading.exported, 21_214.589);
  assert.equal(reading.sourceAt, Math.floor(NOW / 1000) * 1000);
  assert.equal(reading.unitUnknown, false);
});

test('the meter: kW and kWh converted; an energy without a known unit is never used', () => {
  const m = meter();
  m.elec.power.now.unit = 'kW';
  m.elec.power.now.value = 1.5;
  m.elec.import.now.unit = 'kWh';
  m.elec.import.now.value = 12_345.678;
  m.elec.export.now.unit = 'MWh';
  const reading = parseMeter(m);
  assert.equal(reading.power, 1500);
  assert.equal(reading.imported, 12_345.678);
  assert.equal(reading.exported, undefined);
  assert.equal(reading.unitUnknown, true);
  const none = meter();
  delete none.elec.import.now.unit;
  delete none.elec.power.now.unit;
  const r2 = parseMeter(none);
  assert.equal(r2.imported, undefined, 'no unit: never guessed');
  assert.equal(r2.unitUnknown, true);
  assert.equal(r2.power, 338, 'a power without unit is in W, as gridnet reads it');
  const proto = meter();
  proto.elec.import.now.unit = 'constructor';
  assert.equal(parseMeter(proto).imported, undefined);
  assert.equal(parseMeter(proto).unitUnknown, true);
});

test('the meter: 0, "", out of bounds and missing values are not values', () => {
  assert.equal(parseMeter(meter({ imported: 0 })).imported, undefined);
  assert.equal(parseMeter(meter({ imported: -5 })).imported, undefined);
  assert.equal(parseMeter(meter({ imported: '' })).imported, undefined);
  assert.equal(parseMeter(meter({ imported: 2e15 })).imported, undefined);
  assert.equal(parseMeter(meter({ power: '' })).power, undefined);
  assert.equal(parseMeter(meter({ power: 1e9 })).power, undefined);
  assert.equal(parseMeter(meter({ power: 0 })).power, 0, 'a power of 0 W is a value');
  const m = meter();
  delete m.elec.export;
  m.elec.power.now.time = 'soon';
  m.elec.import.now.time = 12;
  const reading = parseMeter(m);
  assert.equal(reading.exported, undefined);
  assert.equal(reading.sourceAt, undefined, 'no readable time');
});

test('the meter: the envelope first; a status that is not ok', () => {
  assert.equal(parseMeter({ hello: 'world' }), undefined);
  assert.equal(parseMeter({ status: 'ok', elec: [] }), undefined);
  assert.equal(parseMeter(null), undefined);
  assert.deepEqual(parseMeter({ status: 'error', elec: {} }), { status: 'not_ok' });
  const noStatus = meter();
  delete noStatus.status;
  assert.equal(parseMeter(noStatus).power, 338);
  const empty = parseMeter({ status: 'ok', elec: {} });
  assert.equal(empty.power, undefined);
  assert.equal(empty.imported, undefined);
});

// -----------------------------------------------------------------------------
// Answers of the NET2GRID local HTTP API, shaped after the fixtures of the
// gridnet library (tests/fixtures/device.json and smartbridge.json, Klaas
// Schoute, MIT): built, never captured on a real device (none was at hand).
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.60';
export const NOW = Date.parse('2026-10-24T10:00:00Z');
export const RAW_ID = '84df:0c11:9999:3795';
export const ID = '84df0c1199993795';
export const OTHER_RAW_ID = '84df:0c11:9999:aaaa';
export const OTHER_ID = '84df0c119999aaaa';

export const info = (id = RAW_ID) => ({
  id,
  mf: 'NET2GRID',
  model: 'SBWF3102',
  fw: '1.6.16',
  hw: 1,
  batch: 'SBP-HMX-210318',
});

/**
 * The meter at `t` (ms): the power, the import and export indexes in Wh,
 * dated `t` in Unix seconds (as the device dates them).
 */
export const meter = ({
  t = NOW,
  power = 338,
  imported = 17_762_055,
  exported = 21_214_589,
} = {}) => {
  const time = Math.floor(t / 1000);
  return {
    status: 'ok',
    elec: {
      power: {
        now: { value: power, unit: 'W', time },
        min: { value: -7345, unit: 'W', time: 1631360893 },
        max: { value: 13725, unit: 'W', time: 1633749513 },
      },
      import: { now: { value: imported, unit: 'Wh', time } },
      export: { now: { value: exported, unit: 'Wh', time } },
    },
    gas: {},
  };
};

export const json = (body, { status = 200, headers = {} } = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

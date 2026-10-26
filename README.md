# gladys-pure-energie

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for the
**Pure Energie energy meter reader** (a NET2GRID SmartBridge such as the
SBWF3102, on the P1 port of the electricity meter), read through its local
HTTP API, no cloud, no key. Not affiliated with Pure Energie nor NET2GRID.

**Never tested with a real device**: built from the Python library
[gridnet](https://github.com/klaasnicolaas/python-gridnet) (MIT, the one
Home Assistant uses), ported to JavaScript.

- One device, keyed by the NET2GRID id of the meter reader, checked before
  and after the values at every read.
- Signed power (below 0 while injecting) every 30 seconds.
- Consumption index once a minute, as the only energy index, checked by a
  guard: never 0, a drop or a jump held until the user accepts it in two
  clicks. The injection is a plain sensor, never billed.
- Only fresh values: a reading whose time and values have not moved is
  never sent again, not even after a restart.
- Read-only: only GET requests.

Documentation: [English](docs/en.md), [français](docs/fr.md).

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
```

License: Apache-2.0 (see `LICENSE` and `THIRD_PARTY_NOTICES.md`).

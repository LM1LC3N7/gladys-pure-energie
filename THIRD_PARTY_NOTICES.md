# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license.

## gridnet (klaasnicolaas/python-gridnet)

<https://github.com/klaasnicolaas/python-gridnet>, by Klaas Schoute, the
library the Pure Energie integration of Home Assistant (`pure_energie`) uses.
Version 5.0.1 on PyPI (2024-06-28), `main` at commit 73564fd (2026-10-26).

Ported to JavaScript in `src/net2grid/client.js` and `src/net2grid/model.js`:
the local HTTP API of the NET2GRID devices (`GET /info` for the id, maker,
model, firmware and hardware, `GET /meter/now` for the power and the import
and export counters, in W and Wh), a 10-second timeout, the `Accept` header
it sends. The test answers in `test/fixtures/net2grid.js` are shaped after
its fixtures (`tests/fixtures/device.json`, `smartbridge.json`). Changed
here: values are read against strict patterns and bounds, an energy without
a known unit is never used, a counter at 0 is "not available", the time of
reading is read (the library ignores it), the id is checked before and after
each reading. No User-Agent is sent (the library sends its own).

Its license, reproduced as it appears in the repository:

```
# MIT License

Copyright (c) 2021-2026 Klaas Schoute

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## gladys-iskra, gladys-p1-monitor

The plausibility guard of the billed index (`src/guard.js`, with its tests),
the `/data` store (`src/store.js`), the address parser (`src/config.js`), the
bounded HTTP read, the pace of the reads and the two-click acceptance come
from the sibling integrations [gladys-iskra](https://github.com/LM1LC3N7/gladys-iskra)
and [gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor), same
project, Apache-2.0.

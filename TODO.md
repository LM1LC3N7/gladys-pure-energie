# TODO

## Before announcing

- [ ] Test on a real Gladys with a real Pure Energie / NET2GRID meter reader:
      test button, device creation, the consumption the core derives from
      the index, the sign of the power while injecting.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real device (built without one)

- [ ] The answers of `/info` and `/meter/now` as gridnet reads them; whether
      `time` is always given (Unix seconds) and moves at every reading.
- [ ] The form of the id on other models than the SBWF3102 (hex groups
      separated by ":" are assumed; other forms are "unreadable").
- [ ] Whether `unit` is always given for the indexes (an index without a
      unit is not sent today).
- [ ] The sign of the power while injecting (the gridnet fixture has a
      negative minimum: below 0 is taken as injection).
- [ ] Whether the device copes with 3 requests every 30 s (`/info`,
      `/meter/now`, `/info`).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-pure-energie:0.1.0`);
  the Release workflow owns them from now on.
- **SDK**: `@gladysassistant/integration-sdk` ^0.15.0, the latest on npm on
  2026-10-26 (0.16.0 is tagged on GitHub but not published; the template's
  ^0.16.0 could not be installed). Manifest without `keywords`/`countries`
  (they need Gladys 5.3, to add with the SDK 0.16 migration);
  `gladys_version` `>=5.1.0`; category `energy`.
- **Reused project**: gridnet (Klaas Schoute, MIT, 5.0.1, `main` at 73564fd),
  cloned read-only in `~/code/ref/lot16/gridnet`, ported to JavaScript
  (`src/net2grid/`): two pages, units, fields. The SDK stays the only runtime
  dependency. The guard (`src/guard.js`, the approved shared file, with its
  tests), the store, the address parser, the pace and the two-click
  acceptance come from gladys-iskra / gladys-p1-monitor (approved). The
  template's demo files were removed with `git rm`.
- **Read-only**: only GET requests; no `onSetValue`.
- **External id**: `meter:<hex id>` (the NET2GRID id without its separators,
  8 to 32 hex digits, never only zeros); the address is only a param. Every
  read asks `/info` before and after `/meter/now`: an id that differs, or one
  that cannot be read, publishes nothing (retried with the usual backoff);
  an unreadable id is never "another device". Another id on both sides
  gets its own device (status note); the old one gets nothing more.
- **Energy (fiche, section Energy)**: the import counter is the only
  `energy-sensor/index` (kWh, 3 decimals, through the `IndexGuard`, once a
  minute, the guard in `/data` before Gladys gets the value); 0 is "not
  available"; drops and jumps held, accepted in two clicks (3 s to 5 min
  apart, same session, bounded to the value shown plus the margin). The
  export counter is a plain sensor (`unknown/decimal`, kWh in the name),
  never 0. The power is the only `energy-sensor/power`, signed. An energy
  without a known unit (Wh, kWh) is never used. No `publishEnergyConsumption`.
  The margin is a configuration field (100 kW by default, 1 to 2000).
- **Freshness**: the latest `time` of the three values (Unix seconds) is the
  mark of a reading (a fingerprint of the values without one), kept in
  `/data` with the wall time it last changed (a future date is not valid). A
  reading with the same mark publishes nothing (not even the heartbeat), at
  a restart and a reconnection too; unchanged for 2 h, the status says so.
- **Pace**: one timer, one read at a time, never two reads less than 30 s
  apart (the HA interval) whatever asks; the time of the last read is in
  `/data` before the request (at most once a minute, and at a clean stop); a
  future date there is not valid (read at once).
- **Errors**: unreachable or wrong answer: 30 s doubled to 10 min (in
  memory); 429/5xx: pause in `/data`, Retry-After or 1 min doubled, 1 min to
  6 h, on the monotonic clock in memory. 401/403 are plain HTTP errors (the
  API has no login).
- **Addresses**: a host name or a unicast IP; 0.0.0.0, broadcast,
  multicast, `::`, control bytes and logins in the address are refused.
- **/data**: a missing file is an empty state; a file that cannot be read is
  never written over (status note).
- **No custom User-Agent**, no imitation: Node's own fetch.

## Ideas

- The gas part of `/meter/now` (empty in the gridnet fixture): as a plain
  m³ sensor, once its shape is known.

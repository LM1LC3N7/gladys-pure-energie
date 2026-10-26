# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads the **Pure Energie energy meter reader** (a NET2GRID SmartBridge on
the P1 port of the electricity meter) through its local HTTP API (`GET /info`,
`GET /meter/now`, no key, no cloud). The pages and their fields are ported
from [gridnet](https://github.com/klaasnicolaas/python-gridnet) (Klaas
Schoute, MIT, see `THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with
Pure Energie nor NET2GRID. **Read-only**: never `onSetValue`, only GET.
Siblings: `gladys-iskra` (the structure of `src/app.js`, the store, the pace,
the two-click acceptance), `gladys-p1-monitor` (the guard).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        PureEnergieApp: the pace, identity, freshness, the index, pauses, buttons
src/net2grid/client.js            the only HTTP access (GET, bounded, our error codes)
src/net2grid/model.js             the answers -> values (pure)
src/guard.js                      plausibility of an energy index (approved shared file, pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     the address and the margin, normalized
src/constants.js                  pages, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys, a fake device, a virtual clock
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Energy monitoring**: `consumption_index` (`energy-sensor` / `index`, kWh)
  is the only index: the import counter of the meter. It passes `IndexGuard`
  (`src/guard.js`, `max_power_kw` of the configuration, 0.5 kWh): never 0, a
  drop and a jump never confirmed by repetition nor by time, taken only by
  the `accept_held_index` action in two clicks. The injection (export
  counter) is a plain sensor: never an index, never `energy`, never
  `publishEnergyConsumption`. Do not change `src/guard.js` without the same
  change in its siblings and a review.
- **Units**: only the core's (`DEVICE_FEATURE_UNITS_BY_CATEGORY`): W and kWh
  for `energy-sensor`, none for `unknown` (the unit is in the name). An
  energy without a known unit is never used.
- **Freshness**: a reading whose time (or fingerprint) has not moved
  publishes nothing; the mark is kept in `/data`. Never publish from a path
  that skips `followFreshness()`.
- **The pace**: never two reads less than 30 s apart, whatever asks; the
  time of the last read is in `/data`. Never add a read path that skips
  `dueAt(mono)`; read the clock once per decision.
- **Late answers**: every await in a read is followed by `gone()`; an old
  session (address) never publishes nor sets a status.
- **Identity**: the values of a read go to the device of the id read before
  AND after them. An unreadable id is never another device.
- **Never a free text of the device in a message**, never a URL in the logs.
- **External ids are forever**: `meter:<hex id>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys and actions. Features only grow: a
  device published again keeps every feature it was created with.
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/pure-energie-state.json`; a file that cannot be
  read is never written over.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading: the Release workflow moves
  the section.
- **Manifest.** Texts are `{ "en": ..., "fr": ... }` objects; the catalog
  `description` holds 10 to 100 characters per language; never a `default`
  on a secret; no config key starting with `gladys_`.
- **User-facing text** is bilingual (English and French), docs kept in sync.
  Files are UTF-8 without BOM nor control bytes (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (but `test/realclock.test.js`,
  on a local server).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.

## Checking an answer against a real device

On the same LAN as the meter reader:

```bash
curl -s "http://192.168.1.60/info"; echo
curl -s "http://192.168.1.60/meter/now"; echo
```

Change the id before an answer becomes a fixture.

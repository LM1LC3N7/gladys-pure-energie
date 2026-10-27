# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Integration SDK 0.16 (no change for the devices).

## [0.1.1] - 2026-10-26

### Added

- First version: the Pure Energie (NET2GRID) meter reader read through its
  local HTTP API (`/info`, `/meter/now`, ported from gridnet): one device
  keyed by its NET2GRID id (checked before and after each reading), signed
  power, a guarded consumption index (never 0, drops and jumps held until
  accepted in two clicks), the injection as a plain sensor, only fresh values
  (dated by the device, the date kept in `/data`), pauses on 429/5xx, the
  test and accept buttons; `/data` written only when its content changes (the
  time of the last attempt at most once a minute, for SD cards).

[Unreleased]: https://github.com/LM1LC3N7/gladys-pure-energie/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-pure-energie/releases/tag/v0.1.1

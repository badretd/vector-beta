# Changelog

All notable changes to Vector are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-11

The first packaged desktop release.

### Added

- Windows installer (`Vector-<version>-windows-x64-Setup.exe`), macOS disk
  images for Apple Silicon and Intel, and a Linux AppImage/tarball.
- Tag-driven release workflow that validates the version, runs the test suite,
  builds every platform, self-tests each frozen build, and creates a GitHub
  Release with SHA-256 checksums.
- `--self-test` command that verifies bundled native libraries, the Silero VAD
  model, the web assets, and write access to the data directory.
- `--version` command.
- Automatic browser detection on Windows and macOS, in addition to Linux.

### Changed

- Installed builds store settings, history, study notes, logs, and downloaded
  Whisper models in the per-user application data directory instead of next to
  the executable:
  - Windows: `%LOCALAPPDATA%\Vector`
  - macOS: `~/Library/Application Support/Vector`
  - Linux: `$XDG_DATA_HOME/Vector` (usually `~/.local/share/Vector`)
- Source checkouts continue to use the repository's `data/` directory.
- The application icon now uses the original 12×12 Vector smile sprite in pure
  black and white, on every platform and in the browser favicon.

### Fixed

- Windowed Windows builds no longer crash while uvicorn configures its logging
  when `sys.stdout`/`sys.stderr` are unavailable. Uvicorn now uses Vector's own
  file and in-app logging, and missing stdio is redirected to a safe sink.
- Frozen builds no longer try to write into the installation directory, which
  is read-only under `Program Files` and macOS `/Applications`.
- Chrome app-window mode no longer relies on Linux-only executable names on
  Windows and macOS.

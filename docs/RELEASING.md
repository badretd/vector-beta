# Releasing Vector

This repository builds and publishes desktop binaries from a **git tag**. The
workflow in `.github/workflows/release.yml` runs when a tag matching
`vMAJOR.MINOR.PATCH` is pushed. It:

1. checks that the tag matches `vector.__version__`;
2. runs the test suite;
3. builds Windows, macOS (arm64 + x86_64), and Linux packages;
4. runs a self-test against every frozen build;
5. creates a **draft** GitHub Release with the installers and checksums.

You review the draft, download the artifacts, and publish it manually.

> The version prepared in this repository is **0.1.0**. The tag must be
> `v0.1.0`.

---

## What gets built

| Platform | Release asset | Notes |
| --- | --- | --- |
| Windows 10/11 x64 | `Vector-0.1.0-windows-x64-Setup.exe` | Per-user install, no admin prompt |
| macOS 11+ Apple Silicon | `Vector-0.1.0-macos-arm64.dmg` | Signed/notarized when secrets exist |
| macOS 11+ Intel | `Vector-0.1.0-macos-x86_64.dmg` | Signed/notarized when secrets exist |
| Linux x86_64 | `Vector-0.1.0-linux-x86_64.AppImage` | Built on Ubuntu 22.04 |
| Linux x86_64 | `Vector-0.1.0-linux-x86_64.tar.gz` | Portable folder |
| All | `SHA256SUMS.txt` | Generated during publishing |

The **first run** still downloads the Whisper speech model (~466 MB). Ollama
and its language model (~2 GB) are separate installations; the installer does
not bundle them.

Release notes are read from `docs/releases/<version>.md` when that file exists;
otherwise GitHub generates notes from the commits. The 0.1.0 notes are in
[`docs/releases/0.1.0.md`](releases/0.1.0.md).

---

## One-time setup

### 1. Put the workflow on the default branch

GitHub only runs tag workflows that exist in the tagged commit. Merge
`.github/workflows/release.yml`, `packaging/`, and the version change before
creating the tag.

```bash
git switch main
git pull --ff-only
git push origin main
```

No repository settings changes are required: only the publish job requests
`contents: write`. For a public repository, standard GitHub-hosted runners are
free.

`.github/workflows/ci.yml` also runs the test suite on pushes to `main` and on
pull requests, so you can keep the branch green before tagging.

### 2. Optional: configure code signing

Without secrets the build still succeeds, but:

- Windows shows the SmartScreen warning;
- macOS Gatekeeper blocks the app until the user right-clicks **Open** or
  removes the quarantine attribute.

Add secrets under **Settings → Secrets and variables → Actions → New
repository secret**.

#### Windows (Authenticode)

| Secret | Value |
| --- | --- |
| `WINDOWS_CERT_PFX_BASE64` | Base64 of your `.pfx` code-signing certificate |
| `WINDOWS_CERT_PASSWORD` | Password for the `.pfx` |

Create the base64 value on Windows:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\cert.pfx")) |
  Set-Clipboard
```

On macOS/Linux:

```bash
base64 -w0 cert.pfx        # Linux
base64 -i cert.pfx         # macOS
```

Hardware-token / EV certificates cannot be exported as `.pfx`. In that case,
skip CI signing and sign locally, or use a cloud signing service (for example
Azure Trusted Signing) and replace the signing step in the workflow.

#### macOS (Developer ID + notarization)

You need a paid Apple Developer account and a **Developer ID Application**
certificate. Export it from Keychain Access as a password-protected `.p12`.

| Secret | Value |
| --- | --- |
| `MACOS_CERT_P12` | Base64 of the `.p12` |
| `MACOS_CERT_PASSWORD` | Password for the `.p12` |
| `MACOS_SIGN_IDENTITY` | Exact identity, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER_ID` | App Store Connect issuer ID |
| `APPLE_API_KEY_P8` | Base64 of the `AuthKey_XXXX.p8` file |

Find the identity:

```bash
security find-identity -v -p codesigning
```

Create the API key in **App Store Connect → Users and Access → Integrations →
App Store Connect API → Team Keys**. Download the `.p8` once; it cannot be
downloaded again.

```bash
base64 -w0 AuthKey_XXXX.p8   # Linux
base64 -i AuthKey_XXXX.p8    # macOS
```

If signing secrets exist but notarization secrets do not, the workflow signs
the DMG, skips notarization, and prints a warning.

### 3. Optional: protect release tags

Add a **tag protection rule** for `v*` under **Settings → Rules → Rulesets** so
only maintainers can create release tags. This prevents accidental releases.

---

## Release procedure for 0.1.0

Everything for 0.1.0 is already prepared:

- `vector/__init__.py` contains `__version__ = "0.1.0"`;
- `CHANGELOG.md` has the 0.1.0 entry;
- the workflow and packaging files are committed.

If you have not committed them yet, do that first. Then follow these steps.

### Step 1 — Sync and verify

```bash
git switch main
git pull --ff-only
git status                       # review: only intended release files should appear
grep __version__ vector/__init__.py
```

Expected:

```text
__version__ = "0.1.0"
```

Run the tests:

```bash
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pytest -q
```

### Step 2 — Commit the release

Only needed if the working tree is not clean. Check `git status` first, then:

```bash
git add -A
git commit -m "Release 0.1.0"
git push origin main
```

The tag must point at the commit you want to ship, so push the branch **before**
the tag.

### Step 3 — Create and push the tag

```bash
git tag -a v0.1.0 -m "Vector 0.1.0"
git push origin v0.1.0
```

That push is the trigger. Do not push the tag until `main` is green and the
version file says `0.1.0`.

### Step 4 — Watch the workflow

Open **Actions → Release** in the GitHub UI. The stages are:

```text
Validate tag → Tests → Windows / macOS arm64 / macOS x86_64 / Linux → Publish draft
```

A normal run takes roughly 15–30 minutes. The macOS jobs are the slowest.

If the tag does not match `vector.__version__`, the **Validate tag** job fails
immediately with an explicit error and nothing is built.

### Step 5 — Review and publish the draft

Go to **Releases**. A draft named **Vector 0.1.0** contains the five assets and
`SHA256SUMS.txt`. Before publishing:

1. Download at least the installer for your own platform.
2. Install it and start Vector. Check that the browser window opens and
   `Vector --version` / the debug panel shows `0.1.0`.
3. Confirm the checksums:
   ```bash
   sha256sum -c SHA256SUMS.txt        # download the assets first
   ```
4. Edit the release notes if needed, then click **Publish release**.

Publishing from the command line:

```bash
gh release edit v0.1.0 --draft=false
```

To make future releases publish automatically, change `draft: true` to
`draft: false` in `.github/workflows/release.yml`.

---

## Re-running a failed release

If the workflow fails but the release is still a draft:

1. Fix the problem on `main`, run the tests, and push the fix.
2. Move the tag to the new commit:
   ```bash
   git tag -d v0.1.0
   git push origin :refs/tags/v0.1.0
   git tag -a v0.1.0 -m "Vector 0.1.0"
   git push origin v0.1.0
   ```

You can also use **Actions → Release → Re-run all jobs** to retry the same
commit. Never delete or move a tag after the release has been published.

If only one platform failed, you can re-run that job from the workflow run
page; the publish job runs again and updates the existing draft.

---

## Local builds

PyInstaller cannot cross-compile. Build each platform on that platform.

First install the build dependencies:

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
```

### Windows

```powershell
$env:VECTOR_VERSION = "0.1.0"
python -m PyInstaller --noconfirm --clean packaging/vector.spec
dist\Vector\Vector.exe --self-test --data-dir "$env:TEMP\vector-data"
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" packaging\windows\vector.iss
```

Result: `dist\installer\Vector-0.1.0-windows-x64-Setup.exe`.

### macOS

```bash
export VECTOR_VERSION=0.1.0
python -m PyInstaller --noconfirm --clean packaging/vector.spec
dist/Vector.app/Contents/MacOS/Vector --self-test --data-dir "$TMPDIR/vector-data"
hdiutil create -volname "Vector $VECTOR_VERSION" -srcfolder dist/Vector.app \
  -ov -format UDZO "dist/Vector-${VECTOR_VERSION}-macos-$(uname -m).dmg"
```

Result: `dist/Vector-0.1.0-macos-arm64.dmg` or `...-x86_64.dmg`.

### Linux

```bash
export VECTOR_VERSION=0.1.0
python -m PyInstaller --noconfirm --clean packaging/vector.spec
dist/Vector/Vector --self-test --data-dir /tmp/vector-data
tar -C dist -czf "dist/Vector-${VECTOR_VERSION}-linux-x86_64.tar.gz" Vector

# appimagetool: https://github.com/AppImage/appimagetool/releases
APPIMAGETOOL=/path/to/appimagetool packaging/linux/build_appimage.sh "$VECTOR_VERSION"
```

Result: `dist/Vector-0.1.0-linux-x86_64.AppImage` and the tarball.

### Self-test report

`--self-test` imports `ctranslate2`, `onnxruntime`, `av`, and `faster-whisper`,
loads the Silero VAD model, checks the bundled `web/index.html`, and verifies
that the data directory is writable. It writes `self-test.json` into the data
directory and exits non-zero on failure. Use it after packaging changes.

---

## How versioning works

- The single source of truth is `vector/__init__.py`.
- The tag is `v` + that version. `v0.1.0` ↔ `__version__ = "0.1.0"`.
- A tag with a suffix such as `v0.2.0-rc.1` is accepted and creates a
  **prerelease** draft.
- Before starting the next release, bump `__version__`, add a `CHANGELOG.md`
  section, commit, and tag.

Use [Semantic Versioning](https://semver.org/): `0.x` while the packaged
interface is still settling, then `1.0.0` when it is stable.

---

## Troubleshooting

**The tag was pushed but no workflow appeared.** Check the tag name and that
the workflow file is on the tagged commit and on the default branch:

```bash
git ls-remote --tags origin
git show v0.1.0:.github/workflows/release.yml >/dev/null && echo present
```

**`Tag version ... does not match vector.__version__`.** Bump
`vector/__init__.py`, commit, delete the tag, and push it again.

**A macOS job is cancelled immediately.** GitHub rotates macOS runner images.
macOS 14 images were retired on 2026-11-02, so the arm64 job uses `macos-15`
and the Intel job uses `macos-15-intel`. Check the
[runner-images README](https://github.com/actions/runner-images#available-images)
for the current labels and update the matrix. The workflow does not
cross-compile: an Intel build must run on an Intel runner.

**Windows self-test reports a missing DLL.** Inspect
`dist\Vector\_internal`. The build is one-folder on purpose; do not switch to
`--onefile`. Missing `ctranslate2` or `onnxruntime` libraries usually mean
the package wheel was built for a different architecture.

**The AppImage fails on an older distribution.** It is built on Ubuntu 22.04
(glibc 2.35). Users on older systems need the tarball or a source install.
Build on an older runner if wider compatibility is required.

**macOS says the app is damaged.** It is unsigned or not notarized. Either
configure the Apple secrets, or tell users to right-click **Open**. For local
testing:

```bash
xattr -dr com.apple.quarantine /Applications/Vector.app
```

**Windows SmartScreen warns about the installer.** The installer is unsigned.
Configure `WINDOWS_CERT_PFX_BASE64` and `WINDOWS_CERT_PASSWORD`, or accept the
warning for a community release.

**The release has a stale asset.** Delete the asset in the draft release and
re-run the workflow; the publish job replaces the draft contents.

---

## Checklist

- [ ] `.github/workflows/release.yml` is on `main`
- [ ] `vector/__version__ == "0.1.0"`
- [ ] `CHANGELOG.md` has the 0.1.0 section
- [ ] `docs/releases/0.1.0.md` has the release notes
- [ ] `pytest -q` passes
- [ ] Signing secrets configured (or intentionally skipped)
- [ ] `git push origin main`
- [ ] `git tag -a v0.1.0 -m "Vector 0.1.0"`
- [ ] `git push origin v0.1.0`
- [ ] All release jobs are green
- [ ] Draft assets downloaded and smoke-tested
- [ ] Draft published

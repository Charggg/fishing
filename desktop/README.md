# Deep Cast — desktop shell

An Electron wrapper around the same `game/` folder the browser build uses. The
game is not modified for it: `game/index.html` still runs from a plain
`file://` double click with no shell present.

## What the desktop build actually adds

- **A guaranteed GPU.** It asks for the discrete adapter and bypasses
  Chromium's driver blocklist, so WebGL2 does not silently fall back to
  software rendering.
- **Real fullscreen** on `F11`, with `Escape` left alone — the game uses
  Escape for its own pause menu, and letting it also exit fullscreen makes
  pausing feel broken.
- **A save you can find and back up.** `save.json` in the OS app-data
  directory instead of browser site data that a "clear browsing data" wipes.
  localStorage is still the working copy; the file is written alongside it and
  is what gets loaded at startup.
- **No `file://` restrictions**, which is what makes Safari awkward on macOS.
- **Remembered window position and size**, validated against the displays that
  actually exist so the window cannot open off-screen.

Security posture: `contextIsolation` on, `nodeIntegration` off, no remote
content, and a preload that exposes four save functions and nothing else. The
smoke test asserts that `require` and `process` are not reachable from the page.

## Running it in development

```bash
cd desktop
npm install
npm start
```

## Building installers

Cross-building does not work: the Windows target fails at the signing step
without Wine, and a macOS `.dmg` can only be produced on macOS. Build on the
platform you are targeting, or let CI do it.

```bash
npm run dist:win      # on Windows  -> .exe installer + portable .exe
npm run dist:mac      # on macOS    -> .dmg (arm64 + x64)
npm run dist:linux    # on Linux    -> .AppImage
```

Output lands in `dist/desktop/`.

**Via CI (recommended).** `.github/workflows/desktop.yml` builds all three on
real runners. Trigger it from the Actions tab ("Desktop builds" → Run
workflow), or push a `v*` tag. Installers are attached to the run as artifacts.

## These builds are unsigned

Signing requires paid certificates — an Authenticode certificate from a
Windows CA, and an Apple Developer account for macOS notarisation. Without
them:

- **Windows** shows a SmartScreen warning on first run. "More info" → "Run
  anyway".
- **macOS** refuses outright, because an unsigned app from the internet is
  quarantined. Right-click the app → **Open** → **Open**, or:
  `xattr -dr com.apple.quarantine "/Applications/Deep Cast.app"`

If you get certificates, add them as repository secrets and electron-builder
picks them up; the workflow sets `CSC_IDENTITY_AUTO_DISCOVERY=false` only
because there are none.

## Testing

```bash
node game/qa/desktop.js                      # the dev app
node game/qa/desktop.js /path/to/binary      # a packaged build
```

It boots the real app and checks the things only this build can break: that
the window actually loaded the game (a packaged build with a wrong resource
path shows a blank window and nothing else notices), that the preload bridge
is present, that node is *not* exposed to the page, that a save round-trips to
disk, and that the context is genuinely WebGL2.

Run it against the packaged binary, not just the dev app — `__dirname` points
inside `app.asar` once packaged, which is exactly the kind of path bug that
only appears after packaging.

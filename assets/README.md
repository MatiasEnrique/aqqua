# Brand icons

`aqqua-waves.svg` is the canonical aqqua Waves mark. `aqqua-nobg.png` is
its transparent raster rendition. The three Icon Composer projects combine
that artwork with the shared white background for the supported app variants:

- `dev/app-icon.icon`
- `preview/app-icon.icon`
- `prod/app-icon.icon`

Each project contains the canonical artwork as `Assets/logo.png`. Platform-neutral,
browser, and Windows renditions receive transparent rounded corners during export;
iOS keeps the required opaque square source and applies its native icon mask at
runtime. Android uses the transparent Waves mark over a white adaptive-icon
background so the launcher applies the device's selected shape.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

The exporter renders one native 1024px iOS source per variant, then derives the
platform-neutral, Windows, and browser sizes from that source before applying the
rounded mask. Keeping one raster source prevents small-size Icon Composer presets
from drifting away from the full app icon.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

Icon Composer's command-line exporter does not expose the `macOS pre-Tahoe` preset. A plain command-line `macOS` export is full bleed and is not suitable for the desktop app, so the export script intentionally leaves the tracked macOS PNGs unchanged and prints a reminder after every run.

The pre-Tahoe PNGs below remain the source for each packaged `.icns`; macOS applies
its current system treatment to that bundle icon. Electron also sets a PNG Dock icon
directly at runtime, which bypasses that treatment. The corresponding `*-tahoe-1024.png`
files are native macOS 26 renders used only for that direct Dock path. Run
`vp run icons:macos-tahoe` on macOS Tahoe or newer after changing any macOS source.
The command creates disposable app bundles, lets `NSWorkspace` apply the native Tahoe
mask and material, validates its geometry, and updates the desktop resource PNG.

Do not use a Tahoe-rendered PNG as the `.icns` source. macOS would apply its system
treatment again and produce a nested, double-masked icon.

After changing an Icon Composer project, open it in Icon Composer and export the macOS PNG with exactly these settings:

- Platform: `macOS pre-Tahoe`
- Appearance: `Default`
- Size: `1024pt`
- Scale: `1×`

Save the three exports to:

- `dev/app-icon.icon` -> `dev/blueprint-macos-1024.png`
- `preview/app-icon.icon` -> `preview/preview-macos-1024.png`
- `prod/app-icon.icon` -> `prod/black-macos-1024.png`

Then regenerate the direct Dock renditions:

```sh
vp run icons:macos-tahoe
```

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native Icon Composer shadow extending into the surrounding transparent canvas.

To have Codex perform the native exports, paste this prompt into a task opened at the repository root:

```text
Use [@Computer](plugin://computer-use@openai-bundled) and the Icon Composer app to export the three macOS app icons in this repository.

For each project below, use Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, and Scale: 1×, then save the PNG to the exact destination:

- assets/dev/app-icon.icon -> assets/dev/blueprint-macos-1024.png
- assets/preview/app-icon.icon -> assets/preview/preview-macos-1024.png
- assets/prod/app-icon.icon -> assets/prod/black-macos-1024.png

Do not resize, composite, or otherwise post-process the exported PNGs.

Verify every result is 1024×1024 and has the classic macOS safe area: an 824×824 opaque body inset 100px on every side, with only Icon Composer's native shadow extending beyond it.
```

Do not edit the generated PNG or ICO files directly.

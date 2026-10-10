# chromatik-fixtures

[Chromatik](https://chromatik.co/) fixtures and projects for the TeleCortex dome, plus the LEDPortal triangle.

```
fixtures/   .lxf fixture definitions, one fixture per file
projects/   .lxp Chromatik projects built from them
mapper/     on-site tool that works out which Pi output feeds which panel
mappings/   one mapping per site, written by the mapper
scripts/    setup helpers
```

## Naming

Files are named `<Rig><Part><Variant>` in PascalCase, e.g. `TelecortexPanelLarge`, `TelecortexDomeUpper`.

Chromatik uses a fixture's file name as its type name, and a project stores that type name for every fixture in it. Renaming a fixture therefore means updating every project that uses it (`jsonFixtureType` and `fixtureType`).

## Fixtures

| Fixture | What it is | LEDs | Output |
|---|---|---|---|
| `TelecortexPanelLarge` | One large (BBB) panel, oriented as it sits on the dome, first pixel at the origin | 316 | OPC |
| `TelecortexPanelSmall` | One small (AAB) panel, likewise | 260 | OPC |
| `TelecortexPanelLargeFlat` | A large panel laid flat, built from the `telecortex-opc-sender` config | 316 | OPC |
| `TelecortexDomeOG` | The original 12-panel dome section, five hosts with four channels each | 3,288 | OPC |
| `TelecortexDomeUpper` | The dome minus its bottom ring and the door: 18 panels, host and channel per panel | 4,960 | OPC |
| `LEDPortalTriangle300` | LEDPortal 300-pixel triangle on a hex grid | 300 | sACN |

## Projects

| Project | What it lays out |
|---|---|
| `TelecortexThreePanels` | BU, SLIU and SRIU, each its own panel fixture, addressed to the Pi that drives it |
| `TelecortexDomeOG` | The `TelecortexDomeOG` fixture |
| `TelecortexDomeUpperPanels` | The same 18 panels as `TelecortexDomeUpper`, each its own panel fixture |

Placing each panel as its own fixture is what lets the Panel Transforms effect in [chromatik-plugins](https://github.com/moonbase-labs/chromatik-plugins) rotate one panel at a time during calibration.

## Install

```bash
bun scripts/link-fixtures.ts
```

This symlinks every fixture into `~/Chromatik/Fixtures/`, so a `git pull` updates what Chromatik sees. Re-run it after a fixture is added, renamed or removed: it links new ones and clears links to ones that have gone. It never overwrites a file you have edited there, and is safe to run any number of times. On Windows, symlinks need Developer Mode turned on.

The links go straight into `Fixtures/`, not a subfolder, so the type names match what the projects expect. Then open any project in `projects/`.

## Mapping the dome on site

Panels go into the scaffold in any order and plug into whichever Pi output is nearest. Panels of a size are interchangeable, so what Chromatik needs is which output feeds each slot, and which of three ways round each large panel was mounted. A small panel only fits one way.

```bash
bun mapper/server.ts --site BlazingSwan2026
```

Turn Chromatik's output off first, since both send to the same Pis. Then open the printed address on a phone on the same network and stand under the dome:

1. **Start mapping.** One output lights its panel dim white. Tap that panel on the map, or **Nothing lit** if the output is unused.
2. **Tap the red corner.** The panel's corners light red, green and blue; red is where its data cable enters.
3. **Confirm.** The map shows where green and blue should be. If they are somewhere else, the panel is wired differently from the others: save it flagged and check it later.
4. **Check whole dome** once every output is done. Colour sweeps round the compass and gets brighter lower down, so a panel in the wrong place or turned wrong breaks the pattern. Redo it from the output list.
5. **Build project** writes `projects/TelecortexDomeUpper<Site>.lxp`: every panel its own fixture, addressed to its output and turned as mounted.

**Light everything** lights every output at once, each Pi in its own colour, to check connections before or after mapping: a dark panel isn't getting through, and a panel in the wrong colour is plugged into a different Pi than expected.

Progress saves to `mappings/<Site>.json` after every tap, so restarting picks up where it left off. The Pis to try are listed in that file; edit it if one has a different host. The map can be drawn as seen from inside or from above.

To try it without hardware, run `bun mapper/fake-pi.ts 42070 42071`, list the Pis in the mapping file as `127.0.0.1:42070` and `127.0.0.1:42071`, and pass that file with `--mapping`. `bun test` runs the mapper's tests.

## Dome conventions

- Units are millimetres, and z is up.
- Plan view: +x is east, +y is north. The door is the 5-way hub due south, opposite BU.
- Each Raspberry Pi is addressed as `<balena device name>.local`, e.g. `lingering-brook.local`. Each has four outputs, OPC channels 0 to 3. quiet-hill has not been renamed yet, so it is still addressed by IP.
- The original 12 panels keep their TeleCortex OG names (BU, BRD, SLIU, ...). Panels added since are named by compass point: BSE is the big south-east panel, SEN the small panel at the east hub on its north side.

Chromatik's FREE licence only sends network output for models of 1,000 points or fewer. A single panel or `TelecortexThreePanels` fits; either dome needs a paid tier.

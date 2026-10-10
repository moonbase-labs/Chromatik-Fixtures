# chromatik-fixtures

[Chromatik](https://chromatik.co/) fixtures and projects for the TeleCortex dome, plus the LEDPortal triangle.

```
fixtures/   .lxf fixture definitions, one fixture per file
projects/   .lxp Chromatik projects built from them
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
| `TelecortexThreePanels` | BU, SLIU and SRIU, each its own panel fixture, with their controller IPs |
| `TelecortexDomeOG` | The `TelecortexDomeOG` fixture |
| `TelecortexDomeUpperPanels` | The same 18 panels as `TelecortexDomeUpper`, each its own panel fixture |

Placing each panel as its own fixture is what lets the Panel Transforms effect in [chromatik-plugins](https://github.com/moonbase-labs/chromatik-plugins) rotate one panel at a time during calibration.

## Install

Copy `fixtures/*.lxf` straight into `~/Chromatik/Fixtures/`, not into a subfolder, so the type names match what the projects expect. Then open any project in `projects/`.

## Dome conventions

- Units are millimetres, and z is up.
- Plan view: +x is east, +y is north. The door is the 5-way hub due south, opposite BU.
- The original 12 panels keep their TeleCortex OG names (BU, BRD, SLIU, ...). Panels added since are named by compass point: BSE is the big south-east panel, SEN the small panel at the east hub on its north side.

Chromatik's FREE licence only sends network output for models of 1,000 points or fewer. A single panel or `TelecortexThreePanels` fits; either dome needs a paid tier.

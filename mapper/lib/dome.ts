// The upper dome's panel slots and the two panel types, read from this repo's fixtures.
//
// Every panel of a size is built the same way, so which panel sits in which slot doesn't matter. What
// a mapping has to find is which Pi output feeds each slot, and for a large panel, which of its three
// ways round it was mounted. A small panel only fits one way.
import { join } from "node:path";
import {
  type M,
  type V,
  apply,
  cross,
  dot,
  length,
  mean,
  multiply,
  normalize,
  rotateAbout,
  scale,
  sub,
  transpose,
} from "./vec";

export type PanelSize = "large" | "small";
/** How many thirds of a turn a panel is from its reference placement, counterclockwise seen from outside. */
export type Rotation = 0 | 1 | 2;

export interface Panel {
  size: PanelSize;
  fixtureType: string;
  /** LED positions from the panel's .lxf, first pixel at the origin. */
  local: V[];
  /** The LED at each corner, counterclockwise seen from outside, starting at the first pixel. */
  corners: [number, number, number];
}

export interface Slot {
  id: string;
  size: PanelSize;
  og: boolean;
  /** Where each LED of a panel in this slot is at rotation 0, from TelecortexDomeUpper.lxf. */
  points: V[];
  /** Middle of the corner LEDs: the point a panel turns about. */
  centre: V;
  /** Unit normal pointing away from the dome's centre. */
  normal: V;
}

export interface Dome {
  panels: Record<PanelSize, Panel>;
  slots: Slot[];
}

/** The door's 5-way hub, due south of the apex. Only used to draw the door on the map. */
export const DOOR_HUB: V = [0, -2500, 1296];

const toV = (p: { x: number; y: number; z: number }): V => [p.x, p.y, p.z];
const indexOfMax = (points: V[], score: (p: V) => number) =>
  points.reduce((best, p, i) => (score(p) > score(points[best]) ? i : best), 0);

/** The three corner LEDs, counterclockwise seen from outside the dome, starting at the first pixel. */
function cornerLeds(points: V[]): [number, number, number] {
  const middle = mean(points);
  const a = indexOfMax(points, (p) => length(sub(p, middle)));
  const b = indexOfMax(points, (p) => length(sub(p, points[a])));
  const c = indexOfMax(points, (p) => length(cross(sub(points[b], points[a]), sub(p, points[a]))));
  const facingOut = dot(cross(sub(points[b], points[a]), sub(points[c], points[a])), mean([points[a], points[b], points[c]])) > 0;
  const ordered = facingOut ? [a, b, c] : [a, c, b];
  const start = ordered.indexOf(0);
  if (start < 0) throw new Error("the first pixel is not at a corner of the panel");
  return [ordered[start], ordered[(start + 1) % 3], ordered[(start + 2) % 3]];
}

export async function loadDome(root: string): Promise<Dome> {
  const read = (name: string) => Bun.file(join(root, "fixtures", `${name}.lxf`)).json();
  const upper = await read("TelecortexDomeUpper");
  const raw: { id: string; size: PanelSize; og: boolean; points: V[] }[] = upper.components.map((c: any) => ({
    id: c.id,
    size: c.tags.includes("large") ? "large" : "small",
    og: c.tags.includes("og"),
    points: c.coords.map(toV),
  }));

  const panels = {} as Record<PanelSize, Panel>;
  for (const [size, fixtureType] of [["large", "TelecortexPanelLarge"], ["small", "TelecortexPanelSmall"]] as const) {
    const fixture = await read(fixtureType);
    const reference = raw.find((s) => s.size === size)!;
    panels[size] = { size, fixtureType, local: fixture.components[0].coords.map(toV), corners: cornerLeds(reference.points) };
  }

  const slots = raw.map((s): Slot => {
    const corners = panels[s.size].corners.map((i) => s.points[i]);
    const centre = mean(corners);
    const normal = normalize(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])));
    return { ...s, centre, normal: dot(normal, centre) > 0 ? normal : scale(normal, -1) };
  });
  return { panels, slots };
}

export const slotById = (dome: Dome, id: string) => {
  const slot = dome.slots.find((s) => s.id === id);
  if (!slot) throw new Error(`no slot called ${id}`);
  return slot;
};

/** Where each LED of the panel in `slot` is when mounted at `rotation`. */
export function placement(slot: Slot, rotation: Rotation): V[] {
  return rotation === 0 ? slot.points : slot.points.map((p) => rotateAbout(p, slot.centre, slot.normal, rotation * 120));
}

/** The slot's corners at rotation 0, counterclockwise seen from outside, starting where the first pixel goes. */
export const cornerPositions = (dome: Dome, slot: Slot): V[] => dome.panels[slot.size].corners.map((i) => slot.points[i]);

// LX builds a fixture as translate(x, y, z) * Ry(yaw) * Rx(pitch) * Rz(roll), applied to the .lxf's points.
export function fromYawPitchRoll(yaw: number, pitch: number, roll: number): M {
  const r = Math.PI / 180;
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw * r), Math.sin(yaw * r), Math.cos(pitch * r), Math.sin(pitch * r), Math.cos(roll * r), Math.sin(roll * r)];
  return [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
}

export interface FixtureTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

/** The fixture position and angles that put `panel`'s LEDs at `target`. */
export function fixtureTransform(panel: Panel, target: V[]): FixtureTransform {
  // An orthonormal frame on three corners of each, then the rotation carrying one onto the other.
  const frame = (points: V[]): M => {
    const [i, j, k] = panel.corners;
    const e1 = normalize(sub(points[j], points[i]));
    const e3 = normalize(cross(e1, sub(points[k], points[i])));
    return transpose([e1, cross(e3, e1), e3]);
  };
  const m = multiply(frame(target), transpose(frame(panel.local)));
  const degrees = (radians: number) => Math.round(((radians * 180) / Math.PI) * 1e6) / 1e6 || 0;
  const mm = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return {
    // The first pixel is at the .lxf's origin, so the fixture's position is wherever it lands.
    x: mm(target[0][0]),
    y: mm(target[0][1]),
    z: mm(target[0][2]),
    yaw: degrees(Math.atan2(m[0][2], m[2][2])),
    pitch: degrees(Math.asin(Math.max(-1, Math.min(1, -m[1][2])))),
    roll: degrees(Math.atan2(m[1][0], m[1][1])),
  };
}

/** Where a fixture with these settings puts each of `panel`'s LEDs, as Chromatik computes it. */
export function applyTransform(panel: Panel, t: FixtureTransform): V[] {
  const m = fromYawPitchRoll(t.yaw, t.pitch, t.roll);
  return panel.local.map((p) => {
    const q = apply(m, p);
    return [q[0] + t.x, q[1] + t.y, q[2] + t.z];
  });
}

/**
 * Plan view looking down on the dome, north up, east right: compass direction from the apex, with
 * distance from the middle proportional to the angle down from the top, so the upper rows don't crowd.
 */
export function planPosition(p: V): [number, number] {
  const azimuth = Math.atan2(p[1], p[0]);
  const fromTop = Math.PI / 2 - Math.atan2(p[2], Math.hypot(p[0], p[1]));
  const r = fromTop / (Math.PI / 2);
  return [r * Math.cos(azimuth), r * Math.sin(azimuth)];
}

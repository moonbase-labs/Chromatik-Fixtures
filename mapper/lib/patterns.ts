// The frames the mapper sends: one to find which panel an output feeds, one to show its corners, and
// one across the whole dome to check the finished mapping.
import type { Panel } from "./dome";
import { type V, length, sub } from "./vec";

type RGB = [number, number, number];

/** The largest panel. A smaller panel just passes the extra colours off the end of its strip. */
export const MAX_LEDS = 316;
/** Red at the first pixel's corner, then green and blue going counterclockwise seen from outside. */
export const CORNER_COLOURS: RGB[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];

const FIND: RGB = [70, 60, 45];
const BODY: RGB = [10, 10, 10];
/** About three LED spacings, so each corner shows as a cluster of seven to ten LEDs, not one or two. */
const CORNER_RADIUS_MM = 200;

function frame(count: number, colour: (i: number) => RGB): Uint8Array {
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) out.set(colour(i), i * 3);
  return out;
}

export const BLACK = new Uint8Array(MAX_LEDS * 3);

/** Every LED a dim warm white, enough to spot the panel without anyone needing sunglasses. */
export const FIND_FRAME = frame(MAX_LEDS, () => FIND);

/**
 * One colour per Pi for lighting everything at once, about a quarter brightness: a dark panel says
 * which Pi it should have come from, and a panel in another Pi's colour is plugged into that Pi.
 */
export const PI_COLOURS: RGB[] = [[70, 0, 0], [0, 70, 0], [0, 0, 70], [60, 50, 0], [55, 0, 60], [0, 50, 60]];
export const piFrame = (index: number) => frame(MAX_LEDS, () => PI_COLOURS[index % PI_COLOURS.length]);

/** Each corner a cluster of red, green or blue, and the rest of the panel dim so its outline shows. */
export function orientFrame(panel: Panel): Uint8Array {
  const corners = panel.corners.map((i) => panel.local[i]);
  return frame(panel.local.length, (i) => {
    const corner = corners.findIndex((c) => length(sub(panel.local[i], c)) < CORNER_RADIUS_MM);
    return corner >= 0 ? CORNER_COLOURS[corner] : BODY;
  });
}

function hsv(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

/**
 * Hue follows compass direction and brightness rises towards the ground, so the whole dome reads as
 * one smooth wheel and a panel mapped to the wrong place or turned the wrong way stands out.
 */
export function verifyFrame(points: V[]): Uint8Array {
  return frame(points.length, (i) => {
    const [x, y, z] = points[i];
    const azimuth = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    const elevation = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    return hsv(azimuth, 1, 0.15 + 0.45 * (1 - elevation / 90));
  });
}

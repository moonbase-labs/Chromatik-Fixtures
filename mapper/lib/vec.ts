// Small 3D vector and 3x3 matrix helpers. A matrix is an array of its rows.
export type V = [number, number, number];
export type M = [V, V, V];

export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: V) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V): V => scale(a, 1 / length(a));
export const mean = (points: V[]): V => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);

export const transpose = (m: M): M => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];
export const apply = (m: M, v: V): V => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
export const multiply = (a: M, b: M): M => {
  const columns = transpose(b);
  return a.map((row) => columns.map((column) => dot(row, column))) as M;
};

/** Rotate `p` right-handedly about the line through `origin` along the unit vector `axis`. */
export function rotateAbout(p: V, origin: V, axis: V, degrees: number): V {
  const r = sub(p, origin);
  const t = (degrees * Math.PI) / 180;
  const turned = add(
    add(scale(r, Math.cos(t)), scale(cross(axis, r), Math.sin(t))),
    scale(axis, dot(axis, r) * (1 - Math.cos(t))),
  );
  return add(turned, origin);
}

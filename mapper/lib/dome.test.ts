import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Rotation, applyTransform, cornerPositions, fixtureTransform, loadDome, placement } from "./dome";
import { type V, length, sub } from "./vec";

const root = resolve(import.meta.dir, "../..");
const dome = await loadDome(root);
const maxGap = (a: V[], b: V[]) => Math.max(...a.map((p, i) => length(sub(p, b[i]))));

test("the upper dome has 5 large and 13 small slots", () => {
  expect(dome.slots.filter((s) => s.size === "large")).toHaveLength(5);
  expect(dome.slots.filter((s) => s.size === "small")).toHaveLength(13);
});

test("both panel types start their wiring at a corner", () => {
  expect(dome.panels.large.corners[0]).toBe(0);
  expect(dome.panels.small.corners[0]).toBe(0);
});

test("a small panel's first pixel is its apex, between the two equal edges", () => {
  const [apex, b, c] = cornerPositions(dome, dome.slots.find((s) => s.size === "small")!);
  expect(length(sub(apex, b))).toBeCloseTo(length(sub(apex, c)), 0);
  expect(length(sub(b, c))).toBeGreaterThan(length(sub(apex, b)) + 100);
});

test("each third of a turn carries a large panel's corners on to the next corner", () => {
  for (const slot of dome.slots.filter((s) => s.size === "large")) {
    const reference = cornerPositions(dome, slot);
    for (const rotation of [1, 2] as Rotation[]) {
      const turned = dome.panels.large.corners.map((i) => placement(slot, rotation)[i]);
      // The LED outline is not quite equilateral, so a turned corner lands near, not on, the next one.
      turned.forEach((corner, j) => expect(length(sub(corner, reference[(j + rotation) % 3]))).toBeLessThan(25));
    }
  }
});

test("fixture transforms put every LED where the placement says, for every slot and rotation", () => {
  for (const slot of dome.slots) {
    const panel = dome.panels[slot.size];
    for (const rotation of (slot.size === "large" ? [0, 1, 2] : [0]) as Rotation[]) {
      const target = placement(slot, rotation);
      expect(maxGap(applyTransform(panel, fixtureTransform(panel, target)), target)).toBeLessThan(0.05);
    }
  }
});

test("rotation 0 reproduces the hand-checked TelecortexDomeUpperPanels project", async () => {
  const project = await Bun.file(resolve(root, "projects/TelecortexDomeUpperPanels.lxp")).json();
  for (const fixture of project.model.fixtures) {
    const slot = dome.slots.find((s) => s.id === String(fixture.parameters.tags).split(",").at(-1))!;
    const panel = dome.panels[slot.size];
    expect(maxGap(applyTransform(panel, fixture.parameters), applyTransform(panel, fixtureTransform(panel, slot.points)))).toBeLessThan(0.05);
  }
});

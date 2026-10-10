import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyTransform, loadDome, placement, slotById } from "./dome";
import { type Mapping, newMapping } from "./mapping";
import { buildProject } from "./project";
import { Session } from "./session";
import { length, sub } from "./vec";

const root = resolve(import.meta.dir, "../..");
const dome = await loadDome(root);
const lit = (rgb: Uint8Array) => rgb.some((c) => c > 0);

async function setup() {
  const sent = new Map<string, Uint8Array>();
  const sender = {
    send: (host: string, channel: number, rgb: Uint8Array) => (sent.set(`${host}/${channel}`, rgb), true),
    resolve: async (host: string) => (host.startsWith("missing") ? null : "127.0.0.1"),
    problem: () => null,
  };
  const mapping = newMapping("Test", [
    { name: "pi-a", host: "pi-a.local", channels: 3 },
    { name: "pi-gone", host: "missing.local", channels: 2 },
  ]);
  const saves: Mapping[] = [];
  const session = new Session(dome, mapping, async (m) => void saves.push(structuredClone(m)), sender, root);
  await session.resolvePis();
  return { session, mapping, sent, saves };
}

test("mapping a large panel records the turn from where red showed", async () => {
  const { session, sent, saves } = await setup();
  await session.act({ type: "start" });
  expect(session.cursor).toBe("pi-a:0");

  session.tick();
  expect(lit(sent.get("pi-a.local/0")!)).toBe(true);
  expect(lit(sent.get("pi-a.local/1")!)).toBe(false);

  await session.act({ type: "slot", slot: "bse" });
  expect(session.phase).toBe("orient");
  await session.act({ type: "corner", corner: 2 });
  expect(session.phase).toBe("confirm");
  await session.act({ type: "confirm", ok: true });

  expect(saves.at(-1)!.outputs["pi-a:0"]).toEqual({ slot: "bse", rotation: 2, check: "ok" });
  expect(session.cursor).toBe("pi-a:1");
  expect(session.phase).toBe("find");
});

test("a small panel showing red anywhere but its apex is saved unturned and flagged", async () => {
  const { session, mapping } = await setup();
  await session.act({ type: "start" });
  await session.act({ type: "slot", slot: "sliu" });
  await session.act({ type: "corner", corner: 1 });
  await session.act({ type: "confirm", ok: true });
  expect(mapping.outputs["pi-a:0"]).toEqual({ slot: "sliu", rotation: 0, check: "mismatch" });
});

test("mapping a slot that another output had moves it", async () => {
  const { session, mapping } = await setup();
  await session.act({ type: "start" });
  await session.act({ type: "slot", slot: "bu" });
  await session.act({ type: "corner", corner: 0 });
  await session.act({ type: "confirm", ok: true });

  await session.act({ type: "slot", slot: "bu" });
  expect(session.message).toContain("pi-a output 0");
  await session.act({ type: "corner", corner: 0 });
  await session.act({ type: "confirm", ok: true });

  expect(mapping.outputs["pi-a:0"]).toBeUndefined();
  expect(mapping.outputs["pi-a:1"]).toEqual({ slot: "bu", rotation: 0, check: "ok" });
});

test("an output with nothing on it is recorded and skipped", async () => {
  const { session, mapping } = await setup();
  await session.act({ type: "start" });
  await session.act({ type: "empty" });
  expect(mapping.outputs["pi-a:0"]).toBe("empty");
  expect(session.cursor).toBe("pi-a:1");
});

test("skipping moves on without recording anything", async () => {
  const { session, mapping } = await setup();
  await session.act({ type: "start" });
  await session.act({ type: "skip" });
  expect(mapping.outputs).toEqual({});
  expect(session.cursor).toBe("pi-a:1");
});

test("outputs on a Pi that can't be found are passed over", async () => {
  const { session } = await setup();
  await session.act({ type: "start" });
  for (let i = 0; i < 3; i++) await session.act({ type: "empty" });
  // pi-a is done, and pi-gone does not resolve, so there is nothing left that could light.
  expect(session.phase).toBe("idle");
  expect(session.cursor).toBeNull();
});

test("lighting everything lights every output, each Pi in its own colour", async () => {
  const { session, sent } = await setup();
  await session.act({ type: "all" });
  session.tick();
  const a = sent.get("pi-a.local/0")!;
  expect(lit(a)).toBe(true);
  expect(lit(sent.get("pi-a.local/2")!)).toBe(true);
  expect([...sent.get("pi-a.local/1")!.subarray(0, 3)]).toEqual([...a.subarray(0, 3)]);
  expect([...sent.get("missing.local/0")!.subarray(0, 3)]).not.toEqual([...a.subarray(0, 3)]);
});

test("going idle sends black a few times, then nothing, so Chromatik is left alone", async () => {
  const { session, sent } = await setup();
  await session.act({ type: "start" });
  await session.act({ type: "stop" });
  for (let i = 0; i < 3; i++) {
    sent.clear();
    session.tick();
    expect(lit(sent.get("pi-a.local/0")!)).toBe(false);
  }
  sent.clear();
  session.tick();
  expect(sent.size).toBe(0);
});

test("the built project points each mapped panel at its output, turned as mounted", async () => {
  const { session, mapping } = await setup();
  await session.act({ type: "start" });
  await session.act({ type: "slot", slot: "bse" });
  await session.act({ type: "corner", corner: 1 });
  await session.act({ type: "confirm", ok: true });
  await session.act({ type: "empty" });

  const out = await mkdtemp(join(tmpdir(), "mapper-"));
  const built = await buildProject(root, dome, mapping, out);
  expect(built.mapped).toEqual(["bse"]);
  expect(built.unmapped).toHaveLength(17);

  const project = await Bun.file(built.path).json();
  const fixture = project.model.fixtures.find((f: any) => f.parameters.tags.endsWith(",bse"));
  expect(fixture.jsonParameters).toMatchObject({ host: "pi-a.local", port: 42069, opcChannel: 0 });
  const slot = slotById(dome, "bse");
  const placed = applyTransform(dome.panels.large, fixture.parameters);
  expect(Math.max(...placed.map((p, i) => length(sub(p, placement(slot, 1)[i]))))).toBeLessThan(0.05);

  const other = project.model.fixtures.find((f: any) => f.parameters.tags.endsWith(",bu"));
  expect(other.parameters.tags).toBe("telecortex,og,large,unmapped,bu");
  expect(other.jsonParameters.host).toBe("127.0.0.1");
});

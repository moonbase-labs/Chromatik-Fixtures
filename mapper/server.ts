#!/usr/bin/env bun
// Panel mapper: lights each Pi output in turn while someone under the dome taps, on a phone, where it
// lit. The result is saved to mappings/<Site>.json and turned into a Chromatik project.
//
//   bun mapper/server.ts --site BlazingSwan2026
//
// Turn Chromatik's output off first: both send to the same Pis.
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import index from "./index.html";
import { loadDome } from "./lib/dome";
import { loadMapping, saveMapping } from "./lib/mapping";
import { OpcSender } from "./lib/opc";
import { type Action, Session } from "./lib/session";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    site: { type: "string", default: "Site" },
    port: { type: "string", default: "4269" },
    mapping: { type: "string" },
  },
});

// The site name ends up in a project file name, TelecortexDomeUpper<Site>.lxp.
const site = values.site!.replace(/[^A-Za-z0-9]/g, "");
const root = resolve(import.meta.dir, "..");
const mappingPath = values.mapping ? resolve(values.mapping) : join(root, "mappings", `${site}.json`);

const dome = await loadDome(root);
const mapping = await loadMapping(mappingPath, site);
const sender = await OpcSender.create();
const session = new Session(dome, mapping, (m) => saveMapping(mappingPath, m), sender, root);
await session.resolvePis();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(values.port),
  routes: {
    "/": index,
    "/api/dome": { GET: () => Response.json(session.domeView()) },
    "/api/state": { GET: () => Response.json(session.state()) },
    "/api/action": { POST: async (req) => Response.json(await session.act((await req.json()) as Action)) },
  },
  development: { hmr: true, console: true },
});

// On site, a bug in one tick must not end the session: log it and carry on.
setInterval(() => {
  try {
    session.tick();
  } catch (error) {
    console.error(error);
  }
}, 250);
setInterval(() => session.resolvePis(), 15_000);

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => `http://${a!.address}:${server.port}`);
console.log(`Mapping ${mappingPath}`);
for (const pi of session.state().pis) console.log(`  ${pi.name.padEnd(16)} ${pi.host.padEnd(24)} ${pi.address ?? "NOT FOUND"}`);
console.log(`Open on a phone on the same network:\n  ${addresses.join("\n  ") || `http://localhost:${server.port}`}`);

// Leave the dome dark on the way out rather than frozen on whatever the mapper last showed.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await session.act({ type: "stop" });
    for (let i = 0; i < 3; i++) session.tick();
    process.exit(0);
  });
}

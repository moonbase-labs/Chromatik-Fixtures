// Turn a mapping into a Chromatik project: TelecortexDomeUpperPanels.lxp with every panel pointed at
// the output that feeds it and turned the way it was mounted.
import { join } from "node:path";
import { type Dome, fixtureTransform, placement, slotById } from "./dome";
import { type Assignment, type Mapping, listOutputs } from "./mapping";
import { splitHost } from "./opc";

export interface BuiltProject {
  path: string;
  mapped: string[];
  unmapped: string[];
}

export async function buildProject(root: string, dome: Dome, mapping: Mapping, outDir = join(root, "projects")): Promise<BuiltProject> {
  const project = await Bun.file(join(root, "projects", "TelecortexDomeUpperPanels.lxp")).json();
  project.timestamp = Date.now();

  const bySlot = new Map<string, { host: string; channel: number; assignment: Assignment }>();
  for (const output of listOutputs(mapping)) {
    const state = mapping.outputs[output.key];
    if (state && state !== "empty") bySlot.set(state.slot, { host: output.host, channel: output.channel, assignment: state });
  }

  const mapped: string[] = [];
  const unmapped: string[] = [];
  for (const fixture of project.model.fixtures) {
    // Tags read "telecortex,og,large,bu": the slot id is always last, which Panel Transforms relies on too.
    const tags = String(fixture.parameters.tags).split(",").filter((t) => t !== "unmapped" && t !== "check");
    const id = tags.pop()!;
    const slot = slotById(dome, id);
    const found = bySlot.get(id);
    const panel = dome.panels[slot.size];
    const transform = fixtureTransform(panel, placement(slot, found?.assignment.rotation ?? 0));

    Object.assign(fixture.parameters, transform);
    if (found) {
      const { name, port } = splitHost(found.host);
      fixture.jsonParameters = { ...fixture.jsonParameters, host: name, port, opcChannel: found.channel };
      if (found.assignment.check === "mismatch") tags.push("check");
      mapped.push(id);
    } else {
      // Kept in the model so the preview shows the whole dome, but sent nowhere useful.
      fixture.jsonParameters = { ...fixture.jsonParameters, host: "127.0.0.1", opcChannel: 0 };
      tags.push("unmapped");
      unmapped.push(id);
    }
    fixture.parameters.tags = [...tags, id].join(",");
  }

  const path = join(outDir, `TelecortexDomeUpper${mapping.site}.lxp`);
  await Bun.write(path, JSON.stringify(project, null, 2) + "\n");
  return { path, mapped, unmapped };
}

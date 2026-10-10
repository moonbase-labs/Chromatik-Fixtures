// What the mapper is doing right now, and the actions the phone sends.
//
// One output is looked at at a time. It goes find -> orient -> confirm: light the whole panel and tap
// where it is, light its corners and tap the red one, then check green and blue landed where predicted.
import { type Dome, DOOR_HUB, type PanelSize, type Rotation, cornerPositions, placement, planPosition, slotById } from "./dome";
import { type Mapping, type Output, assign, listOutputs, outputForSlot } from "./mapping";
import { BLACK, FIND_FRAME, PI_COLOURS, orientFrame, piFrame, verifyFrame } from "./patterns";
import { buildProject } from "./project";

export type Phase = "idle" | "find" | "orient" | "confirm" | "verify" | "all";

export type Action =
  | { type: "start" }
  | { type: "select"; output: string }
  | { type: "slot"; slot: string }
  | { type: "corner"; corner: number }
  | { type: "confirm"; ok: boolean }
  | { type: "empty" }
  | { type: "skip" }
  | { type: "back" }
  | { type: "clear"; output: string }
  | { type: "verify" }
  | { type: "all" }
  | { type: "stop" }
  | { type: "generate" };

export interface Sender {
  send(host: string, channel: number, rgb: Uint8Array): boolean;
  resolve(host: string): Promise<string | null>;
  problem(host: string): string | null;
}

const describe = (key: string) => key.replace(":", " output ");

export class Session {
  phase: Phase = "idle";
  cursor: string | null = null;
  pending: { slot: string; red?: number } | null = null;
  message = "";
  private addresses: Record<string, string | null> = {};
  private readonly orientFrames: Record<PanelSize, Uint8Array>;
  private verifyFrames = new Map<string, Uint8Array>();
  /** Each Pi's colour for lighting everything, by Pi name. */
  private readonly piFrames: Map<string, Uint8Array>;
  /** Black frames still to send after going idle. Idle sends nothing else, so it never fights Chromatik. */
  private blackouts = 0;

  constructor(
    readonly dome: Dome,
    readonly mapping: Mapping,
    private readonly save: (mapping: Mapping) => Promise<void>,
    private readonly sender: Sender,
    private readonly root: string,
  ) {
    this.orientFrames = { large: orientFrame(dome.panels.large), small: orientFrame(dome.panels.small) };
    this.piFrames = new Map(mapping.pis.map((pi, i) => [pi.name, piFrame(i)]));
  }

  async resolvePis() {
    const found = await Promise.all(this.mapping.pis.map((pi) => this.sender.resolve(pi.host)));
    this.mapping.pis.forEach((pi, i) => (this.addresses[pi.host] = found[i]));
  }

  /** Send every output its frame. UDP can drop a packet, so this runs a few times a second. */
  tick() {
    if (this.phase === "idle" && this.blackouts === 0) return;
    for (const output of listOutputs(this.mapping)) this.sender.send(output.host, output.channel, this.frameFor(output));
    if (this.phase === "idle") this.blackouts--;
  }

  private frameFor({ key, pi }: Output): Uint8Array {
    if (this.phase === "all") return this.piFrames.get(pi) ?? BLACK;
    if (this.phase === "verify") return this.verifyFrames.get(key) ?? BLACK;
    if (key !== this.cursor) return BLACK;
    if (this.phase === "find") return FIND_FRAME;
    if (this.pending && (this.phase === "orient" || this.phase === "confirm")) {
      return this.orientFrames[slotById(this.dome, this.pending.slot).size];
    }
    return BLACK;
  }

  async act(action: Action) {
    this.message = "";
    switch (action.type) {
      case "start":
        this.lookAt(this.nextOutput(null));
        break;
      case "select":
        this.lookAt(action.output);
        break;
      case "slot": {
        if (this.phase !== "find" || !this.cursor) break;
        const holder = outputForSlot(this.mapping, action.slot);
        if (holder && holder !== this.cursor) {
          this.message = `${action.slot.toUpperCase()} is mapped to ${describe(holder)}. Saving moves it here.`;
        }
        this.pending = { slot: action.slot };
        this.phase = "orient";
        break;
      }
      case "corner":
        if (this.phase !== "orient" || !this.pending) break;
        this.pending.red = action.corner;
        this.phase = "confirm";
        break;
      case "confirm": {
        if (this.phase !== "confirm" || !this.cursor || this.pending?.red === undefined) break;
        const slot = slotById(this.dome, this.pending.slot);
        // A small panel only fits one way round, so red anywhere but the first-pixel corner means
        // the panel was built or wired differently from the rest.
        const fits = slot.size === "large" || this.pending.red === 0;
        const rotation = (slot.size === "large" ? this.pending.red : 0) as Rotation;
        const check = action.ok && fits ? "ok" : "mismatch";
        const moved = assign(this.mapping, this.cursor, { slot: slot.id, rotation, check });
        await this.save(this.mapping);
        const done = `${slot.id.toUpperCase()} saved on ${describe(this.cursor)}.`;
        const flagged = check === "mismatch" ? " Flagged to check: its corners were not where expected." : "";
        const cleared = moved ? ` ${describe(moved)} no longer has a panel.` : "";
        this.lookAt(this.nextOutput(this.cursor));
        this.message = done + flagged + cleared;
        break;
      }
      case "empty":
        if (this.phase !== "find" || !this.cursor) break;
        assign(this.mapping, this.cursor, "empty");
        await this.save(this.mapping);
        this.lookAt(this.nextOutput(this.cursor));
        break;
      case "skip":
        if (this.phase !== "find" || !this.cursor) break;
        this.lookAt(this.nextOutput(this.cursor, this.cursor));
        break;
      case "back":
        if (this.phase === "confirm" && this.pending) {
          delete this.pending.red;
          this.phase = "orient";
        } else if (this.phase === "orient") {
          this.pending = null;
          this.phase = "find";
        } else {
          this.lookAt(null);
        }
        break;
      case "clear":
        delete this.mapping.outputs[action.output];
        await this.save(this.mapping);
        break;
      case "verify":
        this.verifyFrames = new Map();
        for (const [key, state] of Object.entries(this.mapping.outputs)) {
          if (state !== "empty") this.verifyFrames.set(key, verifyFrame(placement(slotById(this.dome, state.slot), state.rotation)));
        }
        this.cursor = null;
        this.pending = null;
        this.phase = "verify";
        break;
      case "all":
        this.cursor = null;
        this.pending = null;
        this.phase = "all";
        break;
      case "stop":
        this.lookAt(null);
        break;
      case "generate": {
        const built = await buildProject(this.root, this.dome, this.mapping);
        const missing = built.unmapped.length ? ` Not mapped yet: ${built.unmapped.map((s) => s.toUpperCase()).join(", ")}.` : "";
        const count = `${built.mapped.length} panel${built.mapped.length === 1 ? "" : "s"}`;
        this.message = `Wrote ${built.path.split("/").slice(-2).join("/")} with ${count} mapped.${missing}`;
        break;
      }
    }
    return this.state();
  }

  private lookAt(key: string | null) {
    this.pending = null;
    this.cursor = key;
    this.phase = key ? "find" : "idle";
    if (!key) this.blackouts = 3;
  }

  /**
   * The next output after `from` with nothing recorded yet, wrapping round. Outputs on a Pi that
   * doesn't resolve are passed over, since nothing could light; so is `except`, the one just skipped.
   */
  private nextOutput(from: string | null, except?: string): string | null {
    const outputs = listOutputs(this.mapping);
    const start = from ? outputs.findIndex((o) => o.key === from) + 1 : 0;
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[(start + i) % outputs.length];
      if (output.key !== except && !(output.key in this.mapping.outputs) && this.addresses[output.host]) return output.key;
    }
    return null;
  }

  state() {
    const slots = new Set(Object.values(this.mapping.outputs).flatMap((s) => (s === "empty" ? [] : [s.slot])));
    return {
      site: this.mapping.site,
      phase: this.phase,
      cursor: this.cursor,
      pending: this.pending,
      message: this.message,
      pis: this.mapping.pis.map((pi, i) => ({
        ...pi,
        address: this.addresses[pi.host] ?? null,
        problem: this.sender.problem(pi.host),
        // The LEDs run at a quarter brightness; the swatch on the phone is the same hue at full.
        colour: `rgb(${PI_COLOURS[i % PI_COLOURS.length].map((c, _, all) => Math.round((c * 255) / Math.max(...all))).join(" ")})`,
      })),
      outputs: listOutputs(this.mapping).map((o) => ({ ...o, state: this.mapping.outputs[o.key] ?? null })),
      mappedSlots: slots.size,
      slotCount: this.dome.slots.length,
    };
  }

  /** What the phone draws: each slot's corners in plan view, counterclockwise from the first pixel's corner. */
  domeView() {
    return {
      slots: this.dome.slots.map((s) => ({
        id: s.id,
        size: s.size,
        corners: cornerPositions(this.dome, s).map(planPosition),
        centre: planPosition(s.centre),
      })),
      door: planPosition(DOOR_HUB),
    };
  }
}

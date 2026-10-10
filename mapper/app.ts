// Phone UI for the panel mapper. The server owns all the state; this draws it and posts taps back.
type XY = [number, number];
type Assignment = { slot: string; rotation: number; check: "ok" | "mismatch" };

interface DomeView {
  slots: { id: string; size: "large" | "small"; corners: XY[]; centre: XY }[];
  door: XY;
}

interface State {
  site: string;
  phase: "idle" | "find" | "orient" | "confirm" | "verify" | "all";
  cursor: string | null;
  pending: { slot: string; red?: number } | null;
  message: string;
  pis: { name: string; host: string; channels: number; address: string | null; problem: string | null; colour: string }[];
  outputs: { key: string; pi: string; host: string; channel: number; state: Assignment | "empty" | null }[];
  mappedSlots: number;
  slotCount: number;
}

/** Red, green, blue: the order the corners light, counterclockwise from the first pixel. */
const CORNER_COLOURS = ["#ff3b30", "#34c759", "#0a84ff"];

const app = document.querySelector<HTMLElement>("#app")!;
let dome: DomeView;
let state: State;
let shown = "";
let fromInside = remember("fromInside", true);

function remember(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function store(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

async function post(action: object) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  state = await response.json();
  render();
}

async function refresh() {
  state = await (await fetch("/api/state")).json();
  render();
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const describe = (key: string) => key.replace(":", " · output ");
const initials = (pi: string) => pi.split("-").map((word) => word[0].toUpperCase()).join("");
const ownerOf = (slot: string) =>
  state.outputs.find((o) => o.state && o.state !== "empty" && o.state.slot === slot);

// Plan coordinates have north up. Seen from inside, looking up, east and west swap.
const toSvg = ([x, y]: XY): XY => [fromInside ? -x : x, -y];
const polygon = (corners: XY[]) => corners.map((c) => toSvg(c).join(",")).join(" ");

function map(): string {
  const { phase, pending } = state;
  const slots = dome.slots
    .map((slot) => {
      const owner = ownerOf(slot.id);
      const status = owner ? ((owner.state as Assignment).check === "mismatch" ? "flagged" : "mapped") : "";
      const classes = ["slot", status, pending?.slot === slot.id ? "current" : ""].join(" ");
      const tap = phase === "find" ? `data-action="slot" data-slot="${slot.id}"` : "";
      const [x, y] = toSvg(slot.centre);
      const ownerText = owner ? `<text class="owner" x="${x}" y="${y + 0.06}">${initials(owner.pi)}${owner.channel}</text>` : "";
      return `<g class="${classes}" ${tap}><polygon points="${polygon(slot.corners)}" /><text x="${x}" y="${y}">${slot.id.toUpperCase()}</text>${ownerText}</g>`;
    })
    .join("");

  let corners = "";
  if (pending && (phase === "orient" || phase === "confirm")) {
    const slot = dome.slots.find((s) => s.id === pending.slot)!;
    corners = slot.corners
      .map((corner, i) => {
        // Pulled a little towards the middle so the marker sits on the panel it belongs to.
        const [x, y] = toSvg([corner[0] * 0.8 + slot.centre[0] * 0.2, corner[1] * 0.8 + slot.centre[1] * 0.2]);
        if (phase === "orient") return `<circle class="corner" data-action="corner" data-corner="${i}" cx="${x}" cy="${y}" r="0.09" />`;
        const colour = CORNER_COLOURS[(i - pending.red! + 3) % 3];
        return `<circle class="corner" cx="${x}" cy="${y}" r="0.06" fill="${colour}" />`;
      })
      .join("");
  }

  const [doorX, doorY] = toSvg(dome.door);
  return `<svg class="map" viewBox="-0.95 -0.95 1.9 1.9" role="img" aria-label="Dome plan">${slots}${corners}<text class="door" x="${doorX}" y="${doorY + 0.12}">DOOR</text></svg>`;
}

const button = (action: string, text: string, extra = "", classes = "") =>
  `<button class="${classes}" data-action="${action}" ${extra}>${text}</button>`;
const card = (title: string, body: string, actions: string) =>
  `<section class="card"><h2>${title}</h2><p>${body}</p><div class="actions">${actions}</div></section>`;

function prompt(): string {
  const { phase, cursor, pending } = state;
  const name = pending ? pending.slot.toUpperCase() : "";
  switch (phase) {
    case "find": {
      const pi = state.pis.find((p) => p.name === state.outputs.find((o) => o.key === cursor)?.pi);
      const trouble = !pi?.address ? "can't be found" : pi.problem ? `isn't answering (${pi.problem})` : "";
      const body = trouble
        ? `<span class="red">${escape(pi?.name ?? "This Pi")} ${escape(trouble)}</span>, so this output may not light even with a panel on it. Skip it rather than marking it as nothing lit.`
        : "Tap the panel that's lit.";
      return card(
        `Lit: ${escape(describe(cursor!))}`,
        body,
        button("empty", "Nothing lit", "", trouble ? "quiet" : "") + button("skip", "Skip for now", "", "quiet") + button("stop", "Stop", "", "quiet"),
      );
    }
    case "orient":
      return card(`Panel ${name}`, `Tap the corner that's <span class="red">red</span>.`, button("back", "Back", "", "quiet"));
    case "confirm":
      return card(
        `Panel ${name}`,
        "Are green and blue where the map shows them?",
        button("confirm", "Yes, save", `data-ok="true"`) + button("confirm", "No, save and flag it", `data-ok="false"`, "quiet") + button("back", "Back", "", "quiet"),
      );
    case "all":
      return card(
        "Every output lit",
        "Each Pi's panels show its colour in the list below. A dark panel isn't getting through from its Pi. A panel in another Pi's colour is plugged into that Pi.",
        button("stop", "Stop"),
      );
    case "verify":
      return card(
        "Checking the whole dome",
        "Colour should sweep smoothly round the compass, brighter lower down. A panel that breaks the pattern is in the wrong place or turned wrong: redo it from the list below.",
        button("stop", "Stop"),
      );
    default: {
      const unchecked = state.outputs.filter((o) => o.state === null).length;
      return card(
        `${state.mappedSlots} of ${state.slotCount} panels mapped`,
        unchecked ? `${unchecked} outputs not checked yet.` : "Every output has been checked.",
        (unchecked ? button("start", "Start mapping") : "") +
          button("all", "Light everything", "", "quiet") +
          button("verify", "Check whole dome", "", unchecked ? "quiet" : "") +
          button("generate", "Build project", "", "quiet"),
      );
    }
  }
}

function outputs(): string {
  return state.pis
    .map((pi) => {
      const rows = state.outputs
        .filter((o) => o.pi === pi.name)
        .map((o) => {
          const s = o.state;
          const text = s === null ? "not checked" : s === "empty" ? "nothing on it" : `${s.slot.toUpperCase()}${s.rotation ? `, turned ${s.rotation}/3` : ""}${s.check === "mismatch" ? " · check this panel" : ""}`;
          const flag = s && s !== "empty" && s.check === "mismatch" ? "flag" : "";
          const clear = s ? button("clear", "Clear", `data-output="${o.key}"`, "quiet small") : "";
          return `<li class="${o.key === state.cursor ? "current" : ""}"><button class="row" data-action="select" data-output="${o.key}">Output ${o.channel}</button><span class="${flag}">${escape(text)}</span>${clear}</li>`;
        })
        .join("");
      const where = !pi.address
        ? `<small class="missing">not found at ${escape(pi.host)}</small>`
        : pi.problem
          ? `<small class="missing">${escape(pi.address)} isn't answering (${escape(pi.problem)})</small>`
          : `<small class="found">${escape(pi.address)}</small>`;
      const swatch = `<span class="swatch" style="background: ${pi.colour}"></span>`;
      return `<section class="pi"><h3>${swatch}${escape(pi.name)} ${where}</h3><ul>${rows}</ul></section>`;
    })
    .join("");
}

// Every Pi refusing at once is the laptop, not the Pis: macOS blocks local network access per app
// until it is allowed in System Settings, and reports it as EHOSTUNREACH.
function blockedBanner(): string {
  const found = state.pis.filter((p) => p.address);
  const blocked = found.length > 0 && found.every((p) => p.problem === "EHOSTUNREACH");
  return blocked
    ? `<p class="message">No Pi is reachable from this laptop. On a Mac that usually means the terminal running the mapper isn't allowed on the local network: System Settings → Privacy &amp; Security → Local Network, turn it on, then restart the terminal and the mapper.</p>`
    : "";
}

function render() {
  const next = JSON.stringify([state, fromInside]);
  if (next === shown) return;
  shown = next;
  app.innerHTML = `
    <header>
      <h1>${escape(state.site)}</h1>
      <button class="quiet small" data-action="view">${fromInside ? "Seen from inside" : "Seen from above"}</button>
    </header>
    ${blockedBanner()}
    ${map()}
    ${state.message ? `<p class="message">${escape(state.message)}</p>` : ""}
    ${prompt()}
    <h2>Outputs</h2>
    ${outputs()}
    <p class="note">Turn Chromatik's output off while mapping: both send to the same Pis.</p>`;
}

app.addEventListener("click", (event) => {
  const target = (event.target as Element).closest("[data-action]") as HTMLElement | null;
  if (!target) return;
  const { action, slot, corner, output, ok } = target.dataset;
  switch (action) {
    case "view":
      fromInside = !fromInside;
      store("fromInside", fromInside);
      render();
      return;
    case "slot":
      return void post({ type: "slot", slot });
    case "corner":
      return void post({ type: "corner", corner: Number(corner) });
    case "confirm":
      return void post({ type: "confirm", ok: ok === "true" });
    case "select":
    case "clear":
      return void post({ type: action, output });
    default:
      return void post({ type: action });
  }
});

dome = await (await fetch("/api/dome")).json();
await refresh();
setInterval(refresh, 2000);

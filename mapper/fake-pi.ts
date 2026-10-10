#!/usr/bin/env bun
// Stand-in Pis for trying the mapper without hardware. Listens for OPC on local UDP ports and prints
// what each output shows whenever that changes.
//
//   bun mapper/fake-pi.ts 42070 42071
//
// Then list them in the mapping file's "pis" with hosts 127.0.0.1:42070 and 127.0.0.1:42071.
const ports = Bun.argv.slice(2).map(Number);
if (!ports.length || ports.some((p) => !Number.isInteger(p))) {
  console.error("usage: bun mapper/fake-pi.ts <port> [port...]");
  process.exit(1);
}

const shown = new Map<string, string>();
const hex = (r: number, g: number, b: number) => [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

for (const port of ports) {
  await Bun.udpSocket({
    hostname: "127.0.0.1",
    port,
    socket: {
      data(_socket, packet) {
        const channel = packet[0];
        const rgb = packet.subarray(4, 4 + ((packet[2] << 8) | packet[3]));
        const colours = new Map<string, number>();
        for (let i = 0; i + 2 < rgb.length; i += 3) {
          if (rgb[i] || rgb[i + 1] || rgb[i + 2]) {
            const colour = hex(rgb[i], rgb[i + 1], rgb[i + 2]);
            colours.set(colour, (colours.get(colour) ?? 0) + 1);
          }
        }
        const lit = [...colours.values()].reduce((a, b) => a + b, 0);
        const top = [...colours].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${n}x#${c}`);
        const summary = lit ? `${lit} lit: ${top.join(" ")}${colours.size > 4 ? ` +${colours.size - 4} more colours` : ""}` : "dark";
        const key = `${port}:${channel}`;
        if (shown.get(key) !== summary) {
          shown.set(key, summary);
          console.log(`${key.padEnd(8)} ${summary}`);
        }
      },
    },
  });
  console.log(`listening on 127.0.0.1:${port}`);
}

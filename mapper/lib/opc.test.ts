import { expect, test } from "bun:test";
import { OpcSender, opcPacket, splitHost } from "./opc";

test("an OPC packet is channel, command 0, big-endian length, then colours", () => {
  const rgb = new Uint8Array(316 * 3).fill(7);
  const packet = opcPacket(2, rgb);
  expect([...packet.subarray(0, 4)]).toEqual([2, 0, 948 >> 8, 948 & 0xff]);
  expect(packet.length).toBe(4 + 948);
  expect(packet[4]).toBe(7);
});

test("hosts take an optional port, defaulting to OPC's 42069", () => {
  expect(splitHost("lingering-brook.local")).toEqual({ name: "lingering-brook.local", port: 42069 });
  expect(splitHost("127.0.0.1:42070")).toEqual({ name: "127.0.0.1", port: 42070 });
});

test("a frame reaches a UDP listener once its host resolves", async () => {
  const received: Uint8Array[] = [];
  const listener = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: { data: (_socket, packet) => void received.push(new Uint8Array(packet)) },
  });
  const sender = await OpcSender.create();
  const host = `127.0.0.1:${listener.port}`;

  expect(sender.send(host, 1, new Uint8Array([1, 2, 3]))).toBe(false);
  expect(await sender.resolve(host)).toBe("127.0.0.1");
  expect(sender.send(host, 1, new Uint8Array([1, 2, 3]))).toBe(true);

  for (let i = 0; i < 50 && !received.length; i++) await Bun.sleep(10);
  expect([...received[0]]).toEqual([1, 0, 0, 3, 1, 2, 3]);
  sender.close();
  listener.close();
});

test("a refused send is reported, not thrown, and clears once a send gets through", async () => {
  let refuse = true;
  const socket = {
    send: () => {
      if (refuse) throw Object.assign(new Error("send"), { code: "EHOSTUNREACH" });
      return true;
    },
    close: () => {},
  };
  const sender = await OpcSender.create(socket as any);
  await sender.resolve("127.0.0.1");

  expect(sender.send("127.0.0.1", 0, new Uint8Array(3))).toBe(false);
  expect(sender.problem("127.0.0.1")).toBe("EHOSTUNREACH");
  refuse = false;
  expect(sender.send("127.0.0.1", 0, new Uint8Array(3))).toBe(true);
  expect(sender.problem("127.0.0.1")).toBeNull();
});

test("a name that does not resolve is reported, not thrown", async () => {
  const sender = await OpcSender.create();
  expect(await sender.resolve("no-such-pi.invalid")).toBeNull();
  sender.close();
});

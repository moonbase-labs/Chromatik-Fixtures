// Open Pixel Control over UDP, as JS-Telecortex-2-Server on each Pi expects it. Each output is an OPC
// channel (0 to 3) and is a real output, not a broadcast, and every packet is handled on its own.
export const OPC_PORT = 42069;

/** One OPC message: channel, command 0 (set 8-bit RGB pixels), big-endian length, then the colours. */
export function opcPacket(channel: number, rgb: Uint8Array): Uint8Array {
  const packet = new Uint8Array(4 + rgb.length);
  packet[0] = channel;
  packet[1] = 0;
  packet[2] = rgb.length >> 8;
  packet[3] = rgb.length & 0xff;
  packet.set(rgb, 4);
  return packet;
}

/** "name" or "name:port"; the port defaults to 42069. */
export function splitHost(host: string): { name: string; port: number } {
  const match = /^(.*):(\d+)$/.exec(host);
  return match ? { name: match[1], port: Number(match[2]) } : { name: host, port: OPC_PORT };
}

type Socket = Pick<Awaited<ReturnType<typeof Bun.udpSocket>>, "send" | "close">;

export class OpcSender {
  private readonly addresses = new Map<string, string>();
  private readonly problems = new Map<string, string>();

  private constructor(private readonly socket: Socket) {}

  static async create(socket?: Socket) {
    return new OpcSender(socket ?? (await Bun.udpSocket({})));
  }

  /** Look the host up again, `.local` names over mDNS. Resolves to its IPv4 address, or null if it isn't found. */
  async resolve(host: string): Promise<string | null> {
    try {
      const [found] = await Bun.dns.lookup(splitHost(host).name, { family: 4 });
      if (found) {
        this.addresses.set(host, found.address);
        return found.address;
      }
    } catch {}
    this.addresses.delete(host);
    return null;
  }

  /** Sends nothing until `resolve` has found the host. Never throws: a failure is kept for `problem`. */
  send(host: string, channel: number, rgb: Uint8Array): boolean {
    const address = this.addresses.get(host);
    if (!address) return false;
    try {
      const sent = this.socket.send(opcPacket(channel, rgb), splitHost(host).port, address);
      this.problems.delete(host);
      return sent;
    } catch (error) {
      // macOS refuses a send outright, EHOSTUNREACH, while a Pi on the local network isn't answering.
      // A Pi's Wi-Fi can doze for a moment, so this is often gone by the next send.
      this.problems.set(host, (error as { code?: string }).code ?? String(error));
      return false;
    }
  }

  /** Why the last send to `host` failed, or null if it went. */
  problem(host: string): string | null {
    return this.problems.get(host) ?? null;
  }

  close() {
    this.socket.close();
  }
}

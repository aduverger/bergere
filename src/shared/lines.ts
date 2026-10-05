import type { Socket } from "node:net";
export const MAX_FRAME_BYTES = 32 * 1024 * 1024;
export function readLines(
  socket: Socket,
  onMessage: (value: unknown) => void,
): void {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_FRAME_BYTES) {
      socket.destroy();
      return;
    }
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        onMessage(JSON.parse(line));
      } catch {
        socket.destroy();
        return;
      }
    }
  });
}
export function sendLine(socket: Socket, value: unknown): void {
  if (socket.destroyed) return;
  if (socket.writableLength > MAX_FRAME_BYTES) {
    socket.destroy();
    return;
  }
  socket.write(JSON.stringify(value) + "\n");
}

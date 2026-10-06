import { spawn } from "node:child_process";
import { it, expect } from "vitest";
import net from "node:net";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startGateway } from "../src/server/gateway.js";
import { readLines, sendLine } from "../src/shared/lines.js";
import { decodeServer, type ServerMessage } from "../src/shared/protocol.js";

async function until<T>(read: () => T | undefined): Promise<T> {
  for (let n = 0; n < 200; n++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Missing gateway event");
}
it("validates real HTTP/WS access and invalidates a reused pane without redirecting commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pmh-gateway-"));
  await mkdir(path.join(root, "web"));
  await writeFile(path.join(root, "web/index.html"), "test");
  const herdrSocket = path.join(root, "herdr.sock");
  let terminalId = "terminal-one";
  const peers = new Set<net.Socket>();
  const fake = net.createServer((socket) => {
    peers.add(socket);
    socket.on("close", () => peers.delete(socket));
    readLines(socket, (v) => {
      const r = v as { id: string; method: string };
      sendLine(socket, {
        id: r.id,
        result:
          r.method === "session.snapshot"
            ? {
                snapshot: {
                  protocol: 22,
                  version: "test",
                  workspaces: [{ workspace_id: "workspace", label: "Test" }],
                  panes: [
                    {
                      pane_id: "pane",
                      workspace_id: "workspace",
                      terminal_id: terminalId,
                      agent: "pi",
                      agent_session: { kind: "id", value: "session" },
                    },
                  ],
                },
              }
            : { subscribed: true },
      });
    });
  });
  await new Promise<void>((r) => fake.listen(herdrSocket, r));
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const config = {
    port,
    origin: "https://host.example.ts.net",
    login: "owner@example.com",
    local: false,
    herdrSocket,
    bridgeSocket: path.join(root, "bridge.sock"),
    webRoot: path.join(root, "web"),
  };
  let stop: (() => Promise<void>) | undefined;
  let browser: WebSocket | undefined;
  let companion: net.Socket | undefined;
  const request = (headers: Record<string, string>) =>
    new Promise<number>((resolve) => {
      http.get(
        `http://127.0.0.1:${port}/`,
        { headers: { host: "host.example.ts.net", ...headers } },
        (r) => {
          r.resume();
          resolve(r.statusCode!);
        },
      );
    });
  try {
    stop = await startGateway(config);
    expect((await stat(config.bridgeSocket)).mode & 0o777).toBe(0o600);
    expect(await request({})).toBe(403);
    expect(await request({ "tailscale-user-login": "other@example.com" })).toBe(
      403,
    );
    expect(
      await request({
        "tailscale-user-login": config.login,
        origin: "https://evil.example",
      }),
    ).toBe(403);
    expect(await request({ "tailscale-user-login": config.login })).toBe(200);
    for (const headers of [
      { host: "host.example.ts.net" },
      { host: "host.example.ts.net", "tailscale-user-login": config.login },
    ]) {
      const rejected = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      const code = await new Promise<number>((resolve) => {
        rejected.on("unexpected-response", (_req, res) => {
          res.resume();
          resolve(res.statusCode!);
          rejected.terminate();
        });
        rejected.on("error", () => {});
      });
      expect(code).toBe(403);
    }
    companion = net.createConnection(config.bridgeSocket);
    const commands: unknown[] = [];
    readLines(companion, (v) => commands.push(v));
    await new Promise<void>((r) => companion!.once("connect", r));
    sendLine(companion, {
      type: "register",
      version: 2,
      herdrSocket,
      paneId: "pane",
      pid: process.pid,
      snapshot: {
        generation: "g1",
        revision: 1,
        sessionId: "session",
        sessionPath: "",
        messages: [
          {
            id: "result",
            role: "toolResult",
            toolCallId: "tool",
            toolName: "read",
            content: [{ type: "text", text: "Full deferred output" }],
          },
        ],
        tools: [],
        dialogs: [],
        models: [],
        model: "",
        thinking: "off",
        busy: false,
        terminalOnly: false,
        error: "",
      },
    });
    const events: ServerMessage[] = [];
    browser = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: {
        host: "host.example.ts.net",
        "tailscale-user-login": config.login,
        origin: config.origin,
      },
    });
    browser.on("message", (raw) =>
      events.push(decodeServer(JSON.parse(raw.toString()))),
    );
    await new Promise<void>((r) => browser!.once("open", r));
    await until(() =>
      events.some(
        (e) => e.type === "sessions" && e.sessions.some((s) => s.connected),
      )
        ? true
        : undefined,
    );
    browser.send(
      JSON.stringify({ type: "subscribe", version: 2, paneId: "pane" }),
    );
    const initial = await until(() =>
      events.find((e) => e.type === "snapshot"),
    );
    expect(JSON.stringify(initial)).not.toContain("Full deferred output");
    const details = (generation: string, login = config.login) =>
      new Promise<{ status: number; body: string; cache: string | undefined }>(
        (resolve) => {
          http.get(
            `http://127.0.0.1:${port}/api/tool?paneId=pane&generation=${generation}&id=tool`,
            {
              headers: {
                host: "host.example.ts.net",
                "tailscale-user-login": login,
              },
            },
            (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () =>
                resolve({
                  status: res.statusCode!,
                  body,
                  cache: res.headers["cache-control"],
                }),
              );
            },
          );
        },
      );
    const detail = await details("g1");
    expect(detail.status).toBe(200);
    expect(detail.body).toContain("Full deferred output");
    expect(detail.cache).toBe("no-store");
    expect((await details("old")).status).toBe(409);
    expect((await details("g1", "other@example.com")).status).toBe(403);
    terminalId = "replacement";
    browser.send(
      JSON.stringify({
        type: "command",
        version: 2,
        paneId: "pane",
        generation: "g1",
        id: "old-command",
        action: {
          kind: "prompt",
          text: "never route me",
          delivery: "send",
          images: [],
        },
      }),
    );
    const ack = await until(() =>
      events.find((e) => e.type === "ack" && e.id === "old-command"),
    );
    expect(ack.type === "ack" && ack.ok).toBe(false);
    expect(commands).toEqual([]);
    for (const peer of peers) sendLine(peer, { type: "events_lost" });
    await until(() => events.find((e) => e.type === "unavailable"));
    await expect(startGateway(config)).rejects.toThrow("already running");
  } finally {
    browser?.terminate();
    companion?.destroy();
    await stop?.();
    for (const p of peers) p.destroy();
    await new Promise<void>((r) => fake.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

it("recovers an owned socket left behind by a crashed gateway", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pmh-crash-"));
  const bridgeSocket = path.join(root, "bridge.sock");
  const child = spawn(process.execPath, [
    "-e",
    "require('node:net').createServer().listen(process.argv[1],()=>console.log('ready'))",
    bridgeSocket,
  ]);
  let stop: (() => Promise<void>) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve());
      child.once("error", reject);
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect((await stat(bridgeSocket)).isSocket()).toBe(true);
    stop = await startGateway({
      port: 0,
      origin: "http://127.0.0.1",
      login: "",
      local: true,
      herdrSocket: path.join(root, "missing-herdr.sock"),
      bridgeSocket,
      webRoot: root,
    });
    expect((await stat(bridgeSocket)).mode & 0o777).toBe(0o600);
  } finally {
    child.kill();
    await stop?.();
    await rm(root, { recursive: true, force: true });
  }
});

import net from "node:net";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  decodeCommand,
  diffSnapshot,
  type Snapshot,
  type Message,
  type Tool,
  type Command,
} from "../shared/protocol.js";
import { readLines, sendLine } from "../shared/lines.js";
import {
  blocks,
  branchMessages,
  message,
  record,
} from "../shared/transcript.js";
import { CommandLedger } from "./commands.js";
import { DialogBroker } from "./dialogs.js";
import { bridgeDialogs } from "./ui.js";

export default function companion(pi: ExtensionAPI) {
  const paneId = process.env.HERDR_PANE_ID;
  const herdrSocket = process.env.HERDR_SOCKET_PATH;
  if (!paneId || !herdrSocket || process.env.HERDR_ENV !== "1") return;
  const bridgeSocket =
    process.env.PMH_BRIDGE_SOCKET ??
    path.join(os.homedir(), ".local/state/pi-mobile-herdr/bridge.sock");
  let context: ExtensionContext | undefined;
  let socket: net.Socket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let generation = randomUUID();
  let revision = 0;
  let last: Snapshot | undefined;
  let ledger = new CommandLedger();
  let undoUI: (() => void) | undefined;
  let liveMessage: Message | undefined;
  let busy = false;
  let terminalOnly = 0;
  let bridgeError = "";
  let model = "";
  let thinking = "off";
  const tools = new Map<string, Tool>();
  const broker = new DialogBroker(schedule);
  function snapshot(): Snapshot {
    if (!context) throw new Error("Session not started");
    const messages = branchMessages(context.sessionManager.getBranch());
    if (liveMessage) messages.push(liveMessage);
    return {
      generation,
      revision,
      sessionId: context.sessionManager.getSessionId(),
      sessionPath: context.sessionManager.getSessionFile() ?? "",
      messages,
      tools: [...tools.values()],
      dialogs: broker.dialogs,
      models: context.modelRegistry
        .getAvailable()
        .map((m) => ({ provider: m.provider, id: m.id, name: m.name })),
      model,
      thinking,
      busy,
      terminalOnly: terminalOnly > 0,
      error: bridgeError,
    };
  }
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!context) return;
    revision++;
    const next = snapshot();
    if (socket && !socket.connecting && !socket.destroyed) {
      if (!last)
        sendLine(socket, {
          type: "register",
          version: 1,
          herdrSocket,
          paneId,
          pid: process.pid,
          snapshot: next,
        });
      else
        sendLine(socket, {
          type: "patch",
          version: 1,
          paneId,
          patch: diffSnapshot(last, next),
        });
      last = next;
    }
  }
  function schedule() {
    if (active && !flushTimer) flushTimer = setTimeout(flush, 50);
  }
  async function execute(command: Command) {
    if (!context || command.paneId !== paneId || bridgeError)
      throw new Error("Unavailable");
    const a = command.action;
    switch (a.kind) {
      case "prompt": {
        if (terminalOnly || broker.dialogs.length)
          throw new Error("Answer pending dialog first");
        if (!a.text.trim() && !a.images.length) throw new Error("Empty prompt");
        if (
          a.images.some((i) => !/^image\/(png|jpeg|webp|gif)$/.test(i.mimeType))
        )
          throw new Error("Unsupported image");
        if (!context.isIdle() && a.delivery === "send")
          throw new Error("Use steer or follow-up while running");
        pi.sendUserMessage([{ type: "text", text: a.text }, ...a.images], {
          ...(!context.isIdle()
            ? { deliverAs: a.delivery as "steer" | "followUp" }
            : {}),
          expandPromptTemplates: true,
        });
        break;
      }
      case "abort":
        context.abort();
        break;
      case "model": {
        const target = context.modelRegistry.find(a.provider, a.modelId);
        if (!target || !(await pi.setModel(target)))
          throw new Error("Model unavailable");
        model = `${a.provider}/${a.modelId}`;
        break;
      }
      case "thinking":
        pi.setThinkingLevel(a.level);
        thinking = pi.getThinkingLevel();
        break;
      case "answer":
        if (!broker.answer(a.dialogId, a.value, a.cancelled))
          throw new Error("Dialog already answered or invalid answer");
        break;
    }
    schedule();
  }
  function connect() {
    if (!active) return;
    const current = net.createConnection(bridgeSocket);
    socket = current;
    last = undefined;
    current.once("connect", () => {
      if (socket === current) flush();
    });
    current.on("error", () => {});
    readLines(current, (value) => {
      if (record(value).type === "resync") {
        sendLine(current, {
          type: "snapshot",
          version: 1,
          paneId,
          snapshot: snapshot(),
        });
        last = snapshot();
        return;
      }
      const command = decodeCommand(value);
      const commandGeneration = generation;
      void ledger
        .execute(command, generation, async () => {
          if (generation !== commandGeneration)
            throw new Error("Session changed");
          await execute(command);
        })
        .then((ack) => {
          sendLine(current, ack);
        });
    });
    current.once("close", () => {
      if (socket !== current) return;
      socket = undefined;
      last = undefined;
      if (active) reconnect = setTimeout(connect, 1000);
    });
  }
  function stop() {
    active = false;
    clearTimeout(reconnect);
    clearTimeout(flushTimer);
    flushTimer = undefined;
    undoUI?.();
    undoUI = undefined;
    broker.close();
    socket?.destroy();
    socket = undefined;
    last = undefined;
  }
  function start(ctx: ExtensionContext) {
    stop();
    if (ctx.mode !== "tui") return;
    context = ctx;
    generation = randomUUID();
    revision = 0;
    ledger = new CommandLedger();
    liveMessage = undefined;
    tools.clear();
    busy = !ctx.isIdle();
    terminalOnly = 0;
    bridgeError = "";
    model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
    thinking = pi.getThinkingLevel();
    active = true;
    try {
      undoUI = bridgeDialogs(ctx.ui, broker, (on) => {
        terminalOnly = Math.max(0, terminalOnly + (on ? 1 : -1));
        schedule();
      });
    } catch {
      bridgeError =
        "This Pi version does not support the required dialog bridge. Mobile control is disabled.";
      ctx.ui.notify(bridgeError, "error");
    }
    connect();
  }
  pi.on("session_start", (_event, ctx) => start(ctx));
  pi.on("session_shutdown", () => stop());
  pi.on("session_tree", (_event, ctx) => start(ctx));
  pi.on("session_compact", (_event, ctx) => {
    context = ctx;
    liveMessage = undefined;
    tools.clear();
    schedule();
  });
  pi.on("agent_start", (_event, ctx) => {
    context = ctx;
    busy = true;
    tools.clear();
    schedule();
  });
  pi.on("agent_settled", (_event, ctx) => {
    context = ctx;
    busy = !ctx.isIdle();
    liveMessage = undefined;
    schedule();
  });
  pi.on("agent_end", (_event, ctx) => {
    context = ctx;
    schedule();
  });
  pi.on("thinking_level_select", (event) => {
    thinking = event.level;
    schedule();
  });
  pi.on("model_select", (event, ctx) => {
    context = ctx;
    model = `${event.model.provider}/${event.model.id}`;
    thinking = pi.getThinkingLevel();
    schedule();
  });
  pi.on("message_start", (event, ctx) => {
    context = ctx;
    if (record(event.message).role === "assistant")
      liveMessage = message(event.message, randomUUID());
    schedule();
  });
  pi.on("message_update", (event, ctx) => {
    context = ctx;
    liveMessage = message(event.message, liveMessage?.id ?? randomUUID());
    schedule();
  });
  pi.on("message_end", (_event, ctx) => {
    context = ctx;
    liveMessage = undefined;
    schedule();
  });
  pi.on("tool_execution_start", (event, ctx) => {
    context = ctx;
    tools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
      content: [],
      status: "running",
    });
    schedule();
  });
  pi.on("tool_execution_update", (event, ctx) => {
    context = ctx;
    tools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      args: event.args,
      content: blocks(record(event.partialResult).content),
      status: "running",
    });
    schedule();
  });
  pi.on("tool_execution_end", (event, ctx) => {
    context = ctx;
    tools.set(event.toolCallId, {
      id: event.toolCallId,
      name: event.toolName,
      args: tools.get(event.toolCallId)?.args,
      content: blocks(record(event.result).content),
      status: event.isError ? "error" : "success",
    });
    schedule();
  });
}

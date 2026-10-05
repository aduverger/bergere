import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  applyPatch,
  type Block,
  type Command,
  type Dialog,
  type Session,
  type Snapshot,
  type Tool,
} from "../shared/protocol";
import { transcriptTools } from "../shared/transcript";
import { Connection } from "./client";
import "./style.css";

function Content({ blocks }: { blocks: readonly Block[] }) {
  return (
    <>
      {blocks.map((p, i) =>
        p.type === "text" ? (
          <Markdown key={i} remarkPlugins={[remarkGfm]}>
            {p.text}
          </Markdown>
        ) : p.type === "thinking" ? (
          <details className="thinking" key={i}>
            <summary>Reasoning</summary>
            <Markdown remarkPlugins={[remarkGfm]}>{p.thinking}</Markdown>
          </details>
        ) : p.type === "image" ? (
          <a
            key={i}
            href={`data:${p.mimeType};base64,${p.data}`}
            target="_blank"
            rel="noreferrer"
          >
            <img
              alt="Message attachment"
              src={`data:${p.mimeType};base64,${p.data}`}
            />
          </a>
        ) : null,
      )}
    </>
  );
}
function ToolRow({ tool }: { tool: Tool }) {
  const args = tool.args as Record<string, unknown> | undefined;
  const label =
    typeof args?.path === "string"
      ? args.path
      : typeof args?.command === "string"
        ? args.command
        : "";
  return (
    <details className={`tool ${tool.status}`}>
      <summary>
        <span className="tool-icon">
          {tool.status === "running"
            ? "◌"
            : tool.status === "error"
              ? "!"
              : "✓"}
        </span>
        <strong>{tool.name}</strong>
        <span className="tool-label">{label}</span>
        <span>›</span>
      </summary>
      <div className="tool-body">
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
        <Content blocks={tool.content} />
      </div>
    </details>
  );
}
function DialogCard({
  dialog,
  answer,
  disabled,
}: {
  dialog: Dialog;
  answer: (value: string | boolean, cancelled: boolean) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState(dialog.prefill);
  return (
    <form
      className="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        answer(value, false);
      }}
    >
      <h3>{dialog.title}</h3>
      {dialog.message && <p>{dialog.message}</p>}
      {dialog.kind === "select" ? (
        <div className="choices">
          {dialog.options.map((o) => (
            <button
              type="button"
              disabled={disabled}
              key={o}
              onClick={() => answer(o, false)}
            >
              {o}
            </button>
          ))}
        </div>
      ) : dialog.kind === "confirm" ? (
        <div className="choices">
          <button
            type="button"
            disabled={disabled}
            onClick={() => answer(true, false)}
          >
            Allow
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => answer(false, false)}
          >
            Decline
          </button>
        </div>
      ) : (
        <>
          <textarea
            aria-label={dialog.title}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={dialog.kind === "editor" ? 6 : 2}
          />
          <button disabled={disabled}>Submit</button>
        </>
      )}
      <button
        type="button"
        className="subtle"
        disabled={disabled}
        onClick={() => answer("", true)}
      >
        Cancel
      </button>
    </form>
  );
}
function App() {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [selected, setSelected] = useState("");
  const selectedRef = useRef("");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [online, setOnline] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, Block[]>>({});
  const [delivery, setDelivery] = useState<"steer" | "followUp">("steer");
  const [pending, setPending] = useState(false);
  const pendingCommands = useRef(
    new Map<string, { paneId: string; text?: string }>(),
  );
  const conn = useRef<Connection | undefined>(undefined);
  const history = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [below, setBelow] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const c = new Connection(
      (msg) => {
        if (msg.type === "sessions") {
          setSessions(msg.sessions);
          if (msg.error) {
            setReady(false);
            setNotice(msg.error);
          }
          if (!selectedRef.current && msg.sessions.length) {
            const id = msg.sessions[0].paneId;
            selectedRef.current = id;
            setSelected(id);
            c.subscribe(id);
          }
          return;
        }
        if (msg.type === "ack") {
          const sent = pendingCommands.current.get(msg.id);
          if (!sent) return;
          pendingCommands.current.delete(msg.id);
          setPending(pendingCommands.current.size > 0);
          if (msg.ok && sent.text !== undefined) {
            setDrafts((ds) =>
              ds[sent.paneId] === sent.text ? { ...ds, [sent.paneId]: "" } : ds,
            );
            setImages((all) => ({ ...all, [sent.paneId]: [] }));
          }
          if (msg.paneId === selectedRef.current)
            setNotice(msg.ok ? "" : msg.error);
          return;
        }
        if (msg.paneId !== selectedRef.current) return;
        if (msg.type === "snapshot") {
          setSnapshot(msg.snapshot);
          setReady(!msg.snapshot.error);
          setNotice(msg.snapshot.error);
          return;
        }
        if (msg.type === "unavailable") {
          setReady(false);
          setNotice(msg.error);
          return;
        }
        setSnapshot((current) => {
          const next = current && applyPatch(current, msg.patch);
          if (!next) {
            setReady(false);
            c.subscribe(selectedRef.current);
            return current;
          }
          return next;
        });
      },
      (connected) => {
        setOnline(connected);
        setReady(false);
        if (!connected && pendingCommands.current.size) {
          setNotice(
            "Connection lost. Delivery is uncertain; check the conversation before sending again.",
          );
          pendingCommands.current.clear();
          setPending(false);
        }
      },
    );
    conn.current = c;
    c.start();
    return () => c.stop();
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty(
        "--app-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    return () => viewport?.removeEventListener("resize", resize);
  }, []);
  useLayoutEffect(() => {
    if (following.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
    else setBelow(true);
  }, [snapshot]);
  function choose(id: string) {
    selectedRef.current = id;
    setSelected(id);
    setSnapshot(undefined);
    setReady(false);
    setNotice("");
    setDrawer(false);
    following.current = true;
    setBelow(false);
    conn.current?.subscribe(id);
  }
  function command(action: Command["action"]) {
    if (!snapshot || !ready || !online) return;
    const id = crypto.randomUUID();
    pendingCommands.current.set(id, {
      paneId: selected,
      ...(action.kind === "prompt" ? { text: action.text } : {}),
    });
    setPending(true);
    try {
      conn.current?.send({
        type: "command",
        version: 1,
        id,
        paneId: selected,
        generation: snapshot.generation,
        action,
      });
    } catch {
      pendingCommands.current.delete(id);
      setPending(false);
      setNotice("Disconnected. Command was not sent.");
    }
  }
  async function attach(files: FileList | null) {
    if (!files) return;
    const pane = selected;
    const list: Block[] = [];
    for (const f of Array.from(files)) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
        setNotice("Use PNG, JPEG, WebP or GIF images.");
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        setNotice("Each image must be under 10 MiB.");
        continue;
      }
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(f);
      });
      list.push({ type: "image", mimeType: f.type, data });
    }
    setImages((all) => ({ ...all, [pane]: [...(all[pane] ?? []), ...list] }));
  }
  const session = sessions.find((s) => s.paneId === selected);
  const draft = drafts[selected] ?? "";
  const attachments = (images[selected] ?? []).filter(
    (i): i is Extract<Block, { type: "image" }> => i.type === "image",
  );
  const tools = transcriptTools(
    snapshot?.messages ?? [],
    snapshot?.tools ?? [],
  );
  const rendered = new Set<string>();
  const disabled = !online || !ready || pending;
  const promptDisabled =
    disabled || !!snapshot?.dialogs.length || !!snapshot?.terminalOnly;
  const groups = new Map<string, Session[]>();
  for (const s of sessions)
    if (
      `${s.title} ${s.cwd} ${s.workspace}`
        .toLowerCase()
        .includes(query.toLowerCase())
    )
      groups.set(s.workspaceId, [...(groups.get(s.workspaceId) ?? []), s]);
  return (
    <div className="app">
      {drawer && (
        <button
          className="scrim"
          aria-label="Close sessions"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className={drawer ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <span>π</span>
          <strong>Pi · Herdr</strong>
          <button
            className="mobile-only subtle"
            aria-label="Close sessions"
            onClick={() => setDrawer(false)}
          >
            ×
          </button>
        </div>
        <input
          className="search"
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <nav>
          {[...groups].map(([id, list]) => (
            <section key={id}>
              <h2>{list[0].workspace}</h2>
              {list.map((s) => (
                <button
                  key={s.paneId}
                  className={`session ${selected === s.paneId ? "selected" : ""}`}
                  onClick={() => choose(s.paneId)}
                >
                  <span>{s.title}</span>
                  <small>
                    <i className={s.connected ? s.status : "offline"} />
                    {s.connected ? s.status : "Needs companion"}
                  </small>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <footer>
          <span className={online ? "online" : "offline"}>●</span>{" "}
          {online ? "Connected" : "Reconnecting…"}
          <span className="muted">Existing Herdr sessions</span>
        </footer>
      </aside>
      <main>
        <header>
          <button
            className="mobile-only subtle"
            aria-label="Open sessions"
            onClick={() => setDrawer(true)}
          >
            ☰
          </button>
          <div>
            <strong>{session?.title ?? "Pi · Herdr"}</strong>
            <small>
              {session?.cwd ?? "Your running sessions, wherever you are"}
            </small>
          </div>
          <span className="status">
            {snapshot?.busy ? "Working" : ready ? "Ready" : ""}
          </span>
        </header>
        <div
          ref={history}
          className="history"
          onScroll={() => {
            const el = history.current!;
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            if (following.current) setBelow(false);
          }}
        >
          <div className="transcript">
            {!session && (
              <div className="empty">
                <span>π</span>
                <h1>Your work stays running.</h1>
                <p>Start Pi inside Herdr, then open its session here.</p>
              </div>
            )}
            {session && !session.connected && (
              <div className="empty">
                <h2>Companion needed</h2>
                <p>{session.reason}</p>
                <p>
                  Install this package in Pi and run <code>/reload</code> in the
                  terminal when idle.
                </p>
              </div>
            )}
            {snapshot?.messages.map((m) => {
              if (
                m.role === "toolResult" &&
                m.toolCallId &&
                rendered.has(m.toolCallId)
              )
                return null;
              return (
                <article key={m.id} className={`message ${m.role}`}>
                  <Content
                    blocks={m.content.filter((p) => p.type !== "toolCall")}
                  />
                  {m.content
                    .filter((p) => p.type === "toolCall")
                    .map((p) => {
                      rendered.add(p.id);
                      const t = tools.get(p.id);
                      return t ? <ToolRow key={p.id} tool={t} /> : null;
                    })}
                </article>
              );
            })}
            {[...tools.values()]
              .filter(
                (t) =>
                  !rendered.has(t.id) &&
                  !snapshot?.messages.some((m) => m.toolCallId === t.id),
              )
              .map((t) => (
                <ToolRow key={t.id} tool={t} />
              ))}
            {snapshot?.dialogs.map((d) => (
              <DialogCard
                key={d.id}
                dialog={d}
                disabled={disabled}
                answer={(value, cancelled) =>
                  command({ kind: "answer", dialogId: d.id, value, cancelled })
                }
              />
            ))}
            {snapshot?.terminalOnly && (
              <p className="banner">
                This custom interaction requires the terminal.
              </p>
            )}
            {snapshot?.busy && (
              <div className="working" aria-label="Pi is working">
                ● ● ●
              </div>
            )}
          </div>
        </div>
        <div className="compose-area">
          {below && (
            <button
              className="jump"
              onClick={() => {
                following.current = true;
                setBelow(false);
                history.current?.scrollTo({
                  top: history.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
            >
              ↓ Latest
            </button>
          )}
          {notice && (
            <p className="banner" role="status">
              {notice}
            </p>
          )}
          {!online && (
            <p className="banner">Reconnecting — sending is disabled.</p>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              if (!promptDisabled && (draft.trim() || attachments.length))
                command({
                  kind: "prompt",
                  text: draft,
                  images: attachments,
                  delivery: snapshot?.busy ? delivery : "send",
                });
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void attach(e.clipboardData.files);
              }
            }}
          >
            {!!attachments.length && (
              <div className="attachments">
                {attachments.map((a, i) => (
                  <button
                    type="button"
                    aria-label={`Remove attachment ${i + 1}`}
                    key={i}
                    onClick={() =>
                      setImages((all) => ({
                        ...all,
                        [selected]: attachments.filter(
                          (_, index) => index !== i,
                        ),
                      }))
                    }
                  >
                    <img
                      alt={`Attachment ${i + 1}`}
                      src={`data:${a.mimeType};base64,${a.data}`}
                    />
                    ×
                  </button>
                ))}
              </div>
            )}
            <textarea
              aria-label="Message"
              placeholder={
                snapshot?.busy ? "Steer the current run…" : "Message Pi…"
              }
              value={draft}
              onChange={(e) =>
                setDrafts((all) => ({ ...all, [selected]: e.target.value }))
              }
              rows={2}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  matchMedia("(pointer:fine)").matches
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="controls">
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => {
                  void attach(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="subtle"
                aria-label="Attach images"
                disabled={promptDisabled}
                onClick={() => file.current?.click()}
              >
                ＋
              </button>
              <select
                aria-label="Model"
                value={snapshot?.model ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const m = snapshot?.models.find(
                    (m) => `${m.provider}/${m.id}` === e.target.value,
                  );
                  if (m)
                    command({
                      kind: "model",
                      provider: m.provider,
                      modelId: m.id,
                    });
                }}
              >
                <option value="">Model</option>
                {snapshot?.models.map((m) => (
                  <option
                    key={`${m.provider}/${m.id}`}
                    value={`${m.provider}/${m.id}`}
                  >
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Thinking level"
                value={snapshot?.thinking ?? "off"}
                disabled={disabled}
                onChange={(e) =>
                  command({ kind: "thinking", level: e.target.value as "off" })
                }
              >
                {["off", "minimal", "low", "medium", "high", "xhigh"].map(
                  (l) => (
                    <option key={l}>{l}</option>
                  ),
                )}
              </select>
              {snapshot?.busy && (
                <select
                  aria-label="Delivery"
                  value={delivery}
                  onChange={(e) =>
                    setDelivery(e.target.value as "steer" | "followUp")
                  }
                >
                  <option value="steer">Steer</option>
                  <option value="followUp">Follow up</option>
                </select>
              )}
              <span className="spacer" />
              {snapshot?.busy && (
                <button
                  type="button"
                  aria-label="Stop"
                  disabled={!online || !ready}
                  onClick={() => command({ kind: "abort" })}
                >
                  ■
                </button>
              )}
              <button
                className="send"
                aria-label="Send message"
                disabled={
                  promptDisabled || (!draft.trim() && !attachments.length)
                }
              >
                ↑
              </button>
            </div>
          </form>
          <div className="caption">
            {pending
              ? "Waiting for acknowledgement…"
              : "Same Pi process · managed by Herdr"}
          </div>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

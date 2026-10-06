import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	applyPatch,
	type Block,
	type Command,
	type ServerMessage,
	type Session,
	type Snapshot,
} from "../shared/protocol";
import { type Attachment, Composer } from "./Composer";
import { Connection } from "./client";
import { DialogCard } from "./DialogCard";
import { Transcript } from "./Transcript";

function groupSessions(sessions: readonly Session[], query: string) {
	const groups = new Map<string, Session[]>();
	for (const s of sessions)
		if (`${s.title} ${s.cwd} ${s.workspace}`.toLowerCase().includes(query.toLowerCase()))
			groups.set(s.workspaceId, [...(groups.get(s.workspaceId) ?? []), s]);
	return groups;
}
export function App() {
	const [sessions, setSessions] = useState<readonly Session[]>([]);
	const [selected, setSelected] = useState("");
	const selectedRef = useRef("");
	const [snapshot, setSnapshot] = useState<Snapshot>();
	const [online, setOnline] = useState(false);
	const [ready, setReady] = useState(false);
	const [notice, setNotice] = useState("");
	const [uncertain, setUncertain] = useState(false);
	const [query, setQuery] = useState("");
	const [drawer, setDrawer] = useState(false);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [images, setImages] = useState<Record<string, Attachment[]>>({});
	const [pending, setPending] = useState(false);
	const pendingCommands = useRef(
		new Map<string, { paneId: string; text?: string; images?: readonly Block[] }>(),
	);
	const conn = useRef<Connection | undefined>(undefined);
	const history = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const [below, setBelow] = useState(false);
	useEffect(() => {
		function acknowledge(msg: Extract<ServerMessage, { type: "ack" }>) {
			const sent = pendingCommands.current.get(msg.id);
			if (!sent) return;
			pendingCommands.current.delete(msg.id);
			setPending(pendingCommands.current.size > 0);
			if (msg.ok && sent.text !== undefined) {
				setDrafts((ds) => (ds[sent.paneId] === sent.text ? { ...ds, [sent.paneId]: "" } : ds));
				setImages((all) => {
					const current = all[sent.paneId] ?? [];
					return current.length === sent.images?.length &&
						current.every((image, i) => image === sent.images?.[i])
						? { ...all, [sent.paneId]: [] }
						: all;
				});
			}
			if (msg.paneId === selectedRef.current) setNotice(msg.ok ? "" : msg.error);
		}
		function updateSessions(msg: Extract<ServerMessage, { type: "sessions" }>) {
			setSessions(
				msg.sessions.map((session) => ({
					...session,
					title: session.title.replace(/^π(?=\s|$)/u, "Pi"),
				})),
			);
			if (msg.error) {
				setReady(false);
				setNotice(msg.error);
			}
			const firstSession = msg.sessions[0];
			if (!selectedRef.current && firstSession) {
				const id = firstSession.paneId;
				selectedRef.current = id;
				setSelected(id);
				c.subscribe(id);
			}
			return;
		}
		const c = new Connection(
			(msg) => {
				if (msg.type === "sessions") {
					updateSessions(msg);
					return;
				}
				if (msg.type === "ack") {
					acknowledge(msg);
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
					if (pendingCommands.current.size) {
						setUncertain(true);
						pendingCommands.current.clear();
						setPending(false);
					}
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
					setUncertain(true);
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
			const style = document.documentElement.style;
			style.setProperty("--app-height", `${viewport?.height ?? window.innerHeight}px`);
			style.setProperty("--app-top", `${viewport?.offsetTop ?? 0}px`);
		};
		resize();
		viewport?.addEventListener("resize", resize);
		viewport?.addEventListener("scroll", resize);
		window.addEventListener("resize", resize);
		return () => {
			viewport?.removeEventListener("resize", resize);
			viewport?.removeEventListener("scroll", resize);
			window.removeEventListener("resize", resize);
		};
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: New transcript snapshots trigger scroll following after DOM updates.
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
		pendingCommands.current.clear();
		setPending(false);
		following.current = true;
		setBelow(false);
		conn.current?.subscribe(id);
	}
	function command(action: Command["action"]) {
		if (!snapshot || !ready || !online) return;
		if (
			action.kind === "prompt" &&
			new TextEncoder().encode(JSON.stringify(action)).length > 24 * 1024 * 1024
		) {
			setNotice("Message and images exceed the 24 MiB limit. Remove an attachment.");
			return;
		}
		const id = crypto.randomUUID();
		pendingCommands.current.set(id, {
			paneId: selected,
			...(action.kind === "prompt" ? { text: action.text, images: action.images } : {}),
		});
		setPending(true);
		try {
			conn.current?.send({
				type: "command",
				version: 2,
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
		const list: Attachment[] = [];
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
				r.onload = () => {
					const encoded = String(r.result).split(",")[1];
					if (encoded === undefined) reject(new Error("Unable to read image"));
					else resolve(encoded);
				};
				r.onerror = reject;
				r.readAsDataURL(f);
			});
			list.push({ id: crypto.randomUUID(), type: "image", mimeType: f.type, data });
		}
		setImages((all) => ({ ...all, [pane]: [...(all[pane] ?? []), ...list] }));
	}
	const session = sessions.find((s) => s.paneId === selected);
	const draft = drafts[selected] ?? "";
	const attachments = images[selected] ?? [];
	const disabled = !online || !ready || pending;
	const promptDisabled = disabled || !!snapshot?.dialogs.length || !!snapshot?.terminalOnly;
	const groups = groupSessions(sessions, query);
	return (
		<div className="app">
			{drawer && (
				<button
					type="button"
					className="scrim"
					aria-label="Close sessions"
					onClick={() => setDrawer(false)}
				/>
			)}
			<aside className={drawer ? "sidebar open" : "sidebar"}>
				<div className="brand">
					<img src="/icon.svg" alt="" className="bergere-logo" />
					<strong>Bergère</strong>
					<button
						type="button"
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
							<h2>{list[0]?.workspace}</h2>
							{list.map((s) => (
								<button
									type="button"
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
						type="button"
						className="mobile-only subtle"
						aria-label="Open sessions"
						onClick={() => setDrawer(true)}
					>
						☰
					</button>
					<div>
						<strong>{session?.title ?? "Bergère"}</strong>
						<small>{session?.cwd ?? "Your running sessions, wherever you are"}</small>
					</div>
					<span className="status">{snapshot?.busy ? "Working" : ready ? "Ready" : ""}</span>
				</header>
				<div
					ref={history}
					className="history"
					onScroll={(e) => {
						const el = e.currentTarget;
						following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
						if (following.current) setBelow(false);
					}}
				>
					<div className="transcript">
						{!session && (
							<div className="empty">
								<img src="/icon.svg" alt="" className="bergere-logo" />
								<h1>Your work stays running.</h1>
								<p>Start Pi inside Herdr, then open its session here.</p>
							</div>
						)}
						{session && !session.connected && (
							<div className="empty">
								<h2>Companion needed</h2>
								<p>{session.reason}</p>
								<p>
									Install this package in Pi and run <code>/reload</code> in the terminal when idle.
								</p>
							</div>
						)}
						{snapshot && (
							<Transcript
								key={snapshot.generation}
								messages={snapshot.messages}
								live={snapshot.tools}
								paneId={selected}
								generation={snapshot.generation}
							/>
						)}
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
							<p className="banner">This custom interaction requires the terminal.</p>
						)}
						{snapshot?.busy && (
							<div className="working" role="status" aria-label="Pi is working">
								● ● ●
							</div>
						)}
					</div>
				</div>
				<div className="compose-area">
					{below && (
						<button
							type="button"
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
					{uncertain && (
						<p className="banner" role="status">
							Delivery of an earlier command is uncertain. Check the conversation before sending
							again.{" "}
							<button type="button" onClick={() => setUncertain(false)}>
								Dismiss
							</button>
						</p>
					)}
					{notice && (
						<p className="banner" role="status">
							{notice}
						</p>
					)}
					{!online && <p className="banner">Reconnecting — sending is disabled.</p>}
					<Composer
						draft={draft}
						attachments={attachments}
						snapshot={snapshot}
						disabled={disabled}
						promptDisabled={promptDisabled}
						online={online}
						ready={ready}
						command={command}
						attach={attach}
						setDraft={(text) => setDrafts((all) => ({ ...all, [selected]: text }))}
						removeAttachment={(id) =>
							setImages((all) => ({
								...all,
								[selected]: attachments.filter((image) => image.id !== id),
							}))
						}
					/>
					{pending && (
						<div className="caption" role="status">
							Waiting for acknowledgement…
						</div>
					)}
				</div>
			</main>
		</div>
	);
}

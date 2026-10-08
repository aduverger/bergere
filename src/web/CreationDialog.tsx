import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CreationCatalog, CreationOperation, CreationRequest } from "../shared/creation";
import type { Connection } from "./client";
import { EmidevCreation } from "./EmidevCreation";

const stages: Record<CreationOperation["stage"], string> = {
	creating: "Creating space…",
	launching: "Starting runner…",
	provisioning: "Provisioning workspace…",
	starting: "Starting Pi — waiting for companion…",
	ready: "Ready",
	exited: "Pi exited",
	failed: "Creation failed",
	uncertain: "Launch needs checking",
};
const storageKey = "bergere-creation-operation";
export function CreationDialog({
	connection,
	online,
	close,
	select,
}: {
	connection: Connection;
	online: boolean;
	close: () => void;
	select: (pane: string) => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const title = useRef<HTMLHeadingElement>(null);
	const [catalog, setCatalog] = useState<CreationCatalog>();
	const [error, setError] = useState("");
	const [operation, setOperation] = useState<CreationOperation>();
	const operationId = useRef(sessionStorage.getItem(storageKey) ?? "");
	const [pending, setPending] = useState(!!operationId.current);
	const [dismissed, setDismissed] = useState(false);
	useEffect(() => {
		dialog.current?.showModal();
		title.current?.focus({ preventScroll: true });
		const element = dialog.current;
		if (!element) return;
		const resize = new ResizeObserver(() => {
			const focused = document.activeElement;
			if (focused instanceof HTMLInputElement && element.contains(focused))
				focused.scrollIntoView({ block: "nearest", inline: "nearest" });
		});
		resize.observe(element);
		return () => resize.disconnect();
	}, []);
	useEffect(() => {
		connection.creationListener = (message) => {
			if (message.type === "creation-catalog") setCatalog(message.catalog);
			if (message.type === "creation-operation" && message.operation.id === operationId.current) {
				setOperation(message.operation);
				setError("");
				setPending(false);
			}
			if (
				message.type === "creation-error" &&
				(!message.id || message.id === operationId.current)
			) {
				setError(message.error);
				if (message.rejected) {
					operationId.current = "";
					sessionStorage.removeItem(storageKey);
				}
				setPending(false);
			}
		};
		const poll = () => {
			if (operationId.current) {
				try {
					connection.send({ type: "creation-status", version: 2, id: operationId.current });
				} catch {}
			}
		};
		if (online) {
			connection.send({ type: "creation-discover", version: 2 });
			poll();
		}
		const timer = setInterval(poll, 2000);
		return () => {
			clearInterval(timer);
			connection.creationListener = undefined;
		};
	}, [connection, online]);
	useEffect(() => {
		if (operation?.stage === "ready" && !dismissed) {
			sessionStorage.removeItem(storageKey);
			setDismissed(true);
			select(operation.paneId);
			close();
		}
	}, [operation, dismissed, select, close]);
	function submit(request: CreationRequest) {
		const id = crypto.randomUUID();
		operationId.current = id;
		sessionStorage.setItem(storageKey, id);
		setPending(true);
		setError("");
		try {
			connection.send({ type: "creation-start", version: 2, id, request });
		} catch {
			setError("Disconnected. Check operation status after reconnecting before trying again.");
			setPending(false);
		}
	}
	const hasOperation = pending || !!operation || !!operationId.current;
	return (
		<dialog
			ref={dialog}
			className="creation-dialog"
			aria-labelledby="creation-title"
			onCancel={close}
		>
			<div className="creation-panel">
				<header>
					<h2 id="creation-title" ref={title} tabIndex={-1}>
						New
					</h2>
					<button
						type="button"
						className="icon-button subtle"
						aria-label="Close creation"
						onClick={close}
					>
						<X aria-hidden="true" />
					</button>
				</header>
				{!online && <p role="status">Reconnecting. Creation is disabled.</p>}
				{error && (
					<p className="banner" role="alert">
						{error}
					</p>
				)}
				{hasOperation ? (
					<section aria-live="polite">
						<p>{operation ? stages[operation.stage] : "Checking creation…"}</p>
						{operation?.error && <p>{operation.error}</p>}
						{operation?.stage === "starting" && (
							<p className="creation-hint">
								If Pi stays here, check that the Bergère companion is installed in the terminal. No
								additional Pi process will be launched.
							</p>
						)}
						{operation?.paneId && (
							<button
								type="button"
								onClick={() => {
									select(operation.paneId);
									close();
								}}
							>
								Open session
							</button>
						)}
						<button
							type="button"
							onClick={() => {
								operationId.current = "";
								sessionStorage.removeItem(storageKey);
								setPending(false);
								setOperation(undefined);
								setError("");
							}}
						>
							Dismiss operation
						</button>
						<p className="creation-hint">
							Closing this dialog does not stop the terminal process. Check an uncertain launch in
							Herdr before creating another.
						</p>
					</section>
				) : (
					<CreationFields catalog={catalog} online={online} submit={submit} />
				)}
			</div>
		</dialog>
	);
}

function CreationFields({
	catalog,
	online,
	submit,
}: {
	catalog: CreationCatalog | undefined;
	online: boolean;
	submit: (request: CreationRequest) => void;
}) {
	const [kind, setKind] = useState("session");
	const [providerChoice, setProvider] = useState("");
	const provider = providerChoice || (catalog?.emidev.enabled ? "emidev" : "herdr");
	const [choice, setChoice] = useState("");
	const [association, setAssociation] = useState("");
	const [root, setRoot] = useState("~");
	const [name, setName] = useState("");
	const emidev =
		kind === "session"
			? catalog?.emidev.workspaces.find((w) => `emidev:${w.root}` === choice)
			: undefined;
	function choose(value: string) {
		setChoice(value);
		setAssociation("");
		const workspace = catalog?.workspaces.find((w) => w.id === value);
		setRoot(workspace?.root ?? "");
	}

	return (
		<>
			<div className="choices">
				<button type="button" aria-pressed={kind === "session"} onClick={() => setKind("session")}>
					Pi session
				</button>
				<button
					type="button"
					aria-pressed={kind === "workspace"}
					onClick={() => setKind("workspace")}
				>
					Workspace
				</button>
			</div>
			{!catalog ? (
				kind === "session" ? (
					<form aria-busy="true">
						<WorkspaceSelect value="" onChange={choose} />
						<div className="creation-session-details" />
						<button type="submit" disabled>
							Start Pi
						</button>
					</form>
				) : null
			) : (
				<>
					{kind === "workspace" && catalog.emidev.enabled && (
						<label>
							Workspace type
							<select value={provider} onChange={(event) => setProvider(event.target.value)}>
								<option value="herdr">Herdr workspace</option>
								<option value="emidev">Emidev workspace</option>
							</select>
						</label>
					)}
					{kind === "workspace" && provider === "emidev" && catalog.emidev.enabled ? (
						<EmidevCreation integration={catalog.emidev} disabled={!online} submit={submit} />
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								if (kind === "workspace") submit({ kind: "workspace", name, root });
								else if (emidev)
									submit({
										kind: "emidev-session",
										root: emidev.root,
										workspaceId: association || emidev.workspaceId,
									});
								else submit({ kind: "session", workspaceId: choice, root });
							}}
						>
							{kind === "session" ? (
								<WorkspaceSelect catalog={catalog} value={choice} onChange={choose} />
							) : (
								<label>
									Workspace name
									<input
										autoCapitalize="none"
										autoCorrect="off"
										spellCheck={false}
										required
										maxLength={100}
										value={name}
										onChange={(event) => setName(event.target.value)}
									/>
								</label>
							)}
							<CreationRootFields
								kind={kind}
								catalog={catalog}
								choice={choice}
								emidev={emidev}
								association={association}
								setAssociation={setAssociation}
								root={root}
								setRoot={setRoot}
							/>
							<button type="submit" disabled={!online || (kind === "session" && !choice)}>
								{kind === "session" ? "Start Pi" : "Create workspace"}
							</button>
						</form>
					)}
					{catalog.emidev.error && (kind === "session" || provider !== "emidev") && (
						<p className="creation-hint">
							{catalog.emidev.error} Herdr creation remains available.
						</p>
					)}
				</>
			)}
		</>
	);
}

function CreationRootFields({
	kind,
	catalog,
	choice,
	emidev,
	association,
	setAssociation,
	root,
	setRoot,
}: {
	kind: string;
	catalog: CreationCatalog;
	choice: string;
	emidev: CreationCatalog["emidev"]["workspaces"][number] | undefined;
	association: string;
	setAssociation: (value: string) => void;
	root: string;
	setRoot: (value: string) => void;
}) {
	return (
		<div className={kind === "session" ? "creation-session-details" : undefined}>
			{emidev ? (
				<>
					<p className="creation-hint">Pi will start in {emidev.root}</p>
					{!emidev.workspaceId && emidev.candidates.length > 0 && (
						<label>
							Herdr space
							<select
								required
								value={association}
								onChange={(event) => setAssociation(event.target.value)}
							>
								<option value="">Choose association</option>
								{catalog.workspaces
									.filter((w) => emidev.candidates.includes(w.id))
									.map((w) => (
										<option key={w.id} value={w.id}>
											{w.name}
										</option>
									))}
								<option value="new">Create a new Herdr space</option>
							</select>
						</label>
					)}
				</>
			) : kind === "workspace" || choice ? (
				<label>
					Root directory
					<input
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
						required
						value={root}
						onChange={(event) => setRoot(event.target.value)}
						placeholder="~/code/project"
					/>
				</label>
			) : null}
			{kind === "session" &&
				!emidev &&
				choice &&
				!catalog.workspaces.find((w) => w.id === choice)?.savedRoot && (
					<p className="creation-hint">
						Suggested from a pane’s directory. Confirm the workspace root before starting Pi.
					</p>
				)}
		</div>
	);
}

function WorkspaceSelect({
	catalog,
	value,
	onChange,
}: {
	catalog?: CreationCatalog;
	value: string;
	onChange: (value: string) => void;
}) {
	const linked = new Set(catalog?.emidev.workspaces.map((w) => w.workspaceId).filter(Boolean));
	return (
		<label>
			Workspace
			<select
				required
				disabled={!catalog}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="" disabled hidden>
					Choose workspace
				</option>
				{catalog?.workspaces
					.filter((w) => !linked.has(w.id))
					.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name}
						</option>
					))}
				{catalog?.emidev.workspaces.map((w) => (
					<option key={w.root} value={`emidev:${w.root}`}>
						{w.name} · Emidev
					</option>
				))}
			</select>
		</label>
	);
}

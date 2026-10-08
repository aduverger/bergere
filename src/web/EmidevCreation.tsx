import { useState } from "react";
import type { CreationCatalog, CreationRequest } from "../shared/creation";

export function EmidevCreation({
	integration,
	disabled,
	submit,
}: {
	integration: CreationCatalog["emidev"];
	disabled: boolean;
	submit: (request: CreationRequest) => void;
}) {
	const [name, setName] = useState("");
	const [repository, setRepository] = useState("");
	const [repositories, setRepositories] = useState<string[]>([]);
	const suggestions = [...new Set(integration.workspaces.flatMap((w) => w.repositories))];
	const add = () => {
		const next = repository.trim();
		if (next && !repositories.includes(next)) setRepositories([...repositories, next]);
		setRepository("");
	};
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				submit({
					kind: "emidev-workspace",
					name: name.trim(),
					repositories: [
						...new Set([...repositories, ...repository.trim().split(/\s+/).filter(Boolean)]),
					],
				});
			}}
		>
			<label>
				Workspace name
				<input
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					required
					value={name}
					onChange={(event) => setName(event.target.value)}
					pattern="[a-z0-9][a-z0-9_-]*"
					maxLength={100}
					placeholder="new_workspace"
				/>
			</label>
			<label>
				Repositories
				<input
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					list="repository-suggestions"
					value={repository}
					onChange={(event) => setRepository(event.target.value)}
					placeholder="emidat-api"
					onKeyDown={(event) => {
						if (event.key === "Enter" && repository.trim()) {
							event.preventDefault();
							add();
						}
					}}
				/>
			</label>
			<datalist id="repository-suggestions">
				{suggestions.map((r) => (
					<option key={r} value={r} />
				))}
			</datalist>
			<button type="button" onClick={add} disabled={!repository.trim()}>
				Add repository
			</button>
			<div className="repository-chips">
				{repositories.map((r) => (
					<button
						type="button"
						key={r}
						aria-label={`Remove ${r}`}
						onClick={() => setRepositories(repositories.filter((item) => item !== r))}
					>
						{r} ×
					</button>
				))}
			</div>
			<p className="creation-hint">Emidev start workspace services before Pi starts.</p>
			{integration.error && <p role="alert">{integration.error}</p>}
			<button
				type="submit"
				disabled={disabled || !!integration.error || (!repositories.length && !repository.trim())}
			>
				Create workspace
			</button>
		</form>
	);
}

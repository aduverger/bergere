![bergere](https://github.com/aduverger/bergere/blob/main/public/icon-192.png)
# Bergère

**Your agents, within reach.**

A private, mobile-first web client for **Pi processes inside Herdr**. React + Vite render the conversation; a Node.js gateway discovers panes through Herdr and communicates with a companion extension over a private Unix socket. TypeScript and Effect Schema define both sides of the protocol. An Effect scope owns gateway lifetime and cleanup.

Herdr owns processes. Pi owns conversation state and session files. The gateway keeps disposable conversation projections and never writes Pi session logs. Creation requests launch a runner in a fresh Herdr pane; Herdr owns that runner and the Pi process.

## Connect your existing local sessions

Building the repository does not install the companion. These are explicit setup steps:

1. Verify `pi --version`, `herdr --version`, and the server's `herdr api snapshot` protocol. Do not upgrade a running installation just to make it match.
2. Build this package, then run `pi install /absolute/path/to/bergere`. This adds the companion alongside Herdr's managed extension; do not replace or edit `herdr-agent-state.ts`.
3. Run `/reload` in an **idle** existing Pi pane. The pane must have been started inside Herdr with its standard `HERDR_ENV`, `HERDR_PANE_ID` and `HERDR_SOCKET_PATH` environment.
4. Start the gateway from this repository:

```sh
BERGERE_LOCAL=1 pnpm start
```

Open `http://127.0.0.1:8787`. If Herdr uses a non-default socket, supply `HERDR_SOCKET_PATH=/absolute/path/herdr.sock` to the gateway. The companion takes its server identity from the pane's environment. A pane without a compatible companion stays visible with disabled controls.

Default bridge: `~/.local/state/bergere/bridge.sock`. Its directory must belong to the current user with mode `0700`; the socket is `0600`. An optional `BERGERE_BRIDGE_SOCKET` must match in the Pi process and gateway environments. The default works without changing existing pane environments.

`pnpm dev` runs Vite on loopback and proxies `/ws` to port 8787. For that workflow start `BERGERE_LOCAL=1 BERGERE_ORIGIN=http://127.0.0.1:5173 pnpm gateway`, then open the Vite URL. The production web client serves built assets and WebSocket from one origin; the optional native client bundles its assets and connects to an explicitly configured gateway.

## Run the server on EC2

Use the same Linux user as Herdr/Pi. Install dependencies, build, and install the companion once:

```sh
pnpm install --frozen-lockfile
make build
pi install "$PWD"
```

Run `/reload` in each idle Pi pane. Then:

```sh
make start    # background gateway + Tailscale Serve on HTTPS 3504
make status   # gateway PID and phone URL
make logs     # follow gateway logs; Ctrl+C only stops following
make stop     # disable Serve on 3504 and gracefully stop the gateway
```

`make start` runs `tailscale whoami --json` and derives:

- `BERGERE_ORIGIN`: `https://<Node.Name without trailing dot>:3504`
- `BERGERE_TAILSCALE_LOGIN`: `UserProfile.LoginName`

After the gateway is ready it configures:

```sh
tailscale serve --bg --yes --https=3504 http://127.0.0.1:8787
```

Open the printed HTTPS URL on your phone with Tailscale connected. Port **3504** is dedicated to this app. `make stop` disables that port only; it does not reset other Serve configuration or stop Herdr/Pi. The local backend remains on **127.0.0.1:8787**. An explicit `BERGERE_PORT` changes the backend port and Serve target together; HTTPS remains 3504.

Tailscale must be connected and this user must have permission to manage Serve. If it requires additional permission or HTTPS setup, startup fails with guidance; the helper does not invoke sudo or change tailnet policy. Restrict destination TCP **3504** in your tailnet policy to your identity, accounting for existing broad allow rules. Do not open public EC2 application ports.

Explicit `BERGERE_ORIGIN` and `BERGERE_TAILSCALE_LOGIN` override discovery; the origin must still use HTTPS port 3504. For a tagged node without a user profile, provide the exact phone user's login explicitly. Missing identity fails closed. The full whoami response is never saved or logged.

The gateway runs detached from your shell. Its PID record and append-only log live in gitignored `.run/`. Repeating `make start` reuses the tracked gateway and reapplies Serve. `make stop` checks the process start time and command before signaling, so stale PID records cannot stop an unrelated process. After changing configuration or rebuilding, use `make stop` then `make start`. This helper does not restart the gateway on crashes or reboot; use the [systemd setup](docs/DEPLOYMENT.md) for that, instead of running both managers.

For local-only background operation, with no Tailscale commands:

```sh
BERGERE_LOCAL=1 make start
make stop
```

`pnpm start` remains the foreground command with explicit environment configuration.

## Create sessions and workspaces

Use **New** in the sidebar:

- **Pi session** selects an existing Herdr space and starts Pi in a new tab. Confirm the root directory when it was inferred from an existing pane.
- **Workspace** accepts a name and an existing absolute root directory (or `~/path`), creates a Herdr space, and starts Pi in its initial pane.

Both work without Emidev. Run `pnpm build` before starting the gateway, including when using Vite development mode, so the terminal runner is available. `pi` must be available in Herdr's terminal PATH, with the Bergère companion installed. New sessions use normal Pi settings; creation does not install extensions or change existing sessions.

Creation continues when the app closes or the gateway restarts. Reopen **New** to check the current operation in the same browser tab. Durable operation records and root associations live under `creation/` beside the bridge socket, scoped to the Herdr socket. Do not delete these records while a launch is in progress. Lost acknowledgements do not trigger automatic retries. For failed or uncertain launches, inspect the retained Herdr pane before manually recovering; dismissing a notice does not cancel or delete the workspace.

### Optional Emidev integration

Emidev is disabled by default. To enable its separate creation form and workspace discovery:

```sh
make stop
BERGERE_EMIDEV=1 make start
```

Keep any other required environment options, such as `BERGERE_NATIVE_ORIGIN=capacitor://localhost`, on that command. For systemd, add `BERGERE_EMIDEV=1` to the gateway environment file and restart the service. Emidev must be configured for the same OS user and available in both the gateway and Herdr terminal PATH.

**Workspace → Emidev workspace** accepts a canonical lowercase name and repository chips. It creates the Herdr space first, runs `emidev workspace create --json -n NAME -r REPO ...` there, and starts Pi at the returned workspace root. Normal Emidev provisioning and service-start defaults apply. No hardcoded workspace directory is used.

Emidev workspaces created from the terminal also appear in the session picker. Associations use resolved directories and saved Herdr IDs, never matching display names. Ambiguous matches require a choice; workspaces without a Herdr space receive one when starting Pi. Failed Emidev discovery does not disable ordinary Herdr creation. Failed provisioning does not start Pi or remove the partial workspace; recover it from the terminal.

## Optional iPhone app

Bergère also has a Capacitor iOS wrapper using the same React UI. It bundles the frontend, hides the keyboard accessory bar, and reconnects to the existing gateway on foreground recovery. The web client remains supported. See [iPhone setup and device validation](docs/IOS.md) for Xcode installation, native-origin opt-in, signing, and build commands. Rebuild the native client after UI changes; the EC2 gateway alone cannot update its bundled interface.

## Build and test locally

Requires Node.js 24+, pnpm 11, Pi 1.0.3 and Herdr protocol 22. The local integration suite was run with Herdr 0.9.3 and Pi 1.0.3. The existing 0.9.1 server exposes protocol 22; it was not modified. Check the actual server protocol before deploying anywhere else. Nothing installs or upgrades the global Pi/Herdr installations automatically.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:browser
```

`pnpm check` runs Biome, type-aware ESLint, strict TypeScript checks, Knip, tests, and the production build. CI runs the same command on pull requests and pushes to `main` using Node.js 24. The browser suite remains a separate local check because it requires Herdr.

- `pnpm lint`: formatting, import organization, React/accessibility rules, complexity (maximum 25), unsafe assertions, unused code, and type-aware promise/control-flow checks.
- `pnpm format`: apply Biome formatting and safe fixes (tabs, double quotes, semicolons, 100-column lines).
- `pnpm typecheck`: strict types, checked indexed access, unused locals/parameters, exhaustive returns, and explicit overrides.
- `pnpm knip`: unused files, exports, and dependencies. Its configuration includes the dynamically loaded Pi companion and test provider; Herdr and Tailscale are external system binaries.

TypeScript is pinned to the 6.0 release line because the current `typescript-eslint` parser does not support TypeScript 7. No TanStack Query, Tailwind, or backend Python rules are included.

Optional Git hooks match the reference repository's pre-commit workflow. With `pre-commit` installed, run `pre-commit install`. The hooks run `pnpm check` for source/config changes and check whitespace, file endings, YAML/TOML, merge conflicts, and oversized additions. Hook installation is explicit and is not performed by `pnpm install`.

The browser suite starts disposable headless Herdr servers with isolated Pi settings and a deterministic local provider. It uses no model credentials or external inference. It tests the actual Pi TUI and companion, not a replacement runtime. Test fixtures are never loaded by the production package. The suite closes its own servers afterward and leaves other Herdr sessions untouched.

To inspect a disposable live session yourself:

```sh
pnpm build
pnpm demo
```

Open `http://127.0.0.1:8788`. Stop with Ctrl+C to remove the disposable session. This is local-only; no Tailscale sharing is configured.

## Behavior

- Desktop workspace sidebar and mobile session drawer with a floating menu button. Minimal conversation view, Lucide controls, and connection/activity status in the sidebar.
- Markdown, code, images, and chronological tool activity. Runs of more than five consecutive tool calls fold into a summary; nested calls remain with their parent before the final answer. Expand the group to inspect individual calls. Reasoning stays in its original message position beside the surrounding text, outside tool groups.
- Browser snapshots carry tool summaries only. Full arguments and results load when an individual tool opens, through the same identity checks and attachment generation. Open running tools refresh at most once per second after each response; closing releases the request and timer. No transcript details are cached offline.
- Codemode groups child calls under their parent and reuses the read/write/edit/bash views. The JavaScript script is collapsed separately; script output is preserved as literal text and images. Full nested results remain available for the companion attachment lifetime. After reload, Pi’s saved child summaries restore arguments and statuses where available, with explicit notices for missing outputs and incomplete traces. When child metadata is absent, completed scripts containing only sequential `text(await tools.read/write/edit/bash({...}))` calls with literal arguments can map one output block per call. Dynamic scripts, mismatched blocks, failed runs, and truncated shell results retain the original script/output view. The fallback parses JavaScript with Acorn; it never executes it.
- Send, steer, follow-up, abort, model and thinking selection.
- Standard confirm/select/input/editor dialogs on both surfaces; the first valid answer resolves the caller and dismisses the other surface. Cancellation and timeout are preserved. Unsupported custom widgets are terminal-only and block web prompts while active.
- Drafts and attachments remain in memory per pane. No service worker, offline transcript cache, or automatic prompt queue.
- Foreground/network recovery reconnects and subscribes for an authoritative snapshot. Commands include attachment generations and IDs. The companion deduplicates during the attachment lifetime. Unacknowledged delivery is reported as uncertain, never replayed automatically.
- Reloads, active-session changes and branch changes create a fresh generation. A reused pane cannot receive commands intended for its old attachment.
- Herdr events invalidate discovery snapshots, including `events_lost`. Subscription happens before the initial snapshot.
- Collapsed tool output and reasoning render only when opened. Composer edits do not rerender the transcript. Hashed frontend assets use private immutable caching; HTML and transcripts are not cached offline.
- Streaming updates send changed message/tool suffixes, preserving unchanged history. Updates coalesce over 50 ms. Slow browser clients reconnect for fresh state. Transport frames are limited to 32 MiB; browser submissions to 24 MiB encoded, individual images to 10 MiB. No transcripts or command contents are logged by the gateway.


## Source layout and references

- `src/shared`: schemas, transcript normalization and revision reconciliation.
- `src/extension`: same-process Pi bridge, command ledger and shared dialogs.
- `src/server`: Herdr discovery, identity checks and gateway.
- `src/web`: responsive React client.

The layout follows the supplied Pi mobile screenshot. [pi-remote](https://github.com/JackDanger/pi-remote), [pi-web](https://github.com/jmfederico/pi-web), [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard) and [pi-termux-mobile](https://github.com/badlogic/pi-termux-mobile) informed the comparison. No source code was copied from those repositories and no runtime-ownership system was imported. Dependency licenses remain with their respective packages.

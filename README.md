# Pi · Herdr

A private, mobile-first web client for **existing Pi processes inside Herdr**. React + Vite render the conversation; a Node.js gateway discovers panes through Herdr and communicates with a companion extension over a private Unix socket. TypeScript and Effect Schema define both sides of the protocol. An Effect scope owns gateway lifetime and cleanup.

Herdr owns processes. Pi owns conversation state and session files. The gateway keeps disposable projections and never launches Pi or writes session logs.

## Build and test locally

Requires Node.js 24+, pnpm 11, Pi 1.0.3 and Herdr protocol 22. The local integration suite was run with Herdr 0.9.3 and Pi 1.0.3. The existing 0.9.1 server exposes protocol 22; it was not modified. Check the actual server protocol before deploying anywhere else. Nothing installs or upgrades the global Pi/Herdr installations automatically.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium webkit
pnpm test:browser
```

The browser suite starts disposable headless Herdr servers with isolated Pi settings and a deterministic local provider. It uses no model credentials or external inference. It tests the actual Pi TUI and companion, not a replacement runtime. Test fixtures are never loaded by the production package. The suite closes its own servers afterward and leaves other Herdr sessions untouched.

To inspect a disposable live session yourself:

```sh
pnpm build
pnpm demo
```

Open `http://127.0.0.1:8788`. Stop with Ctrl+C to remove the disposable session. This is local-only; no Tailscale sharing is configured.

## Connect your existing local sessions

Building the repository does not install the companion. These are explicit setup steps:

1. Verify `pi --version`, `herdr --version`, and the server's `herdr api snapshot` protocol. Do not upgrade a running installation just to make it match.
2. Build this package, then run `pi install /absolute/path/to/pi-mobile-herdr`. This adds the companion alongside Herdr's managed extension; do not replace or edit `herdr-agent-state.ts`.
3. Run `/reload` in an **idle** existing Pi pane. The pane must have been started inside Herdr with its standard `HERDR_ENV`, `HERDR_PANE_ID` and `HERDR_SOCKET_PATH` environment.
4. Start the gateway from this repository:

```sh
PMH_LOCAL=1 pnpm start
```

Open `http://127.0.0.1:8787`. If Herdr uses a non-default socket, supply `HERDR_SOCKET_PATH=/absolute/path/herdr.sock` to the gateway. The companion takes its server identity from the pane's environment. A pane without a compatible companion stays visible with disabled controls.

Default bridge: `~/.local/state/pi-mobile-herdr/bridge.sock`. Its directory must belong to the current user with mode `0700`; the socket is `0600`. An optional `PMH_BRIDGE_SOCKET` must match in the Pi process and gateway environments. The default works without changing existing pane environments.

`pnpm dev` runs Vite on loopback and proxies `/ws` to port 8787. For that workflow start `PMH_LOCAL=1 PMH_ORIGIN=http://127.0.0.1:5173 pnpm gateway`, then open the Vite URL. Production always serves built assets and WebSocket from one origin.

## Behavior

- Desktop workspace sidebar, mobile session drawer, search and activity status.
- Markdown, code, images, collapsed reasoning and expandable tool rows matched by tool-call ID.
- Send, steer, follow-up, abort, model and thinking selection.
- Standard confirm/select/input/editor dialogs on both surfaces; the first valid answer resolves the caller and dismisses the other surface. Cancellation and timeout are preserved. Unsupported custom widgets are terminal-only and block web prompts while active.
- Drafts and attachments remain in memory per pane. No service worker, offline transcript cache, or automatic prompt queue.
- Foreground/network recovery reconnects and subscribes for an authoritative snapshot. Commands include attachment generations and IDs. The companion deduplicates during the attachment lifetime. Unacknowledged delivery is reported as uncertain, never replayed automatically.
- Reloads, active-session changes and branch changes create a fresh generation. A reused pane cannot receive commands intended for its old attachment.
- Herdr events invalidate discovery snapshots, including `events_lost`. Subscription happens before the initial snapshot.
- Streaming updates coalesce over 50 ms. Slow browser clients reconnect for fresh state. Transport frames are limited to 32 MiB; browser submissions to 24 MiB encoded, individual images to 10 MiB. No transcripts or command contents are logged by the gateway.

## Validation and remaining deployment checks

`pnpm test` covers schema validation, revision gaps, command deduplication, dialog races/timeouts, tool reconciliation, HTTP/WebSocket access and pane reuse. `pnpm test:browser` runs desktop Chromium and mobile WebKit against isolated real Pi/Herdr processes, including terminal/browser prompts, dialogs, tools, image input, model controls, reload, session change, abort and restart while streaming. PID assertions verify process ownership stays with Herdr.

Mobile WebKit emulation is not a physical iPhone test. Real Safari/home-screen keyboard placement, image picker, phone sleep/foreground recovery and actual Tailscale identity/header isolation remain device/deployment acceptance checks. See [deployment steps](docs/DEPLOYMENT.md). No EC2 changes or Tailscale sharing were made during local implementation.

Session creation, archived history, terminal emulation, files, multiple hosts and push notifications are outside this version.

## Source layout and references

- `src/shared`: schemas, transcript normalization and revision reconciliation.
- `src/extension`: same-process Pi bridge, command ledger and shared dialogs.
- `src/server`: Herdr discovery, identity checks and gateway.
- `src/web`: responsive React client.

The layout follows the supplied Pi mobile screenshot. [pi-remote](https://github.com/JackDanger/pi-remote), [pi-web](https://github.com/jmfederico/pi-web), [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard) and [pi-termux-mobile](https://github.com/badlogic/pi-termux-mobile) informed the comparison. No source code was copied from those repositories and no runtime-ownership system was imported. Dependency licenses remain with their respective packages.

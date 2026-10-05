# Private Linux deployment (not performed by the build)

Run the gateway as the **same OS user** as Herdr and Pi. Use Node.js 24+ and the supported Pi 1.0.3 / Herdr protocol 22 contracts. Verify the EC2 versions and socket API first; never upgrade live installations automatically. Re-run the isolated integration suite on that host before attaching production sessions.

## Companion and service

1. Copy the repository, install the locked dependencies and run `pnpm build`.
2. Explicitly install it with `pi install /absolute/path/to/pi-mobile-herdr` and `/reload` idle Pi sessions. Keep Herdr's managed extension installed independently.
3. Copy `deploy/gateway.env.example` to `~/.config/pi-mobile-herdr/gateway.env`; replace every placeholder with absolute paths and your exact Tailscale login and HTTPS origin. Do **not** set `PMH_LOCAL=1` in deployment.
4. Copy `deploy/pi-mobile-herdr.service` to `~/.config/systemd/user/`. Replace its repository path and Node executable path. With nvm, use the absolute executable path from `command -v node` rather than relying on an interactive shell.
5. Run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now pi-mobile-herdr.service
systemctl --user status pi-mobile-herdr.service
journalctl --user -u pi-mobile-herdr.service
```

If this user must survive logout, arrange user lingering with the host administrator (`loginctl enable-linger USER`). The service does not start, stop or own Herdr/Pi. Stopping or restarting it leaves the Pi process alive. A stale Unix socket after a crash is removed only after an ownership check and a refused connection probe; an active socket is never replaced.

## Tailscale access

Configure this separately, after reviewing the existing tailnet policy. The gateway binds only `127.0.0.1:8787` and requires the exact `PMH_TAILSCALE_LOGIN` header value plus the configured Host/Origin. Missing/different identity is forbidden on HTTP and WebSocket.

Use [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), not Funnel, for HTTPS to this loopback backend. Serve supplies identity headers and strips user-supplied versions. Same-user local processes remain trusted and can impersonate those headers; this is not authentication against hostile local processes. Tagged client devices do not get user identity headers and will be rejected.

```sh
tailscale serve --https=443 http://127.0.0.1:8787
```

This is a foreground example. Inspect `tailscale serve --help` on the deployment host before configuring persistence. Set `PMH_ORIGIN` to the exact HTTPS URL Serve uses, with no trailing slash. Do not open an EC2 security-group application port or bind the gateway to a tailnet/public address.

Restrict destination TCP 443 on this node to your personal login in the [tailnet policy](https://tailscale.com/docs/reference/syntax/policy-file). **A narrower allow does not cancel an existing broad allow.** Audit all grants/ACLs, groups, tags, shared-node access and wildcard rules covering the node. Restructure broad matching rules before adding the personal rule. Do not overwrite the whole policy from an example.

For a node already appropriately tagged `tag:pi-mobile`, the relevant grant shape is:

```json
{ "src": ["YOUR_LOGIN"], "dst": ["tag:pi-mobile"], "ip": ["tcp:443"] }
```

Adapt the destination to the actual node and preserve unrelated SSH rules. Review tag ownership and its effect on node identity before changing tags. Add policy tests asserting your login can reach that destination and another member cannot. Keep the application identity gate even with network restrictions.

## Acceptance on the actual entry point

- Your phone's authenticated Tailscale identity can load the app and open its WebSocket.
- Another tailnet member is denied by policy; if network access is deliberately allowed for a controlled test, the app still returns 403 for their identity.
- Sending a forged `Tailscale-User-Login` through Serve does not bypass that result. Test **through Serve**, not against loopback (local processes are trusted).
- Missing headers and incorrect browser Origin are rejected; no Funnel/public app endpoint exists.
- Alternate terminal and phone prompts and verify the same Pi PID and transcript.
- Sleep/wake the phone, interrupt its network, restart the gateway mid-run, reload the extension and switch Pi's active session. Verify no prompt replays or stale sends.
- Answer standard dialogs from each surface and verify the other closes once.
- In actual iPhone Safari and Add to Home Screen mode, test the keyboard, safe areas, streaming scroll while reading older messages, image selection, and foreground recovery. The manifest requests standalone display but deliberately adds no offline cache.

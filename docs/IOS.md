# Bergère on iPhone

The optional Capacitor client bundles the same React frontend as the web app. It connects to the existing EC2 gateway over Tailscale. It does not run Pi, Herdr, or a gateway on the phone.

## Prerequisites

- Node.js 24+ and the repository's pnpm version.
- Full Xcode 26+ with iOS support, opened once to finish installation. Command Line Tools alone cannot build this app. See [Capacitor iOS requirements](https://capacitorjs.com/docs/ios).
- An iPhone paired with Xcode, Developer Mode enabled when requested, and an Apple signing team selected in Xcode.
- Tailscale connected on the phone with the identity allowed by the gateway.

The prototype can be installed directly through Xcode. TestFlight and App Store distribution are separate work. No signing account, provisioning profile, or developer team is committed.

## Enable native access on EC2

Update/build the gateway first, then restart it with this explicit opt-in:

```sh
make stop
BERGERE_NATIVE_ORIGIN=capacitor://localhost make start
```

For a systemd user service, add `Environment=BERGERE_NATIVE_ORIGIN=capacitor://localhost` to its configuration and restart the service instead.

Keep the existing HTTPS origin, Tailscale login requirement, Serve configuration, and tailnet policy. Native requests still need the correct Host and Tailscale-injected login. The native origin is not an authentication credential; othser apps can use it too. Missing/different login and other origins remain rejected. Same-user local processes retain the existing trust boundary.

Only the exact native origin receives CORS permission. The frontend uses ordinary HTTPS GET requests and WSS; it does not forge identity headers or use a native HTTP bypass. Public EC2 application ports remain closed. This flag is not needed for the web client.

## Build and install from the Mac

```sh
pnpm install --frozen-lockfile
VITE_BERGERE_GATEWAY=https://alex-dev-1.tailb2ed73.ts.net:3504 pnpm ios:sync
pnpm ios:open
```

`ios:sync` builds the frontend and copies it and the plugin configuration into the generated Xcode project. The gateway is a build-time setting, not a secret. Use a plain HTTPS origin with its port, without a trailing slash, path, or credentials. Missing/invalid configuration produces a visible startup error in the native app. Ordinary browser builds ignore this setting and keep using their own origin.

In Xcode, choose the **App** target, select your signing team under **Signing & Capabilities**, select the connected iPhone, and run. If your team requires a different bundle identifier, update `appId` in `capacitor.config.ts` and the target's bundle identifier together. The initial identifier is `com.aduverger.bergere`.

After signing is configured, `pnpm ios:run` can also run the synchronized build. Always repeat `ios:sync` with the gateway setting after frontend/plugin changes; rebuilding only the EC2 server does not update the installed UI. Run sync after dependency installation so Swift package paths match the pnpm layout.

## Native behavior

- The Keyboard plugin hides the accessory bar and uses a dark keyboard.
- Native WebView resizing owns keyboard geometry. The existing layout reads the resized window height, without subtracting keyboard height a second time. The browser retains its VisualViewport handling.
- Native foreground events reconnect through the existing Connection class, resubscribe, and wait for an authoritative snapshot. No prompts are replayed.
- Drafts and attachments remain in memory. They survive ordinary backgrounding while the process remains alive, but not iOS terminating the app.
- Image attachment selection uses the existing file picker. There is no new camera, notification, background execution, or offline transcript feature.

## Validation before relying on the app

Local checks cover native URL selection, strict origin/identity checks, real HTTP/WS gateway transport with simulated proxy headers, and native-listener cleanup. They do not prove Tailscale proxy behavior or iOS keyboard behavior.

On the actual phone verify:

1. Access succeeds with your Tailscale identity and fails with a different identity or no network route.
2. The accessory bar disappears; keyboard opening/closing and rotation keep the composer visible.
3. Typing, multiline paste, selection, image selection/paste, settings, and dialogs work.
4. Terminal and phone prompts alternate in the same Pi process.
5. Lock/unlock, app switching, network interruption, and gateway restart recover without duplicate prompts; uncertain commands stay explicitly uncertain.
6. Long streaming conversations keep stable scroll position.

The initial implementation was prepared on a Mac with Command Line Tools only. Native compilation, signing, and these device checks remain required; successful web tests or Capacitor sync are not native-build validation.

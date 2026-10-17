# UI rig

Renders every screen of `apps/web` with realistic sample data, without the NestJS API or a database, and takes
screenshots with Playwright. Nothing here touches `apps/web`; this folder is not part of the pnpm workspace
(it has its own `package.json` for Playwright).

## Run it (three terminals, from the repo root)

```sh
# 1. Mock API on :4000 (no dependencies; Node 22+)
node tools/ui-rig/mock-api.mjs

# 2. The web app on :3000 (it forwards /api/* to :4000)
pnpm --filter @home/web dev

# 3. Screenshots (first time only: npm install --prefix tools/ui-rig)
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/ui-rig/shoot.mjs --base http://localhost:3000 --out ui-shots --theme light
```

The `--theme` option takes `light`, `dark` or `both`. Use `--only owner-home,console-overview` to shoot just some routes, and `--list` to print every route.

Each route is saved as `<out>/<name>--desktop|mobile--<theme>.png`: desktop at 1440×900 with scale 1, mobile at 390×844 with scale 2.
`<out>/report.json` records, for each shot, the console errors, page errors, failed `/api` calls, any loader or error box left on screen, and redirects.
It also lists every API path the mock had no fixture for. The script exits with code 1 if any shot has a problem.

Other options:
- `--viewports desktop` limits the viewports.
- `--tall` grows the viewport to the page height instead of taking a full-page capture, so fixed bars sit at the bottom.
- `--settle 800` sets the wait in ms after network idle.
- `--api http://localhost:4000` sets the mock API address.
- `--show-dev-overlay` keeps the Next.js dev badge.

`PLAYWRIGHT_BROWSERS_PATH` defaults to `/opt/pw-browsers` when that folder exists. Playwright is pinned to 1.64.1, which matches the chromium-headless-shell-1248 build there.

## Personas

The cookie `rig_persona` picks who is signed in. `shoot.mjs` sets it for each route. To set it yourself in a browser, run `document.cookie = 'rig_persona=member; path=/'`.
Also set `sb_session=1`, or `/` shows the landing page.

| persona | who |
|---|---|
| `owner` (default) | Fawad Iqbal, owner of Iqbal House (Abbottabad, Asia/Karachi) |
| `member` | Hamza Iqbal, member: Kids room (can switch), Drawing room (can see) |
| `superadmin` | Sana Mirza, super admin of Switchboard Services (self-hosted), no home |
| `installer` | Bilal Ahmed, installer, 4 assigned homes |
| `anon` | not signed in: `/auth/me` returns 401 |

## Mock API notes

- Iqbal House has 5 rooms, 15 devices and 3 boards. The Bedrooms board (`esp-b51e09`) is offline.
- Switching a device (`POST /devices/:id/commands`) and running a scene really change state, so tiles change when clicked.
  `POST /__rig/reset` puts everything back (`shoot.mjs` calls it before each run).
- Any GET path without a fixture is logged to stderr and answered with `[]` (when the path ends in "s") or `{}`.
  `GET /__rig/unknown` lists those paths. Writes the mock does not model return `{ ok: true }`.
- A minimal Socket.IO (WebSocket) endpoint makes the app show "Live connection". It never pushes events.
- Useful ids: devices `d-kitchen-temp`, `d-geyser`, `d-water-tank`; homes `home-iqbal`, `home-chaudhry`;
  tickets `t-1042`; help articles `h-offline`, `h-scenes`.

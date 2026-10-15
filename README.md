# Switchboard — home platform (SaaS)

Control homes from a web app and by voice. ESP8266 boards drive the bulbs and read the sensors. Installer companies run many customer homes from one **platform console**; home owners and their families get their own **home app** with per-room rights. It runs on your PC now and moves to a cloud server later with the same files.

## Who uses it

| Role | Scope | What they get |
|---|---|---|
| **Super admin** | Organization | The console: overview, every home, board inventory, team, roles, audit log, plan & billing |
| **Installer** | Homes assigned to them | *My jobs*: install boards on site, wire devices and pins, set up rooms, send the owner invite |
| **Support** | Every home of the organization | Reads everything (homes, boards, people, audit), changes nothing |
| **Home owner** | One home | Switch everything, scenes, voice, invite the family, rooms; boards and pins read-only |
| **Home admin** | One home | Like the owner, except changing the owner and other admins |
| **Member / Guest** | Rooms shared with them | *Can see*, *Can switch* or (members) *Switch & rename*, room by room |

The full matrix is in the console under **Roles & permissions** and is enforced by the API (`apps/api/src/auth/auth.guard.ts`, `auth.service.ts → resolveHome`).

**A home's life:** a super admin creates the home (and invites its owner) → assigns boards from **Inventory** → the installer powers them on site and presses **Install** → wires lights, sensors and wall buttons (**Configure pins**) → groups them into rooms → the owner accepts the invite. The workspace shows these six steps with what is left.

**A board's life:** *In stock* → *Assigned* (to a home and installer) → *Installed* → or *Faulty*. Add boards to stock by the ID printed at start-up (`esp-xxxxxx`). On a server with a single organization (a self-hosted install), boards that connect go into its stock by themselves.

### Upgrading an existing install

`pnpm db:deploy` applies `20261015000000_saas_organizations`, which keeps everything: all existing homes move into one organization, every existing **owner becomes its super admin** (so you keep every power), each person's home and role become a membership, and boards that were "found, not added" become *Assigned* to their home. Back up first if you want to (`pg_dump`).

### Start with one super admin

```powershell
pnpm --filter @home/api seed -- --email you@company.com --name "Your Name" --org "Your Company" --password "a-strong-password"
```

Creates one organization and its super admin — nothing else (homes, boards and people are added in the console). Without `--password` a random one is printed once. It also removes the old demo organization (`@demo.switchboard` accounts) if it was ever added. Running it again changes nothing.

To **erase everything** and start over with only that super admin, add `--wipe-all` (it asks you to type `WIPE`; `--yes` skips the question). Every organization, home, board, person, log and uploaded firmware is deleted; the database structure stays. Boards that are still powered reconnect and show up in the new organization's stock.

### The website (landing page)

Anyone who isn't signed in sees the landing page at `/` (also at `/welcome`); signed-in people go straight to their home or the console. Its **Book a free visit** form saves a request for the organization that runs the site (the self-hosted one, else the first). They appear in **Console → Visit requests** with a live badge and under *Needs attention*: call or WhatsApp the person, mark *Called* / *Visit booked*, keep notes, and **Create their home** — the request becomes a *Customer* linked to that home. The form is limited to 5 requests an hour per visitor and has a hidden trap field for bots. Texts and photos live in `apps/web/src/components/landing/Landing.tsx`.

### Sign in, invites and the first-run tours

- **Sign in** (`/login`) shows how many tries are left after a wrong password and pauses sign-in for 15 minutes after 5. *Forgot it?* explains that whoever invited you sends a new invite link (there is no email sending yet).
- **New passwords** need 8+ characters, a number or symbol, and must not be a common one — the screens tick these off as you type, and the API enforces the same rules.
- **Invite links** open a page made for the person: a home owner sees their home (rooms, things to control, who set it up); family see the home; staff see the organization, who invited them and what their role can and can't do. People who already have an account just confirm their password.
- **Owner tour** (`/onboarding/home`): the first time an owner opens their home they see its rooms, switch a real light (when a board is online), invite family with room access, choose alerts and add the app to their home screen. Staff looking into a home never get it.
- **Company tour** (`/onboarding/company`): a new organization adds its logo, cities and team size, creates a first home with the owner's invite, and invites installers and support. *Finish later* skips it. The super admin made by `seed` gets it too, the first time they open the console. Organizations that existed before this update are marked as done.

Invite links are shown to copy or send on WhatsApp — Switchboard doesn't send email.

### Selling it (SaaS)

- **Sign-up**: `/signup` creates an organization on a 14-day trial when `ALLOW_SIGNUP=true`. It is **off by default** because every board still logs in to the broker with the one shared `MQTT_NODE_PASSWORD`, which the installers of every tenant see in the setup guide. Before opening sign-up to strangers, give each board its own broker login (e.g. a per-board password created when it is added to stock, checked by a Mosquitto auth plugin) so one tenant cannot impersonate another tenant's boards.
- **Plans**: Starter / Pro / Business limit homes, boards and staff (`apps/api/src/platform/plans.ts`). Plan changes apply immediately — **no payment provider is connected yet**; wire one (e.g. Stripe Checkout + a webhook that sets `Organization.status`) before charging.
- **Boards that connect by themselves** go into stock only on a self-hosted install (the organization made by the first-run setup, while it is the only one); on a shared platform they wait until staff add their ID.
- **Isolation**: every query is scoped by the home in `X-Home-Id` (checked against memberships and the staff role's organization) or by the staff member's organization.

```
 Browser / phone ──HTTPS──►  Next.js web (3000) ──/api──►  NestJS API (4000) ──Prisma──► PostgreSQL
                                                              │  ▲
                                         voice + tool calls   │  │ MQTT
                                                              ▼  │
                                              Python voice service (8000)     Mosquitto (1883) ◄──MQTT── ESP8266 boards
```

| Folder | What | Tech |
|---|---|---|
| `apps/api` | The only writer to the database and the only broker client: sign-in, rights, boards, devices, commands with acknowledgement, history, live updates | NestJS 11, Prisma 6, mqtt.js, Socket.IO |
| `apps/web` | Platform console (homes, inventory, team, roles, audit, billing) and the home app (devices, scenes, voice, diagnostics, people) | Next.js 15, React 19 |
| `apps/mobile` | The home app for phones (owners, family, guests): Home, Rooms, Routines, Me and Ask by voice — same accounts and live updates as the web | Flutter, Riverpod, go_router |
| `apps/assistant` | Speech to text, the AI with device tools (acting with the speaker's rights), text to speech | Python, FastAPI, faster-whisper, Ollama or Claude, Piper |
| `firmware/home_node` | One firmware for every board; devices and pins come from the web app | ESP8266 Arduino, PubSubClient, WiFiManager |
| `packages/contracts` | The shared language: MQTT topics and payloads, board pin rules, device types | TypeScript + zod |
| `infra` | Docker Compose (Postgres, Mosquitto; cloud: Traefik + all apps), broker config | |
| `tools/fake-node` | A pretend board speaking the same MQTT protocol, to test without hardware | Python |

---

## Run it on your Windows PC

### 1. Install once

- **Docker Desktop** (with WSL 2) — runs Postgres and Mosquitto
- **Node.js 22 LTS** — then in a terminal: `npm install -g pnpm`
- **Python 3.11+** (you already have it for the old assistant)
- **Ollama** with a model (`ollama pull qwen2.5:3b`), or a Claude API key
- **Arduino IDE 2** for the board (see `firmware/README.md`)

### 2. Settings

```powershell
cd home-platform
copy .env.example .env
notepad .env        # change every "change-me" (passwords, JWT_SECRET, ASSISTANT_SHARED_SECRET)
```

Make the database password in `DATABASE_URL` match `POSTGRES_PASSWORD`.

### 3. Database, broker, API and web

```powershell
pnpm install
pnpm infra:up       # Postgres + Mosquitto in Docker
pnpm db:deploy      # create the tables
pnpm dev            # API on :4000 and web on :3000, reloading on every save
```

### 4. Voice assistant (second terminal)

```powershell
cd apps\assistant
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy ..\..\..\pi-voice-assistant\voices\en_US-lessac-medium.onnx* models\    # your Piper voice
python -m assistant.main
```

**Fast by design:** everyday commands — "bulb on", "batti band karo", "fan off in 10 minutes", "timer 1 minute: bulb on", "turn on the fan for 10 minutes", "every day at 11 pm turn off the lights", "what's on", "temperature?", "cancel all timers", a scene's name — are understood without the AI and answered in milliseconds (`apps/assistant/assistant/quick.py`). Anything else (conditions like "if", chit-chat, unusual wording) goes to the AI; when the AI only switches or schedules something, the reply comes straight from the result instead of a second AI round. The model is loaded when the assistant starts and kept in memory. Turn these off with `QUICK_COMMANDS=false` / `FAST_REPLIES=false`.

### 5. Use it

1. Open **http://localhost:3000** → first run: create your organization, account and home (you are its super admin and owner).
2. **No board yet?** Third terminal: `pip install paho-mqtt` then `python tools\fake-node\fake_node.py`. Type `press D5` in it to "press the wall button". It appears in **Inventory → In stock**.
3. **Inventory** → pick the board → **Assign** it to your home → open the home → **Boards** → **Install** → **Configure pins** → **Add device**: *Bulb*, Switch, D1 → *Room climate*, DHT22, D2 → **Add wall button**: D5 toggles Bulb.
4. Switch to your home (the card at the top of the sidebar) → **Home** → tap the bulb, or tap the mic / type *"turn on the bulb"*.
5. **People** → **Invite someone**, pick their rooms, open the link in another browser.

The real board: flash `firmware/home_node` and follow `firmware/README.md` (setup page: server = your PC's IP, port 1883, login `node`, password `MQTT_NODE_PASSWORD`, encrypted `no`).

**From your phone on the home Wi‑Fi:** open `http://<your-PC-IP>:3000` and add that address to `WEB_ORIGIN` in `.env` (comma separated) for live updates. Tapping works; the **microphone needs HTTPS**, so on the phone voice works once it runs in the cloud with your domain (on the PC, `localhost` counts as secure).

### 6. The phone app (optional)

Install [Flutter](https://docs.flutter.dev/get-started/install), then:

```powershell
cd apps/mobile
flutter pub get
flutter run          # pick your phone or an emulator; enter http://<this PC's IP>:4000 when it asks for the server
```

`flutter build apk --release` makes an Android app to install. See `apps/mobile/README.md` for how it is built and how to extend it.

### Everything in Docker instead

```powershell
pnpm infra:all      # builds and runs postgres, mosquitto, api, web, assistant, adminer (:8081)
```

The assistant container reaches Ollama on your PC through `host.docker.internal`.

---

## Tests

```powershell
pnpm test                                   # contracts + API unit tests
pnpm --filter @home/api test:e2e            # full flow with a fake board: needs `pnpm infra:up`, stop `pnpm dev` first; EMPTIES the database
cd apps\assistant; python -m pytest         # voice service
```

The end-to-end test runs the real API, database and broker with a fake board and a live-update client: setup, board discovery, adoption, pin validation, acknowledged commands, sensor readings, family rights, the wall button, and a board going offline.

### On GitHub: test every push, deploy `main` automatically

`.github/workflows/ci-cd.yml` runs all of the above on every push and pull request (plus the phone app and
the firmware when they change), and when `main` is green it deploys to the server: code over SSH, a database
backup, `infra/deploy-server.sh`, then a health check of https://home.fawadiqbal.dev. One-time setup (an SSH
key and two GitHub secrets): [docs/ci-cd.md](docs/ci-cd.md).

---

## How the parts talk

**Boards ↔ server: MQTT** (`packages/contracts/src/topics.ts`)

| Topic `home/v1/nodes/{nodeId}/…` | From → to | Retained | Payload |
|---|---|---|---|
| `status` | board → all | yes | `{"online":true,"fw","ip"}`; the broker's Last Will sets `{"online":false}` |
| `announce` | board → server | yes | `{"board","fw","mac","ip"}` — lists the board under New boards |
| `config` | server → board | yes | `{"rev","adopted","devices":[{key,type,pin,activeLow,settings}],"inputs":[…]}` |
| `config/applied` | board → server | no | `{"rev","ok","error?"}` |
| `devices/{key}/set` | server → board | **no** | `{"cid","on":true}` |
| `devices/{key}/state` | board → all | yes | `{"on":true,"src":"remote","cid"}` or `{"temperature","humidity","src":"sensor"}` |
| `telemetry` | board → server | no | `{"rssi","heap","uptime"}` |
| `cmd` | server → board | no | `{"action":"reboot"}` |

Each board logs in as `node` with its node id as MQTT client id; the broker lets it use only its own topics (`infra/mosquitto/acl`).

**Apps ↔ server: REST + Socket.IO** at `/api` and `/socket.io`. Sign-in uses httpOnly cookies (15‑minute access token, rotating 30‑day refresh token). The voice service is called only by the API, with a shared secret and a 2‑minute token for the person speaking, which its device tools send back to the API — so voice can never do more than that person could in the app.

**Rights:** see *Who uses it* above. Inside a home, owners and admins see every room; members and guests get *Can see*, *Can switch* or (members) *Can switch and rename* per room. Devices without a room are visible to owners and admins only. Boards, pins and firmware are changed only by super admins and the home's installer.

---

## Adding things

| To add… | Change |
|---|---|
| A device on a board | Web app → Boards → Add device. No code. |
| A new kind of device (dimmer, curtain, PIR) | `packages/contracts/src/device-types.ts` (type, pin use, settings schema, state fields) + a `Device` subclass and one line in `firmware/home_node/src/devices/DeviceFactory.cpp`. The API, web forms, cards and assistant pick it up from the catalog |
| A tool for the assistant | A `Tool` subclass in `apps/assistant/assistant/tools.py`, added in `build_tools()` (and, for an instant answer without the AI, a phrase in `quick.py`) |
| An API feature | A controller + service in `apps/api/src/<feature>/`, registered in `app.module.ts`; schema changes in `prisma/schema.prisma` then `pnpm db:migrate` |
| A Python service | `apps/<name>/` shaped like `apps/assistant`, calling the API with its own token |

## Going to the cloud

1. A VM with Docker, a domain with DNS for `home.your-domain` and `mqtt.home.your-domain` pointing at it.
2. Copy the repository and `.env`; set `DOMAIN`, `ACME_EMAIL`, `WEB_ORIGIN=https://<DOMAIN>`, `COOKIE_SECURE=true`.
3. `docker compose --env-file .env -f infra/docker-compose.yml --profile cloud up -d --build`
4. On each board's setup page: server `mqtt.<DOMAIN>`, port `8883`, encrypted `yes`.

Traefik gets the certificates; only ports 80, 443 and 8883 are open.
# smart-home-automation

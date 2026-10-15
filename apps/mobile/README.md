# Switchboard — the home app (Flutter)

The phone app for owners, family and guests, built from the **Home App v2** design. It talks to the
same API as the web app (`apps/api`): same accounts, same permissions, live updates over the same socket.

| Tab | What's there |
| --- | --- |
| **Home** | Greeting over your living room, what's on (+ **All off** with Undo), home health, scenes, favourites, rooms, *Just now* |
| **Rooms** | Every room you can use → a room: All on / All off, its devices (switches and sensors) |
| **Routines** | Scenes (one tap, with Undo) and schedules (switch on/off, long-press to delete) · **+** new routine |
| **Me** | Family & invites (owners/admins), home health, activity, message your installer, alerts, appearance, sign out |
| 🎤 | **Ask Switchboard**: tap and speak (Urdu, English or both) or type — answers can be read aloud |

Tap a tile to switch it; the arrow (or a long press) opens its sheet: a big switch, *Turn off automatically*
(15 min … 2 hours, a real one-off schedule), what to say to the assistant, and its recent history. The star
puts it on the Home tab.

## Run it

```bash
cd apps/mobile
flutter pub get
flutter run                                   # a phone or emulator; asks for your server address on first start
flutter run --dart-define=SERVER_URL=https://home.example.com   # skip that question (a build for one company)
flutter build apk --release                   # Android (sign it with your own key before publishing)
flutter build ipa                             # iOS (needs a Mac and your Apple team)
flutter build web --release                   # optional: serve build/web from the same address as the API
```

The server address is the one people open in the browser (e.g. `https://home.example.com`), or the API
directly on the home network (`http://192.168.1.20:4000`). Plain `http` is allowed for local networks.

Tests: `flutter test` (models, formats, device kinds, tiles) · `flutter analyze` (strict lints).

## How it's built

```
lib/
  main.dart, app.dart            start-up: preferences + cookie store, theme, router
  core/
    config/      server address, light/dark — remembered on the phone
    network/     ApiClient (dio): cookie session, one shared token renewal on 401, X-Home-Id, ApiException
    realtime/    LiveClient (Socket.IO): device.state, node.status, schedules.changed… as a stream
    routing/     go_router: sign-in redirects, 4 tabs (StatefulShellRoute), pages inside any tab, Ask overlay
    theme/       the design's colour tokens (SbColors, light + dark), type, Phosphor icons (SbIcons)
    util/        dates and times in the design's words
  data/
    models/      plain immutable classes with forgiving fromJson (a missing field never crashes a screen)
    repositories/ one per area (auth, devices, automation, activity, people, home, assistant) — the only code that knows URLs
  state/         Riverpod providers: session, devices (live + optimistic), automation, activity, favourites, toasts, derived room/health summaries
  features/      one folder per screen area: home, rooms, devices, routines, activity, health, family, me, assistant, auth, shell
  shared/widgets/ design-system pieces: Pressable, SbSwitch, Segmented, SbChip, sheets, notes, empty/error/loading
```

**Rules that keep it scalable**

* Screens never call the API; they read providers and call notifier methods. Providers never build URLs;
  repositories do. A new endpoint = one repository method + one provider.
* Everything about the open home watches `currentHomeIdProvider`, so switching homes reloads it all.
* Live updates patch state in place (`DevicesController`), with an optimistic switch that rolls back and
  shows the server's message if the board doesn't confirm.
* **New device types**: add a `DeviceKind` to `DeviceKinds.registry` (`features/devices/device_kinds.dart`) —
  icon, status text, toggleable or not, alarm, assistant phrases. Tiles, sheets, rooms and Ask pick it up.
* **New icons**: one line in `SbIcons` (the Phosphor fonts are bundled; only used glyphs ship in release builds).
* **New screens**: a folder in `features/`, a route in `core/routing` (inside tabs via `_insideTab()` if it
  should keep the tab bar), and `context.openInTab('…')` to open it.

## What it uses from the API

`/auth/*` (cookies, refresh, home switch) · `/devices`, `/devices/:id/commands`, `/devices/:id/history` · `/rooms` ·
`/scenes`, `/scenes/:id/run` · `/schedules` · `/events` (who switched what — added for this app) · `/users`, `/invites` ·
`/notifications/prefs` · `/home/welcome`, `/home/support` · `/assistant/chat`, `/assistant/voice` · Socket.IO.

Not in the design's way yet: guests with an end date (the API has no expiry), "things left on when
everyone's out" and the weekly summary (no server support) — the alerts screen shows the real settings instead.
Push notifications to phones need Firebase/APNs set up for your company; the in-app alerts work without it.

Fonts (Geist, Instrument Serif — OFL) and Phosphor icons (MIT) are bundled under `assets/fonts`.
Hero photo: Maximilian Bungart / Unsplash.

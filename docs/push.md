# Phone notifications (Firebase Cloud Messaging)

The phone app gets notices (a water leak, a door while you're away, a guest's access ended, everyone left…)
as Android notifications even when it's closed. They go through Google's Firebase Cloud Messaging (FCM).
The same notices still appear in the app's bell and in the web app, and browsers keep getting Web Push.

Everything is built in and **switched off until two files are added**:

| File | Where it goes | What it does |
| --- | --- | --- |
| `google-services.json` (from Firebase, for the Android app) | `apps/mobile/android/app/google-services.json` | Lets the phone app get a push token. Without it the app builds and runs, with no push. |
| The service account key (a `.json` file) | Not in the repository: base64 of it in the server's `.env` as `FCM_SERVICE_ACCOUNT` | Lets the API send. Without it the API keeps the phones' tokens and sends nothing (no errors). |

Each person still decides what they get: the switches on the Me screen (phone) and the Notifications page
(web) apply to push too. Alerts (a leak, away-mode alarms) come with high priority on the "Alerts" channel;
everything else is quieter on "Notices".

## 1. The Firebase project

1. Open https://console.firebase.google.com and pick the project (or create one; Analytics is not needed).
2. **Add app → Android.** Package name: `com.switchboard.switchboard_home` (exactly; it's the
   `applicationId` in `apps/mobile/android/app/build.gradle.kts`). The SHA-1 is not needed for push.
3. Download **google-services.json** and put it at `apps/mobile/android/app/google-services.json`.
   - The app's Gradle build applies the Google services plugin **only when this file is there**, so CI and
     other machines without it still build.
   - For CI to build an APK with push, either commit the file (it holds no secret that lets anyone send
     notices: it identifies the app) or add it in the workflow from a repository secret before
     `flutter build apk`.
4. Cloud Messaging is on by default for new projects ("Firebase Cloud Messaging API (V1)" under
   Project settings → Cloud Messaging). The old "legacy" API is not used.

## 2. The server key (service account)

1. Firebase console → **Project settings → Service accounts → Generate new private key**. A `.json` file
   downloads (`project_id`, `client_email`, `private_key`, …). Keep it secret: it can send notices to every
   phone of the app.
2. Turn it into one line (the file has line breaks inside the key, which `.env` files handle badly):

   ```bash
   base64 -w0 switchboard-firebase-adminsdk.json     # Linux
   base64 -i switchboard-firebase-adminsdk.json      # macOS
   ```

3. On the server, in `/opt/home-platform/.env`:

   ```
   FCM_SERVICE_ACCOUNT=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50Iiwi...   (the whole base64 line)
   ```

   The JSON itself also works when it is on one line, but base64 is safest.
4. Restart the API: `cd /opt/home-platform && bash infra/deploy-server.sh` (or
   `docker compose -p home -f infra/docker-compose.server.yml --env-file .env up -d home-api`).
   The API log says `Phone push on (Firebase project <id>)`; a bad key says `Phone push off: …` with why.

Locally (`pnpm dev`) put the same line in the repository's `.env`.

## How it works

- The phone app, after sign-in (and after asking for permission on Android 13+), sends its FCM token to
  `POST /api/push/phone` (`{ token, platform, appVersion, replaces? }`), again when Firebase rotates it, and
  `POST /api/push/phone/remove` when you sign out. Tokens are kept in the `PhoneToken` table.
- Every notice goes through `MonitoringService.send` → `PushService.send`, which sends Web Push and FCM in
  the same step, to the people who want that kind of notice.
- The API signs a JWT (RS256) with the service account's key using Node's crypto, swaps it for an access
  token at Google (kept for an hour), and posts each message to the FCM HTTP v1 API
  (`apps/api/src/monitoring/fcm.ts`). No Firebase SDK on the server.
- Tokens Google says are gone (the app was removed, or the token changed) are deleted at once.
- A tap on a notification opens the matching screen (the notice's link: a device, the People page, …).
- iPhone: the app builds; push needs an APNs key in Firebase and the iOS app set up there, which isn't done.

## Checking it

- `GET /api/push/devices` (signed in) says how many phones are registered and whether phone push is on.
- Unit tests: `apps/api/test/unit/fcm.test.js` (the key, the JWT, the message, Google's answers).
- End-to-end: `apps/api/test/e2e/people.test.js` (tokens, a notice reaching a fake Google, gone phones).

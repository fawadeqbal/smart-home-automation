# CI/CD: test every push, deploy `main` to the server

`.github/workflows/ci-cd.yml` runs on GitHub Actions.

| When | What runs |
|---|---|
| Every push and pull request | **API + web**: build, type-check, unit tests, the full end-to-end test (real API, Postgres, Mosquitto and a simulated board) · **Voice assistant**: pytest |
| …if `apps/mobile` changed | **Phone app**: `flutter analyze`, `flutter test`, an arm64 APK to download from the run |
| …if `firmware/` changed | **Board firmware**: compiled for NodeMCU; the `.bin` (named after `FIRMWARE_VERSION`) to download from the run |
| Push to `main`, all tests green | **Deploy** to Server B → https://home.fawadiqbal.dev |

The deploy:

1. sends the code to `/opt/home-platform` over SSH (only what the server builds; `.env`, the voice
   models and the database are never touched),
2. backs up the database to `infra/backups/` (last 10 kept) — a new version may migrate it,
3. runs `infra/deploy-server.sh` (builds one image at a time, restarts, waits for the API),
4. checks `https://home.fawadiqbal.dev/api/health` (API, database, broker) and the web page.

A deploy is never cancelled half-way and two never run at once. A failed test means no deploy.
To deploy by hand from GitHub: **Actions → CI/CD → Run workflow**.

## One-time setup

### 1. A key that GitHub uses to log in to the server

In Git Bash on your PC:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/switchboard_deploy -N "" -C "github-actions-deploy"
cat ~/.ssh/switchboard_deploy.pub | ssh opc@145.241.156.60 "cat >> ~/.ssh/authorized_keys"
ssh -i ~/.ssh/switchboard_deploy opc@145.241.156.60 "echo ok"      # must print ok without a password
```

### 2. Secrets in GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `DEPLOY_SSH_KEY` | everything in `~/.ssh/switchboard_deploy` (the file **without** `.pub`, including the BEGIN/END lines) |
| `DEPLOY_HOST` | `145.241.156.60` |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan 145.241.156.60` (recommended: pins the server's key) |

Or with the GitHub CLI:

```bash
gh secret set DEPLOY_SSH_KEY < ~/.ssh/switchboard_deploy
gh secret set DEPLOY_HOST --body 145.241.156.60
ssh-keyscan 145.241.156.60 | gh secret set DEPLOY_KNOWN_HOSTS
```

Defaults you only change if the server changes (Settings → Variables): `DEPLOY_USER` = `opc`,
`DEPLOY_PATH` = `/opt/home-platform`, `PUBLIC_URL` = `https://home.fawadiqbal.dev`.

### 3. The phone app's signing key

Android installs a new APK over an old one only when both are signed with the same key. Create one
key once, keep it safe (a lost key means everyone reinstalls), and give it to GitHub:

```bash
keytool -genkeypair -keystore switchboard-release.jks -storetype PKCS12 -alias switchboard \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 switchboard-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD    # the password you chose
gh secret set ANDROID_KEY_PASSWORD         # the same password
gh secret set ANDROID_KEY_ALIAS --body switchboard
```

Without these secrets CI still builds the APK, signed with a throw-away key (a warning says so).

### Downloads on the Releases page

On `main`, the phone app and firmware jobs (they run when their code changed, or on *Run workflow*)
publish their builds:

- release **builds** (marked latest): `switchboard-home.apk` and `home_node.bin`, always the newest,
  so `…/releases/latest/download/<name>` links never change;
- release **firmware-v2.5.0** etc.: each firmware version, kept.

### 4. Optional: approve each deploy

The deploy job uses the GitHub environment **production**. Settings → Environments → production →
*Required reviewers* makes every deploy wait for your click.

## On the server

Nothing to install. `opc` either runs `docker` directly or through passwordless `sudo` (Oracle Linux's
default); the workflow picks whichever works. `.deployed` in `/opt/home-platform` says which commit is live.

Roll back: push a revert of the bad commit (it deploys like any other), or on the server restore the
backup taken before it:

```bash
cd /opt/home-platform
ls -t infra/backups/                     # newest first
gunzip -c infra/backups/before-<sha>-<time>.sql.gz | docker exec -i home-postgres psql -U home -d home
```

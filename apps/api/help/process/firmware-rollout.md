---
title: Roll out a new firmware version to boards
category: process
audience: staff
tags: [rollout, staged rollout, waves, canary, all boards, firmware, rollout, OTA, update, upload build, FIRMWARE_VERSION, bin, release, super admin, installer, update available]
published: true
---
All boards run the same firmware (`firmware/home_node`). Updates go **over Wi-Fi**: to every board at once with a **staged rollout**, or to one board from its **Firmware** tab. Boards need firmware **2.2 or newer** for this. Older ones are flashed once over USB.

## 1. Build (super admin / developer)

1. Raise `FIRMWARE_VERSION` in `firmware/home_node/config.h` (for example `2.2.1` → `2.2.2`). The number is stamped into the file and is what boards report after installing it.
2. In Arduino, use **Sketch → Export Compiled Binary** to get `build/…/home_node.ino.bin`. When `firmware/` changes, CI also compiles a `.bin` named after the version, which you can download from the GitHub Actions run.

## 2. Upload once (super admin)

1. Open any board → **Firmware** → **Upload build**.
2. Drop the `.bin` in. The version is read from the file. Add short notes, which owners and installers see next to it.
3. Each version can be uploaded once. The build is then available to every board in the organisation.

## 3. Roll it out to every board (super admin)

1. In the console, open **Firmware** and press **Roll out** next to the build.
2. Choose **Boards per wave** (default 5), how long to **watch each wave** (default 30 minutes) and **Stop after this many failures** (default 1). Keep **Only in the daytime** (10 am – 5 pm at each home) and **Skip boards with weak Wi‑Fi** on unless you have a reason not to.
3. Press **Start**. The online board with the strongest signal goes **first**. When it's running the new version, the rollout waits the watch time, then sends the next wave. A home's boards go in the same wave.

While it runs, **Firmware** shows each board: **Waiting**, **Updating…**, **Updated**, **Failed** or **Skipped** (offline or weak Wi‑Fi).

- If a board fails (it reports an error, comes back on another version, or doesn't answer within 10 minutes), the rollout **stops**. Super admins get a notification. Look at that board's **Live log**, then press **Go on** or **Cancel**.
- **Pause** holds it. **Retry skipped** sends the build to the boards that were skipped or failed, as one more wave.
- Only one rollout runs at a time. Boards already on the version are left out.

## 4. Install on one board

1. Open a board → **Firmware**. Boards on an older version show **Update available** (and an "x.y.z available" chip in board lists).
2. Press **Install x.y.z** and confirm **Update <board> to x.y.z?**
3. The board downloads, checks, installs and restarts in about **30–60 seconds**. Progress: **Sent to the board → Downloading & checking → Restarting → Running x.y.z**.
4. During this time the board is offline for a few seconds. Lights keep their last state. Devices, pins and Wi-Fi are unchanged.

Installers can install builds on boards in their own homes. Super admins can install on every board.

## Suggested order (installing by hand)

- Install on **one** board first, ideally at your own place or a test home. Watch its **Live log** and **Overview** for an hour.
- Then update the other boards home by home, preferably when the family isn't relying on them, for example in the daytime.
- Don't update a board with a weak signal. Fix the Wi-Fi first.

## Going back

An older build in the list has a **Roll back** button, which installs it the same way. If an install fails, the board keeps its old firmware. See "A firmware update failed".

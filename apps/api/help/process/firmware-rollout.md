---
title: Roll out a new firmware version to boards
category: process
audience: staff
tags: [firmware, rollout, OTA, update, upload build, FIRMWARE_VERSION, bin, release, super admin, installer, update available]
published: true
---
All boards run the same firmware (`firmware/home_node`). Updates go **over Wi-Fi**, one board at a time, from each board's **Firmware** tab. Boards need firmware **2.2 or newer** for this. Older ones are flashed once over USB.

## 1. Build (super admin / developer)

1. Raise `FIRMWARE_VERSION` in `firmware/home_node/config.h` (for example `2.2.1` → `2.2.2`). The number is stamped into the file and is what boards report after installing it.
2. In Arduino, use **Sketch → Export Compiled Binary** to get `build/…/home_node.ino.bin`. When `firmware/` changes, CI also compiles a `.bin` named after the version, which you can download from the GitHub Actions run.

## 2. Upload once (super admin)

1. Open any board → **Firmware** → **Upload build**.
2. Drop the `.bin` in. The version is read from the file. Add short notes, which owners and installers see next to it.
3. Each version can be uploaded once. The build is then available to every board in the organisation.

## 3. Install

1. Open a board → **Firmware**. Boards on an older version show **Update available** (and an "x.y.z available" chip in board lists).
2. Press **Install x.y.z** and confirm **Update <board> to x.y.z?**
3. The board downloads, checks, installs and restarts in about **30–60 seconds**. Progress: **Sent to the board → Downloading & checking → Restarting → Running x.y.z**.
4. During this time the board is offline for a few seconds. Lights keep their last state. Devices, pins and Wi-Fi are unchanged.

Installers can install builds on boards in their own homes. Super admins can install on every board.

## Suggested order

- Install on **one** board first, ideally at your own place or a test home. Watch its **Live log** and **Overview** for an hour.
- Then update the other boards home by home, preferably when the family isn't relying on them, for example in the daytime.
- Don't update a board with a weak signal. Fix the Wi-Fi first.

## Going back

An older build in the list has a **Roll back** button, which installs it the same way. If an install fails, the board keeps its old firmware. See "A firmware update failed".

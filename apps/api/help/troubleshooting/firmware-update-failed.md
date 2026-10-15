---
title: A firmware update failed or the board still shows the old version
category: troubleshooting
audience: staff
tags: [firmware, OTA, update failed, over the air, version, FIRMWARE_VERSION, bin file, roll back, installer, update nahi hua]
published: true
---
Firmware updates go over Wi-Fi from the board's **Firmware** tab in the console. The board downloads the build, checks it, installs it and restarts. That takes about 30–60 seconds, through four steps: **Sent to the board → Downloading & checking → Restarting → Running x.y.z**. If anything goes wrong **before** the switch-over, the board keeps running its old firmware. Its devices, pins and Wi-Fi are never changed by an update.

## The Install button is greyed out

| Reason shown | Fix |
|---|---|
| The board is offline | Get it online first (power, Wi-Fi). |
| Needs firmware 2.2 or newer on the board | Older boards must be flashed once over USB with Arduino. |
| An update is running | Wait for it to finish. |
| Doesn't fit in the board's free space | The build is too big for this board. |

## "The board said: … It keeps running its old firmware."

The download or the check failed. The board's own message is shown.
1. Check the board's signal on its **Wi‑Fi** tab. Weak Wi-Fi often breaks downloads.
2. Check the **Live log** for the download lines ("Board is downloading firmware …").
3. Press **Install** again. Each attempt gets a fresh download link that's valid for 10 minutes.
4. "Set PUBLIC_API_URL in .env so boards can reach this server." means the server doesn't know the address boards should download from. Tell the super admin.
5. "already up to date" means the board already runs that build.

## It restarted but reports the old version

The message is "installed the file and restarted, but reports firmware …". The uploaded file was built without raising `FIRMWARE_VERSION` in `config.h`, so the board is running the new code but reporting the old number.

**Fix (super admin):** raise `FIRMWARE_VERSION`, use **Sketch → Export Compiled Binary** in Arduino, upload the new `.bin` with **Upload build**, then install it.

## Upload errors (super admin)

- "Firmware x is already uploaded…": each version number can be uploaded only once. Raise the number.
- "This file was built as firmware …": the version is read from the file itself. Upload it under that number.
- "This is not an ESP8266 firmware image…": upload the `.bin` that Arduino exported, not the sketch.
- "Too big … at most 1000 KB."

## If the board doesn't come back

Keep it powered for a few minutes. It restarts and reconnects by itself. If it stays offline, check it on site. If the board is unusable, follow "Mark a board faulty and replace it".

To go back to an earlier build, press **Roll back** next to that build in the list.

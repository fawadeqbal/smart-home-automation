---
title: I changed my Wi-Fi or got a new router
category: troubleshooting
audience: everyone
tags: [new router, wifi changed, wifi password changed, new internet, PTCL, router replaced, wifi name, HomeNode, setup page, naya router, wifi password badla, internet change]
published: true
---
Each board remembers the Wi-Fi name and password it was set up with. If those change, the board can't connect and its devices show **Offline**. The wall buttons still work.

## Easiest: keep the same name and password

When the new router is installed, ask the internet company to give it **exactly the same Wi-Fi name and password** as the old one, with a **2.4 GHz** network turned on. The boards then reconnect by themselves within a few minutes. Nothing else is needed.

Boards only use 2.4 GHz Wi-Fi. A network that is 5 GHz only (often named "…5G") won't work.

## Changing the Wi-Fi before you switch it off (installer, remotely)

While a board is still **online**, your installer can move it to a new network from the board's **Wi-Fi** page in the console:
1. **Scan for networks**, then press **Join** next to the new network. Or use **Join a hidden network**.
2. Enter the password and press **Move board**.
3. If the board can't join within 30 seconds, it goes back to the old network by itself, so it never gets stuck.

So if you're planning to change the Wi-Fi, tell your installer **before** you do. Use **Me** → **Message your expert**, or **Diagnostics** → **Send to support**.

## The board is already offline (done at the board)

The board has to be given the new Wi-Fi through its own setup page. This is normally done by your installer, because the board sits behind a switchboard:
1. Restart the board (switch its power off and on, or press **RST**). Then hold the **FLASH** button during the first 3 seconds while the light blinks fast.
2. On a phone, join the Wi-Fi called **HomeNode-xxxxxx** (no password). The setup page opens, or browse to http://192.168.4.1.
3. Tap **Configure WiFi**, pick the new network and type its password. Leave the server fields as they are.
4. Press **Save**. The light goes off once the board is connected.

If nothing is saved within 5 minutes, the board restarts and tries its saved network again.

Don't open a switchboard yourself. Mains electricity can kill. If your installer showed you a board that's safe to reach, they can guide you by phone.

## Afterwards

Check **Home**: the offline banner disappears and the devices can be switched again. Your devices, rooms, timers and scenes are kept. Only the Wi-Fi changes.

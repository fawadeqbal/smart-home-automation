---
title: A device doesn't respond or the switch isn't confirmed
category: troubleshooting
audience: everyone
tags: [not responding, did not respond, no response, not confirmed, switch failed, error, stuck, chal nahi raha, on nahi ho raha, band nahi ho raha, jawab nahi]
published: true
---
When you switch something, the app sends the command to the board and waits for the board to confirm it. If no confirmation arrives within about 3 seconds, the switch is cancelled and you see a message. The tile goes back to its real state.

## What the message means

| Message | What happened | What to do |
|---|---|---|
| "… did not respond. Check that its board is powered and online." (phone: **Not responding — use the wall switch**) | The board got no command through, or didn't answer in time. Usually weak Wi-Fi, or the board was restarting. | Try once more. If it keeps happening, see below. |
| "… is offline: its board is not connected." | The board is offline. | See "A board is offline". |
| "The board refused: …" | The board received the command but couldn't apply it. | Send the message text to your installer. |
| "… is disabled." | Your installer has switched this device off in the setup. | Ask your installer. |
| "You do not have permission to control devices in this room." | You have **Can see** access only. | Ask the home owner for **Can switch**. |

## If it keeps happening

1. Use the wall button for now. It doesn't depend on Wi-Fi.
2. **Owners and admins:** open **Diagnostics** and check the board. **Weak Wi-Fi** (for example below −75 dBm) makes switching slow or unreliable. A Wi-Fi extender near that switchboard usually fixes it. **Low voltage** means the board's power supply needs replacing by your installer.
3. Restart your router if several devices are slow at once.
4. Still failing? Tell your installer: **Me** → **Message your expert** in the phone app, or **Diagnostics** → **Send to support** in the web app.

## The app says "On" but the light is off

A confirmation means the board switched its relay. If the light itself doesn't change, the problem is after the board: the bulb, the wiring or the relay. Try the wall button too. If neither works, ask your installer for a visit. Don't open the switchboard yourself.

## The tile shows the wrong state

Tiles update live. If one looks wrong, reload the page, or pull down to refresh in the phone app. If the sidebar says **Reconnecting…**, your phone or computer has lost its connection to Switchboard (see "The app can't reach the server").

---
title: The wall switch doesn't work
category: troubleshooting
audience: everyone
tags: [wall switch, wall button, push button, button not working, switchboard, deewar ka button, button kaam nahi kar raha, switch dabaya]
published: true
---
In a Switchboard home, a **wall button** is a push-button wired to the board. Each press toggles one device: off becomes on, on becomes off. The board handles it by itself, so it works without Wi-Fi or internet.

## Check these first

1. **Does the device work from the app?**
   - **Yes, the app works but the wall button doesn't:** the button, its wiring or its setup needs your installer.
   - **Neither works:** the problem is power or the board. Check the room's breaker (MCB). If there's power and the app shows the board as **Offline**, see "A board is offline".
2. **Press once, firmly, and wait a moment.** Each press toggles. Pressing twice quickly turns it back.
3. **Has this button ever worked?** Not every device has a wall button. Owners and admins can check **Diagnostics**: every button is listed as "Wall button → device name".

## The app shows the wrong state after using the wall

If the board was offline when you pressed the button, the app catches up when the board reconnects. If it's online and the app still looks wrong, reload the page, or pull down to refresh in the phone app.

## The light came on by itself / turned off by itself

Check the device's **History**. It shows whether the change came from the **Wall button**, the app or voice, a schedule, or **Board restarted** (after a power cut the board puts things back the way they were). A schedule you forgot about is a common cause. Look in **Automations** or the **Routines** tab.

## When to call your installer

If a wall button does nothing while the app works, or it sparks, buzzes or feels warm, stop using it and call your installer. Use **Me** → **Message your expert**, or **Diagnostics** → **Send to support**. If you see sparks or smell burning, switch off that circuit's breaker first.

## For installers

- Buttons are set up on the board page under **Devices & buttons** → **Wall buttons** → **Add wall button**. A button must toggle a switch on the **same board**.
- Wire the push-button between the pin and **G** (ground). The internal pull-up is used, so no resistor is needed.
- **D3** is a boot pin, and so is the setup button. A button on D3 that is held down while the board powers on can stop it starting normally, or open the setup page.

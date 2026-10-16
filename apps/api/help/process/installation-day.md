---
title: Installation day checklist for installers
category: process
audience: staff
tags: [installation report, sign off, signature, photos, checklist, installation, on site, installer, setup page, HomeNode, captive portal, flash, wiring, relay, test, checklist, my jobs]
published: true
---
Before you leave for the job, check that the home is in **My jobs** and its boards are **Assigned** (**Boards** tab, "Awaiting install"). If a board is missing, ask a super admin to assign it from **Inventory**.

## Before you go

- **New boards** are flashed once over USB: in Arduino IDE 2, open `firmware/home_node/home_node.ino`, choose board **NodeMCU 1.0 (ESP-12E)** and **Upload**. After that, updates go over Wi-Fi.
- On the home's **Boards** tab, open **How to connect a board on site**. It shows the server address, port, board login, board password (**Show**) and whether to use encrypted. You'll type these into each board.
- Get the customer's **2.4 GHz Wi-Fi name and password**.

## On site, for each board

1. **Wire it with the breaker off.** Relay IN to the chosen pin (D1 is the best first choice). Relay VCC to VIN, GND to GND. Mount everything in a closed enclosure. Test with an LED or a 12 V lamp before connecting mains.
2. **Power it.** The blue light blinks fast. A board that has never been set up opens its setup hotspot by itself. For one that has, hold **FLASH** during the first 3 seconds after power-on.
3. On your phone, join **HomeNode-xxxxxx** (no password). The setup page "Home board setup" opens, or browse to http://192.168.4.1.
4. Tap **Configure WiFi**, pick the home's Wi-Fi and enter its password. Fill in **Server address**, **Port**, **Board login**, **Board password** and **Encrypted** exactly as shown in the console. Press **Save**.
5. The light goes **off** once it's connected. Slow blinking means it has Wi-Fi but can't reach the server: check the server fields. Fast blinking means no Wi-Fi: check the network and password. If nothing is saved within 5 minutes, the setup page closes and the board restarts.
6. In the console, the board changes to **Online · ready to install**. Press **Install** and name it after where it is.
7. **Devices & buttons** → **Add device** for each light, fan, socket or sensor, and **Add wall button** for each push-button. Add the names the family uses under **Other names for voice** (for example "batti", "tube light").

## Before you leave

- Check the board's signal on its **Wi-Fi** tab. Below about −75 dBm, switching can lag. Suggest an extender near that switchboard.
- Put every device in a room (**Rooms** tab). Devices without a room are hidden from family members.
- Test every device **from the app and from the wall**, and once by voice.
- Show the owner which wall buttons do what.
- Workspace **Overview → Setup** should show steps 1–5 done.
- **Send owner invite** (see "Hand the home over to the owner").

## The installation report and sign-off

Every job ends with a signed report. Open the home in the console → **Installation** tab.

1. **Checklist.** Tick each item as you finish it. Some items show live facts from the boards, for example "3 of 3 boards online" or "0 of 3 switches confirmed from the app". A red line means it isn't true yet: fix it before you tick.
2. **Photos.** Press **Add photo** to take or choose one, with an optional caption. Take one of each board in its box, the DB, and the finished switch plates. You can add up to 40.
3. **Notes.** Write anything the customer or the team should know, for example "Router moved to the hallway".
4. **Sign-off.** When every item is ticked, hand your phone to the customer. They write their name, sign with a finger, and press **Sign off the installation**. The owner can also sign later from their own app (**Help requests → Installation report**, or the card on their home page).

After signing, the report is a record: the checklist and photos can't be changed. A super admin can press **Open again**; then the customer signs again. Press **Print** for a paper copy.

Never leave a board exposed or wiring unenclosed. See the electrical safety policy.

---
title: Mark a board faulty and replace it
category: process
audience: staff
tags: [faulty board, replace board, broken, dead board, repair, return to supplier, inventory, swap, board kharab, board badalna]
published: true
---
## Before you mark it faulty: write down its setup

Marking a board faulty **deletes its devices and wall buttons**. The replacement board doesn't inherit them. First, note what's on it:
- **Diagnostics** (or the board's **Pin map** / **Devices & buttons**): each pin, what it drives, its type, room and **other names for voice**, and "Switches on LOW" or HIGH.
- Timers, schedules and scenes that use these devices will show "Removed device" afterwards and fail. Note which ones the family uses, so they can be recreated.

## Mark it faulty (super admin)

1. **Inventory** → pick the board.
2. If it's installed: **Mark faulty (takes it out of the home)**. If it's in stock: **Mark faulty**.
3. Under **What's wrong?**, describe the fault, for example "Relay on D1 stuck on". Press **Mark faulty**.

The board leaves the home and is sent an empty configuration. Its devices disappear from the owner's app. A faulty board can't be assigned until it's repaired.

## Replace it

1. **Assign** a board from stock to the same home and installer (see "Take a board from stock to installed").
2. On site, the installer swaps the boards with the breaker off, connects the new one to the Wi-Fi through **HomeNode-xxxxxx**, and presses **Install** with the same name, for example "Kitchen".
3. Re-create the devices and wall buttons from your notes, on the same pins if the wiring is unchanged, with the same names and rooms. The family's voice commands then keep working.
4. Recreate the timers and scenes that used the old devices, or ask the owner to. In **People**, room access is per room, so it's unaffected.
5. Test from the app and the wall.

## Afterwards

- **Repaired · back to stock** returns a fixed board to stock. Its note is cleared.
- **Returned to supplier** removes it from inventory. If it ever connects again, add it back by its ID.
- To take a working board out of a home without marking it faulty, use the board's **⋯** → **Remove from home**. Its devices are deleted and it goes back to stock.

Warranty rules for replacements are in the warranty policy.

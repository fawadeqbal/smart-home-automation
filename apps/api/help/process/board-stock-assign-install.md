---
title: Take a board from stock to installed (stock, assign, install, devices and pins)
category: process
audience: staff
tags: [inventory, stock, assign board, install, adopt, board id, esp, pins, add device, configure pins, NodeMCU, Wemos, super admin, installer]
published: true
---
A board's life is **In stock → Assigned → Installed**, or **Faulty**. Super admins handle inventory. Installers install.

## 1. Into stock (super admin)

- A board that has been flashed and connects to our server appears in **Inventory → In stock** by itself.
- To add boards by hand: **Inventory → Add boards to stock**. Type or scan each **Board ID** (for example `esp-3c71bf`), one per line. The ID is printed when the board starts up, and is part of its Wi-Fi name, **HomeNode-…**. Choose the **Model** and add an optional **Note**, such as the batch.
- "… is not a valid board ID" means letters, digits, - and _ only.

## 2. Assign (super admin)

1. In **Inventory**, pick a board that is **In stock**.
2. Under **Assign to a home**, choose the **Home** and the **Installer** (by default, the home's installer). Press **Assign board**.
3. The home now shows the board as **Awaiting install**, and the installer sees the home in **My jobs**.

**Back to stock** undoes an assignment, as long as the board isn't installed yet.

## 3. Install (installer, on site)

1. Power the board and connect it to the home's Wi-Fi. See "Installation day".
2. In the home's **Boards** tab, the board changes to **Online · ready to install**. Press **Install**.
3. Under **Where is it?**, name it after its place, for example "Living room" (the owner sees this). Check the **Model**: NodeMCU 1.0, NodeMCU v3 / LoLin, or Wemos / LOLIN D1 mini. Press **Install**.

## 4. Devices and wall buttons (installer)

Open the board → **Devices & buttons**:
- **Add device**: choose the type (Switch for a relay, temperature and humidity sensor, on/off sensor, analog sensor). Then choose the **Pin it is wired to**, **Switches on LOW (most relay boards)** or HIGH, the **Room**, and **Other names for voice**. Only free, safe pins are offered.
- **Add wall button**: a push-button between a pin and G that toggles a switch on the same board.
- Each change is sent to the board and applied in about a second. The badge shows **Saving to board…** and then **Settings saved**. If the board is offline, it shows **Will update when online**.
- **Settings refused** ("The board refused its settings: …") means the board rejected the change and kept its old setup. Fix what the message says.

**Pin map** shows what is wired where. Good first choices: **D1** for a relay, **D2** for a temperature sensor, **D5** for a wall button. One board holds at most 12 devices and 8 buttons, and in practice the free pins run out first.

## 5. Finish

Put devices in rooms (**Rooms** tab), test each one from the app **and** from the wall, then hand over to the owner.

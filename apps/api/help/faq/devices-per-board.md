---
title: How many devices can one board control?
category: faq
audience: everyone
tags: [how many devices, board capacity, pins, relays, limit, one board, kitne device, kitni battiyan, ek board]
published: true
---
One board is fitted behind one switchboard and can usually handle **everything on that switchboard**. The limit is the board's connection points (pins). Each light, fan, socket, sensor or wall button uses one pin.

**In practice, per board:**
- up to **8 switched devices** (lights, fans, sockets) if they have no wall buttons, or
- about **5 devices, each with its own wall button**, or
- a mix, for example 4 lights with buttons plus a temperature sensor.

Behind the numbers:
- The board offers **10 usable pins** for devices and buttons (D0–D8 and RX). Some can only drive a relay, and some can only read a button or sensor.
- The software allows at most **12 devices and 8 wall buttons** per board, but the free pins run out first.
- The board's single analog input (A0) is normally used to measure its own power supply, so it isn't free for an analog sensor.

**A home** can have as many boards as it needs, one per switchboard. Every room's devices appear together in the app, whichever board they're on.

Your installer plans the boards at the free visit. To add more devices later, ask from the app: **Me** → **Message your expert**.

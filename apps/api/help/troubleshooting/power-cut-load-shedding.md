---
title: What happens after a power cut or load-shedding
category: troubleshooting
audience: everyone
tags: [power cut, load shedding, light gayi, bijli, UPS, generator, solar, power back, restart, lights came on, bijli wapas aayi, light aa gayi, bijli gayi, kuch nahi chal raha]
published: true
---
## When the power goes

If a board loses power, it stops, and its devices show **Offline** in the app. If the board has power but your router doesn't (for example the board is on UPS and the router isn't), the board keeps working from the **wall buttons**, but the app can't reach it.

## When the power comes back

Each board **puts its switches back the way they were** before the power went:
- What was **off** stays off.
- What was **on** comes back **on**.

The board saves the state of its switches a few seconds after every change. A change made in the last few seconds before the power cut may not have been saved.

The board then reconnects to your Wi-Fi by itself as soon as the router is back. This usually takes a minute or two, longer if the router is slow to start. In each device's **History**, this shows as **Board restarted**.

If you'd rather things stay off when the power returns, switch them off before you leave home or go to sleep, or use a scene such as "Good night".

## Timers during a power cut

Timers and schedules run on the Switchboard server. If a board is offline when a timer is due, that timer fails, and you get a notification that it "did not fully work". It is **not** repeated when the power returns. Daily schedules carry on as normal the next day.

## With UPS or solar

Boards keep working as long as their circuit has power. For the app, voice and timers to keep working too, the **router** also needs power and an internet connection. Ask your installer which circuits the boards are on.

## Still offline after the power is back?

Give it a few minutes, then restart your router. If a room stays offline, see "A board is offline". A power surge can damage a board. If one never comes back, your installer can check and replace it.

## For installers

A relay on pin **D8** that switches on LOW clicks on briefly when the board powers up. Avoid D8 for loads where that matters.

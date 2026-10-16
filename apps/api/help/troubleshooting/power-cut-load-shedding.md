---
title: What happens after a power cut or load-shedding
category: troubleshooting
audience: everyone
tags: [power cut, load shedding, power cut history, when did the power go, outage, internet down, bijli kab gayi, light gayi, bijli, UPS, generator, solar, power back, restart, lights came on, bijli wapas aayi, light aa gayi, bijli gayi, kuch nahi chal raha]
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

## Power cut history and notices

Switchboard works out what happened each time a board comes back:
- The board **restarted with "Power On"**: the power was off. That's a **power cut**.
- The board **stayed on** but couldn't reach the internet: the **Wi-Fi router or the internet** was down.
- It restarted for another reason (an update, a Wi-Fi change, a fault): shown as a **board restart**.

When the power is back, everyone in the home gets one notice, for example: "Power cut at home. No power from 3:10 pm to 4:05 pm (55 min). Everything is back on." Several boards cut at once count as one power cut.

A board that's still offline after **10 minutes** gets a notice to the owner and admins. Shorter cuts only get the notice when they're over.

To see the history:
- **Web app:** the home page shows the last power cut this week. **Diagnostics** → **Power cuts and internet** lists every cut, with times, how long, and totals for 7, 30 or 90 days.
- **Phone app:** **Me** → **Home health** → **Power and internet this week**.
- **Ask the assistant:** "When did the power go?", "How many power cuts this week?", "Bijli kab gayi thi?"

You can turn the power cut notice off in your notification settings ("A power cut at home").

## Timers during a power cut

Timers and schedules run on the Switchboard server. If a board is offline when a timer is due, that timer fails, and you get a notification that it "did not fully work". It is **not** repeated when the power returns. Daily schedules carry on as normal the next day.

## With UPS or solar

Boards keep working as long as their circuit has power. For the app, voice and timers to keep working too, the **router** also needs power and an internet connection. Ask your installer which circuits the boards are on.

## Still offline after the power is back?

Give it a few minutes, then restart your router. If a room stays offline, see "A board is offline". A power surge can damage a board. If one never comes back, your installer can check and replace it.

## For installers

A relay on pin **D8** that switches on LOW clicks on briefly when the board powers up. Avoid D8 for loads where that matters.

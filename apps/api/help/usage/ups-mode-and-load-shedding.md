---
title: UPS mode, load-shedding times and your electricity bill
category: usage
audience: everyone
tags: [ups, inverter, solar, battery, grid, wapda, mains, mains sensor, on ups, load shedding, loadshedding, bijli kab jayegi, light kab jayegi, next cut, schedule, heavy load, ac, iron, geyser, motor, meter reading, meter, units, bill, protected, 200 units, slab, billing day, bijli ka bill]
published: true
---
Switchboard can help with three things Pakistani homes deal with every day: running on a UPS, knowing when the electricity will go, and keeping the bill under control.

## UPS mode (needs a grid sensor)

Your installer can add a **grid sensor**: a small module, wired by an electrician to a circuit that only the grid (WAPDA/K-Electric) feeds, not the UPS. It tells the board whether the grid is on. **Never connect mains directly to the board** — only through the proper sense module.

When the grid goes:
- The home page shows **On UPS/solar since 2:03 pm**.
- Owners and admins get a notice.
- If you picked heavy loads, they're **switched off** to save the battery.
- Switching one of those on while on UPS asks you first ("Switch it on anyway?"). Timers and rules don't switch them on until the grid is back.

When the grid comes back you get **Power back after 58 min**, and the cut is saved in the power history (exactly, from the sensor).

**Set it up (owners and admins):** web app → **Electricity** → **UPS mode**. Pick the heavy loads (an AC, iron, geyser, water motor or kettle; the app suggests them from their names and watts), and choose whether they go **back on** when the power returns or **stay off**.

You can also make rules that start **when the grid goes** or **when the grid comes back** (Automations → New rule, pick the grid sensor).

## When will the electricity go?

Switchboard learns your area's load-shedding from your power cuts over the last 14 days. A time counts when the power went then on at least 5 of those days. A new home also looks at other homes in the same area. You see:
- **Next expected cut: today around 2:00 pm** on the home page.
- The pattern as a day strip on the **Electricity** page.

If your electricity company sends the schedule by SMS, type it in (Electricity → **Load-shedding times** → **Type our schedule**). It can differ by day. A typed schedule is used instead of the learned one.

Want a heads-up? Turn on **"Load-shedding is due in about 15 minutes"** in your notification settings. You'll get "Electricity may go at 2:00 — run the motor or iron now". It's off unless you turn it on.

Ask the assistant: "When will the light go?", "Bijli kab jayegi?"

## Your bill from meter readings (owners and admins)

Your meter isn't connected to Switchboard, but you can type its number:
1. Open **Electricity** → **Bill this month**.
2. Press **Add a reading** and type the kWh number on the meter, with the date.
3. Set your **billing day** (the day the meter reader comes, the 1st unless you change it).

You see the units used since the billing day, where you'll be at this pace by the next billing day, and the bill. Use one price per unit, or slabs (for example the first 100 units at one rate, the next 100 at another).

**Protected limit:** a home that stays at **200 units or below** a month gets the cheaper protected rates. Switchboard warns owners and admins once a month when you're getting close or heading past it, and names the devices that used the most. You can change the limit or turn it off.

Good to know:
- A reading lower than the one before is refused: a meter only counts up. If your meter was replaced, tick **New meter**.
- If a reading is missing, the days without one are filled in with the estimates from your switches, and the app says so.
- You can edit or delete readings. A reminder on the billing day is available in notification settings (off unless you turn it on).

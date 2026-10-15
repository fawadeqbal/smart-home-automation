---
title: A sensor shows no reading or an old reading
category: troubleshooting
audience: everyone
tags: [sensor, temperature, humidity, no reading, dash, DHT22, door sensor, leak sensor, motion, wrong reading, temperature nahi aa raha, sensor kharab]
published: true
---
Sensors send their readings through the board they are wired to. A temperature sensor normally sends a new reading every 30 seconds. Door, window, motion and leak sensors report as soon as something changes.

## What you might see

- **"No reading yet"** (phone app) or **"–"** (web app): the sensor hasn't sent anything since it was added, or since the board restarted.
- **"Updated 2 hours ago"**: readings have stopped arriving.
- The tile says **Offline**: the board itself is offline (see "A board is offline").
- The **Inside** figure on Home is the average of your temperature sensors. With no readings, it shows "–".

## What to try

1. **Check the board.** If the board is offline, its sensors can't report. Fix that first.
2. **Give it a minute after a power cut.** After a restart, the first temperature reading comes a few seconds later. An odd failed reading is ignored and the sensor simply tries again.
3. **Look at the history.** Open the sensor's **History** to see when the last good reading came in. A sudden stop usually points to a loose wire.
4. **A door, window or leak sensor that never changes** may be loose or out of line with its magnet. Your installer can check it.

## When to call your installer

If the board is online but a sensor still shows nothing, or the readings are clearly wrong (for example far off from a thermometer in the same room), it needs checking on site. Send it from **Me** → **Message your expert**, or **Diagnostics** → **Send to support**.

## For installers

- **Live log** on the board's page: choose *All* to see sensor readings (debug lines). After three failed reads in a row, the board writes "no reading from the sensor on GPIO … (check wiring)".
- **DHT22 / DHT11:** VCC to 3V3, DATA to the configured pin. A bare 4-pin sensor needs a 10 kΩ resistor from DATA to 3V3. Check that the model chosen in the device form matches the part.
- **Analog sensors on A0** can't be used while the firmware measures the board's supply voltage. The board rejects the setup with "A0 is measuring the board's supply voltage…".
- **Contact sensors:** check the "Pin is connected to GND" or "Pin goes HIGH (PIR motion module)" choice.

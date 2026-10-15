---
title: The app can't reach the server or keeps saying Reconnecting
category: troubleshooting
audience: everyone
tags: [can't connect, server, reconnecting, offline, you're offline, no internet, app not loading, server address, connection error, app nahi khul raha, internet nahi, connect nahi ho raha]
published: true
---
The apps talk to the Switchboard server at **https://home.fawadiqbal.dev**. Your home's boards talk to it too. If your phone or computer can't reach it, you can't switch from the app, but **wall buttons keep working**.

## What you might see

- **Web app:** "You're offline — This phone or computer can't reach your home server right now. Your wall switches still work." with **Try again**. Or, at the bottom of the sidebar, **Reconnecting…** instead of **Live connection**.
- **Phone app:** "Can't reach your Switchboard server. Check your connection." or "The server took too long to answer. Check your connection and try again."
- **First start of the phone app:** "Can't find Switchboard at … Check the address, and that this phone is online…"

## What to try

1. **Check your phone's internet.** Open any other website. On mobile data, check that you have data left. On Wi-Fi, try switching to mobile data.
2. **Press Try again**, or reload the page. Live updates reconnect by themselves when the connection returns.
3. **Check the address (phone app).** On the sign-in screen, tap **Change** next to **Server** and enter **https://home.fawadiqbal.dev**.
4. **Restart the app or browser.**

## Is it your phone or everyone?

- **Only your phone:** it's your connection. Try another network.
- **Your phone works, but the devices show Offline:** your home's internet or router is down, not the app. See "A board is offline".
- **Nobody can open it, on any network:** the server may be down. Your wall buttons still work. Tell your installer. Schedules can't run while the server is down.

## "Something went wrong on the server. Try again."

This is a temporary server error. Wait a minute and try again. If it keeps happening, tell your installer what you were doing when it appeared.

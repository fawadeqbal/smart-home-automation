---
title: Privacy and your data
category: policy
audience: everyone
tags: [privacy, data, personal data, voice recording, microphone, history, stored, delete my data, who can see, data kahan hai, recording, privacy policy, record, awaz]
published: false
---
*Draft for approval. Every item marked [[check: …]] is a default to confirm or change. Unmarked statements describe how the software works today.*

## What we store

| What | Why | How long |
|---|---|---|
| **Account**: name, email, password (only as a one-way hash), homes, role, room access, alert choices | Sign-in and rights | While your account exists |
| **Sessions**: which browser or phone is signed in | Keep you signed in | 30 days without use |
| **Device history**: every switch, who and how (app, voice, wall, schedule), sensor readings | History and activity | Not deleted automatically [[check: history retention period]] |
| **Activity log**: invites, access changes, device changes, board events, support messages | Security and support | Not deleted automatically [[check: activity log retention]] |
| **Board health**: signal, voltage, memory, network name, IP and MAC address | Diagnostics | Charts 14 days |
| **Notifications** | Your alerts list | 30 days |
| **Visit requests**: name, phone, city, home size, notes | To contact you | Not deleted automatically [[check: lead retention]] |
| **Timers, schedules, scenes** | To run them | Until deleted |

A **Wi-Fi password** given to a board goes only to the board. It isn't stored in the app.

## Voice

- **Hands-free ("Hey Switchboard")**: the wake word is recognised **on your phone or computer**. Nothing is sent until it hears the wake word.
- When you speak to the assistant, the recording goes to our server, where our own speech recognition software turns it into text. **The recording is not saved**.
- The **text** of what you said, and the reply, are kept in a short conversation memory (forgotten after about 30 minutes without use) and written to our server's technical logs **[[check: log retention for assistant transcripts]]**.
- The text, with the list of devices you can see, is processed by an AI model that runs **on our server [[check: AI provider — local model or an external AI service; if external, name it and where data goes]]**.

## Who can see your home's data

- **Owners and admins**: everything, including Activity.
- **Members and guests**: only the rooms shared with them, and the history of those rooms.
- **Our staff**: your installer (their homes only), read-only support staff, and our administrators. Changes staff make appear in your home's Activity; viewing isn't logged.

We **don't sell or share** your data with anyone else **[[check: no sharing with third parties, list exceptions such as hosting provider]]**.

## Where it's kept

On our server at home.fawadiqbal.dev, hosted in **[[check: hosting provider and country]]**, with regular backups **[[check: backup frequency and retention]]**.

## Your choices

- Remove family members or guests at any time (**People**).
- Ask us to **export or delete** your home's data. We do this within **30 days [[check: data request deadline]]**. Deleting an account also deletes the timers and scenes that person made.
- Contact: **[[check: privacy contact email/phone]]**.

---
title: Backups and restoring (super admins)
category: process
audience: staff
tags: [backup, backups, restore, restoring, database, pg_dump, pg_restore, download, disaster, server lost, moving server]
published: true
---
Every night at **3 am** the server saves one file with everything needed to rebuild Switchboard:

- the whole **database** (homes, people, boards, devices, history, tickets, bills…),
- the **firmware builds**,
- the **installation photos**.

Files are kept for **14 days** (the newest three are always kept). Backups made by hand: the last five.

## See, make and download backups

In the console, open **Backups** (super admins of your own server only).

- **Back up now** makes one straight away, for example before a big change.
- **Download** saves a copy to your computer. Do this now and then, and keep a copy off the server (Google Drive, a USB disk). A backup only on the server is lost if the server is.
- If the nightly backup fails, super admins get a notification, and the page shows why.

The file holds everyone's accounts (password hashes, not passwords). Keep downloaded copies private.

## Putting a backup back

On the server, in the Switchboard folder (`/opt/home-platform`):

1. Copy the backup file to the server and unpack it:
   `tar -xzf switchboard-YYYYMMDD-HHMM.tar.gz`. This makes a `switchboard` folder.
2. Stop the API so nothing writes while you restore:
   `sudo docker stop home-api`
3. Put the database back. This replaces what's there now:
   `sudo docker exec -i home-postgres pg_restore -U home -d home --clean --if-exists --no-owner < switchboard/database.dump`
4. Put the files back:
   `sudo docker cp switchboard/firmware/. home-api:/data/firmware/` and
   `sudo docker cp switchboard/files/. home-api:/data/files/`
5. Start the API again: `sudo docker start home-api`. Boards reconnect by themselves within a minute.

`switchboard/backup.json` says when the backup was made and how many homes, boards and people it holds. Check it before you restore.

**Moving to a new server:** install Switchboard there first (the same way as the first time), then follow the steps above.

# What happens to a message

Plain language, and the same language the app uses. Nothing here is aspirational: it describes
what the code does today (see `server/chat.js` and `server/chat-db.js`).

## The short version

- A message is **deleted 24 hours after it is read**.
- A message nobody opens is **deleted 30 days after it is sent** — it cannot live forever.
- Attachments (photos and voice notes) go **with their message**, at the same moment.
- If you **report** a message, **a copy is kept for 90 days** so it can be reviewed. That is the
  only thing that outlives the 24 hours, and the person who sent it is not told about the report.

## When exactly does the clock start?

At **read**, not at send. A message becomes readable by the recipient the moment it is sent; the
24 hours start when the last person in the conversation has opened it. In a 1:1 chat that means
the first time the other person opens the thread.

- Sent and read immediately → gone 24 hours later.
- Sent and read three days later → gone 24 hours after *that*, i.e. 4 days after it was sent.
- Never opened at all → gone 30 days after it was sent.

## What "deleted" means here

1. **It is gone from the app immediately.** Every read filters on the deadline, so the moment a
   message lapses it cannot be fetched by anyone — even if the cleanup job has not run yet (the
   host this runs on sleeps when idle, so correctness cannot depend on a timer firing).
2. **The row is removed and the space is zeroed.** The message store has secure deletion turned on,
   so deleted text is not left sitting in the database file waiting to be overwritten.
3. **The attachment is deleted from storage**, not just unlinked: the file is removed from the
   bucket (or disk), and the record of it is marked removed.
4. **The database is compacted** after deletions, so the file gives the space back.
5. **Nothing is cached on the device.** Attachments are served with `no-store`, they are never
   written to the offline cache, and conversations are not kept in local storage.

## What we cannot promise

- **Screenshots and screen recordings are outside our control.** Anything you send can be captured
  by whoever receives it. We can block long-press saving; we cannot stop a second camera.
- **Copies you make yourself** (a forwarded photo, a downloaded file) live wherever you put them.
- **Backups are rolling, not instant.** Messages are replicated to object storage so a restart does
  not lose an open conversation. That replica keeps a **6-hour** history, so a deleted message can
  survive in the replica for up to 6 hours — then it is gone there too.
- **Reported content is kept on purpose.** If you report something, a snapshot of that message (and
  its attachment) is retained for up to 90 days so it can be reviewed. This is stated in the report
  dialog before you confirm.
- **A lawful request** can require us to preserve specific content. The retention job has an
  explicit carve-out for that, and it is the only other case where a message outlives its deadline.

## Why it is built this way

Storing messages in their own database, separate from the music catalogue, keeps this lifecycle from
touching anything that matters: compaction, secure deletion and short replica retention apply only
to the message store. The catalogue (accounts, tracks, playlists) is never swept, never compacted
early, and keeps its own, longer backup history.

## The numbers

A 24-hour conversation is a **fixed** cost, not a growing one: at any moment the server holds about
one day of messages plus whatever is unopened. Roughly:

| Messages per day | Message store | Attachments (if ~1 in 10 is a photo) |
| --- | --- | --- |
| 2,000 | ~1 MB | ~20 MB in flight |
| 20,000 | ~10 MB | ~200 MB in flight |

That is the whole point of the design: messaging does not slowly eat the storage the music needs.

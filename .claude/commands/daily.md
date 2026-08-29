---
description: Start the day — create today's journal note and refresh the dashboard
---

Run today's date with `date +%F`. Follow the **Daily flow** in CLAUDE.md:

1. If `07-Journal/<today>.md` doesn't exist, create it from
   `_templates/Daily Note.md`, replacing `{{date}}` with today's date.
2. Find the most recent earlier daily note in `07-Journal/`; copy its
   unchecked `- [ ]` tasks into today's Tasks section with `(carried)`
   appended. Don't duplicate tasks already present.
3. Rebuild `Command Center.md` per the Command Center rules in CLAUDE.md.
4. Show the user today's note briefly and ask what Today's One Thing is if
   it's still the placeholder. When they answer, write it into the note and
   the Command Center.

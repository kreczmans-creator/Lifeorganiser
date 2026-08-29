# Life Organiser — A Claude-Powered Life System

A personal life management system built from plain markdown files. It works in
**Claude Code** (via slash commands) and in **Obsidian** (as a vault) at the
same time — no plugins, no subscription, no lock-in. Everything is a text file
you own.

## What it does

- **Remembers everything** — capture thoughts, tasks, and ideas into an Inbox
  in seconds; Claude files them into the right place for you.
- **Organises your life** — Projects, Areas, Goals, Values, Knowledge, People,
  and a daily Journal, all cross-linked.
- **Moves before you do** — a live **Command Center** dashboard shows today's
  one thing, what's due, active projects, habits, and who to follow up with,
  rebuilt by Claude on demand.

## Quick start

1. Open this folder in Claude Code (or point Obsidian at it as a vault — both
   work simultaneously).
2. Run `/daily` to create today's journal note and refresh the dashboard.
3. Dump anything on your mind with `/capture <whatever>` — don't organise,
   just capture.
4. Once a day, run `/clarify` to have Claude empty the Inbox into the right
   sections.
5. Once a week, run `/review` for a guided weekly review.

Open [Command Center](Command%20Center.md) any time to see your whole life on
one screen.

## The commands

| Command | What it does |
|---|---|
| `/daily` | Create today's journal note from the template, carry over unfinished tasks, refresh the Command Center |
| `/capture <text>` | Append a thought/task/idea to the Inbox with a timestamp |
| `/clarify` | Process every Inbox item into the right section (GTD-style) |
| `/dashboard` | Rebuild the Command Center from the current state of the vault |
| `/review` | Guided weekly review: wins, lessons, project status, next week's one thing |
| `/goal <text>` | Create a new goal linked to your values, with milestones |
| `/project <text>` | Spin up a new project note with outcome, next actions, and log |
| `/followup` | Scan People notes and surface who you owe a reply or check-in |
| `/habits` | Show habit streaks and completion rates from your journal |

## The map

```
Command Center.md   ← the dashboard: your whole life on one screen
00-Inbox/           ← capture first, organise later
01-Values/          ← what matters to you; everything links back here
02-Goals/           ← outcomes with deadlines and milestones
03-Projects/        ← active efforts with a defined finish line
04-Areas/           ← ongoing responsibilities (health, money, home…)
05-Knowledge/       ← things worth keeping and re-finding
06-People/          ← relationships, follow-ups, birthdays
07-Journal/         ← one note per day: focus, tasks, habits, reflection
08-Archive/         ← done or dormant; nothing is deleted
_templates/         ← the blueprints Claude uses to create new notes
```

## The principles

1. **Capture is sacred.** If it takes more than 10 seconds to write something
   down, you won't. The Inbox exists so your brain doesn't have to hold things.
2. **One thing per day.** The dashboard always shows a single most-important
   task. Everything else is a bonus.
3. **Projects end, Areas don't.** If it has a finish line it's a Project; if
   it's forever (health, finances) it's an Area.
4. **Goals serve Values.** Every goal links to the value it serves. If it
   serves none, question it.
5. **The system maintains itself.** You capture and reflect; Claude files,
   links, and rebuilds the dashboard.

Everything here is yours. Edit any file, rename any section, delete what you
don't use — Claude reads `CLAUDE.md` and adapts.

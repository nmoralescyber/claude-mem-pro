---
name: remember
description: Save a permanent note or decision to memory. Use when the user types /remember to write a permanent note to CORE.md or a topic file in .claude-mem/.
---

# /remember — Save Permanent Memory

Save notes and decisions to the hierarchical `.claude-mem/` memory system.
Entries written here are **permanent** and always injected at session start.

## Usage

```
/remember "note text"
/remember --section "Key Constraints" "constraint text"
/remember --topic orb_strategy "note about ORB strategy"
```

## How to Execute

When the user invokes `/remember`, follow this workflow exactly:

### Step 1 — Parse the arguments

Extract from the user's `/remember` invocation:
- `content` — the quoted note text (strip surrounding quotes)
- `--section <name>` — optional CORE.md section (default: `Decision Log`)
- `--topic <name>` — optional topic name (writes to `.claude-mem/topics/<name>.md` instead of CORE.md)

### Step 2a — Writing to CORE.md (no --topic flag)

1. Read `.claude-mem/CORE.md` in the current working directory
2. Find the section header `## <section>` (default `## Decision Log`)
3. Insert immediately after the section header:
   ```
   \n### YYYY-MM-DD\n<content>\n
   ```
   where `YYYY-MM-DD` is today's date
4. If the section header does not exist, append it to the end of the file
5. Write the updated content back to `.claude-mem/CORE.md`
6. Respond: `✅ Saved to CORE.md → <section>\n   This note is permanent and will always be injected`

### Step 2b — Writing to a topic file (--topic flag)

1. Check if `.claude-mem/topics/<topic>.md` exists
2. If it does NOT exist — create it:
   ```markdown
   # Topic: <topic>

   ### YYYY-MM-DD
   <content>
   ```
3. If it DOES exist — append:
   ```
   \n\n### Update YYYY-MM-DD\n<content>
   ```
4. Respond: `✅ Saved to topics/<topic>.md\n   Will inject when <topic> files are active`

### Error case — empty args

If no content provided, respond:
```
❌ Usage: /remember "your note here"
         /remember --section "Key Constraints" "your constraint"
         /remember --topic orb_strategy "note about ORB strategy"
```

## What NOT to do

- Never write to `RECENT.md` — that is auto-generated only
- Never write to `sessions/` — that is auto-archived only
- Never overwrite existing sections — only INSERT or APPEND

## Examples

```
/remember "We use ATR-based stops because fixed % doesn't work at $250 capital"
→ Writes to CORE.md → Decision Log

/remember --section "Key Constraints" "Max 15% per ORB trade — tested in backtest"
→ Writes to CORE.md → Key Constraints

/remember --topic orb_strategy "Signal cutoff is 12:30 PM ET — avoids lunch chop"
→ Writes to .claude-mem/topics/orb_strategy.md
```

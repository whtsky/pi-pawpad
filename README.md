# 🐾 pi-pawpad

Persistent tasks and notes for [Pi](https://github.com/badlogic/pi-mono) agents.

PawPad keeps your agent's task list, decisions, constraints, and other durable context available after conversation compaction. Before every agent turn, it restores the current PawPad state from the active Pi session branch and adds it to the system prompt.

A Pi-native port of [openclaw-pawpad](https://github.com/whtsky/openclaw-pawpad).

## Install

```bash
pi install npm:pi-pawpad
```

Restart Pi, or run `/reload` in an existing session.

## Widget controls

PawPad shows a compact Notes and Tasks preview above the editor. Empty sections hide automatically, and a single nonempty section uses the full width. When both sections have content, terminals at least 60 columns wide use a 50/50 split; narrower terminals use a compact single-column view.

Run `/pawpad` to view the current settings. Widget preferences are session-local, survive reloads and resumes, and follow Pi branches.

```text
/pawpad hide notes
/pawpad show notes
/pawpad toggle tasks
/pawpad hide all
/pawpad show all
/pawpad height 6       # 2-12 body rows per visible section
/pawpad ratio 45       # Notes gets 45%; Tasks gets 55%
/pawpad reset          # Notes/Tasks on, height 4, width 50/50
```

The ratio applies only when both sections are visible side by side. `show` enables an empty section for the next time it has content.

## Verify the installation

Start Pi and enter:

```text
Use pawpad_tasks to create a pending task named "verify-pawpad".
Use pawpad_note to record "PawPad is installed".
Then read both back to me.
```

You should see both PawPad tool calls and a `🐾 PawPad` widget above the editor.

## Session behavior

PawPad stores complete snapshots in Pi's session history rather than in separate files:

- Compaction, reload, and resume preserve the current task list and notes.
- `/tree` restores the PawPad state at the selected point.
- `/fork` and `/clone` inherit copied state.
- `/new` starts with an empty PawPad.

## Configuration

Most users do not need to change these settings.

```bash
PAWPAD_WARN_COMPLETED_TASKS=30 \
PAWPAD_WARN_NOTE_CHARS=10000 \
PAWPAD_WIDGET=1 \
pi
```

Set `PAWPAD_WIDGET=0` to hide the widget without disabling the tools.

Warning thresholds are advisory. Separate safety limits keep each persisted snapshot and injected prompt below Pi's output budget: at most 100 tasks, 40 KiB of serialized state, and 40 KiB or 1,500 lines of injected PawPad context. An oversized write fails without changing the previous state; condense the notes or tasks and retry.

PawPad sends all current tasks and notes to the model on every turn, so larger notes use more context.

## Compatibility

Requires Node.js 22.19 or newer. Tested with Pi 0.82.0. PawPad uses Pi's provider-compatible tool schema for Google/Gemini, OpenAI, and Anthropic providers.

## License

MIT

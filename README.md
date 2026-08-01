# Successor Vision

A productivity and discipline tracker that runs entirely in your browser. One
HTML file, no build step, no server, no account. Your data lives in your own
browser's `localStorage` and never leaves the device.

## What's in it

| | |
|---|---|
| **Habits** | Year-long grid, per-habit streaks with a one-day recovery rule, planned rest days that don't count as failure |
| **Sleep** | Per-night verdict scored on duration, circadian placement, rhythm regularity and timing — not a fixed 8-hour rule |
| **Focus Timer** | Pomodoro cycles that can tick a linked habit off automatically when a work session completes |
| **Stopwatch** | Lap timing |
| **Flow Planner** | Visual day planning |
| **Analytics** | Full-year charts plus a Last 7 Days review that names the one thing worth changing |
| **Journal** | Dated entries with mood and tags |
| **Assistant** | Optional — talks to the Claude API using a key you supply at runtime |

## Running it

Open `index.html`. That's the whole install.

Or use the hosted version — same file, nothing stored server-side.

## How the sleep score works

Most sleep trackers grade you against a flat target. This one scores four
things and weights them by how much the evidence says they matter:

- **Duration (35)** — against the age-band consensus range, not a universal 8h.
- **Circadian placement (30)** — how much of the sleep landed in biological
  night. A 7-hour block starting at 04:00 is not the same as one starting at
  23:00.
- **Rhythm (25)** — drift from your own recent midsleep, damped by how
  scattered your baseline already is. Regularity of sleep timing predicts
  health outcomes more strongly than duration does
  ([Windred et al., 2023](https://doi.org/10.1093/sleep/zsad253)).
- **Timing (10)** — bedtime relative to your chronotype.

Needs three logged nights before the rhythm and baseline parts have anything
to work with.

## Privacy

No analytics, no telemetry, no backend. The only outbound requests are Google
Fonts and — if you turn on the assistant and enter your own key —
`api.anthropic.com`. No API key is bundled with this file.

## Licence

MIT

# Product

## Register

product

## Users

One person tracking their own life, mostly alone, mostly on a phone, often
last thing at night or first thing in the morning. Not a team, not a client,
no audience. They are checking off a habit, logging how they slept, writing a
few lines in a journal, or planning a day. Sessions are short and frequent —
under a minute, several times a day — with occasional longer stretches on a
laptop for reviewing a month or writing properly.

The job: keep a promise to yourself, and be able to see whether you did.

## Product Purpose

Successor Vision is a self-tracking app covering habits, sleep, tasks, focus
sessions and journalling in one place, with an AI assistant that can read and
change any of it.

It works fully without an account; signing in only turns on sync. The whole
app is a single HTML file with no build step and no framework, deliberately —
it can be opened from disk, backed up as one file, and outlives any
dependency.

Success is the user still using it in six months. That makes the daily loop
(open, tick, close) the thing every design decision serves.

## Brand Personality

Quiet, honest, unfussy. Stated by the owner as "not too much fancy stuff, not
too much basic stuff, a minimum minimalist kind of stuff."

The product's own argument is that a missed day is survivable — it is built
into the streak rules and the sleep score. The interface should carry the same
tone: never punishing, never congratulatory to the point of being hollow.

## Anti-references

- **Three products stitched together.** The Journal is warm parchment, the
  Habit Tracker is clinical white, the Flow Planner has its own everything.
  Converging on the calm neutral shell; the Journal keeps only a hint of
  warmth as accent, not as a whole separate world.
- **Habit-app guilt.** Streak-shaming, red everywhere, "you broke your chain".
- **Dashboard maximalism.** Big-number hero metrics, endless identical stat
  cards, a summary of the summary.
- **Gamification as decoration.** Badges that mean nothing. Gamification is
  already an opt-out switch and should stay earnable, not ambient.

## Design Principles

1. **The daily loop is the product.** Open, tick, close. Anything that slows
   that down is on trial, however clever it is.
2. **One system, not eleven.** Eleven pages accreted separately; the same
   control should look and behave the same everywhere.
3. **Reversible over removed.** Anything cluttered gets a switch defaulted
   off, not a deletion. The user changed their mind before and will again.
4. **Say the true thing.** Labels state what actually happens ("Hide the log
   to widen the chart", not "Toggle panel"). Copy never oversells.
5. **Every gesture has a keyboard path.** Long-press is not a gesture on a
   laptop; anything pointer-only is unfinished.

## Accessibility & Inclusion

- Target WCAG 2.1 AA: body text ≥4.5:1, large text ≥3:1, in **both** themes.
- Touch targets ≥44px. Several controls were 22–28px and were fixed.
- `prefers-reduced-motion` honoured everywhere; celebration animations already
  degrade.
- The habit grid is a real grid: roving tabindex, arrow keys, Enter to cycle,
  and each cell announces habit, date and state.
- Colour is never the only carrier of state — done / missed / rest each have a
  glyph as well as a colour, which also covers colour blindness.

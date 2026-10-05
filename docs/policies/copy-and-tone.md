---
status: canonical
audience: [human, agent]
last_verified: null
---
# Copy And Tone Guide

This note keeps dashboard language consistent as the system grows. It is intentionally small: use it when editing admin overview cards, workflow guidance, issue cards, templates, and empty states.

## Purpose

First Chord's dashboard should feel calm, human, and practical.

The language should reduce cognitive load, not make normal school admin feel like a crisis.

## Voice

- Plain English first.
- Action-led: say what to do next, not just what is wrong.
- Warm enough to feel like First Chord, but not chatty in dense admin areas.
- Avoid blame, drama, or alarm unless something is genuinely risky.
- Prefer "families" or "parents" over abstract terms like "contacts" when the surface is parent-facing.
- Prefer "needs a quick look" over "requires review" unless the wording is about a formal audit or system check.

## Overview Page

The overview is a meeting-start surface.

It should answer:

- What needs doing today?
- What needs attention soon?
- What can we work on if the day-to-day work is clear?
- Can we trust the system right now?

Keep overview cards calm:

- make the action title more prominent than the number
- use quieter count chips instead of scoreboard-style numbers
- reserve red/urgent styling for genuinely urgent or risky work
- avoid showing background metrics as front-page pressure
- link to the deeper workflow rather than explaining everything on the overview

Examples:

| Avoid | Prefer |
| --- | --- |
| Flags that still need a decision | A few things need a quick look |
| Parent messages left | Families still need an update |
| Needs classification | So payment checks know what to expect |
| No open operational loops are pressing right now | Nothing is asking for urgent attention right now |

## Workflow Pages

Workflow copy should help someone complete the loop without asking Finn.

Use this shape where possible:

```text
What is happening
Why it matters
Safest next action
What happens when you click the button
What remains open, if anything
```

Avoid adding long explanations above every control. Put detail in collapsed sections, helper text, or docs.

## Issue Cards

Issue copy should be direct and specific:

- who this affects
- what appears wrong
- why the dashboard thinks that
- the safest next action
- how the issue will clear

Keep debug IDs, raw source keys, and long reasoning out of the default card view.

## Buttons

A button label must predict its outcome for someone who does not know the internal state model.

Rules:

1. **Verb + plain object.** Say what happens in English, not in system vocabulary: "Expect payments paused", not "Set paused expected"; "Clear fixed issues", not "Resolve system-cleared".
2. **No internal names on buttons.** Tab names, column names, state values, and system shorthand (`registry`, `row`, `expected`, `system-cleared`) stay in code and docs. If two buttons act on different systems, name the system in plain words: "Mark inactive in Sheets" / "Mark inactive in MMS".
3. **One completion verb per object family.** Planning items are marked **done**; issues are **resolved** (or **cleared** when the system fixed them); workflow/checklist steps are **completed**. Don't mix verbs within a family.
4. **Disabled buttons say why.** The label itself explains the block: "Download the Wise CSV first". A greyed-out mystery button is a question the reader has to go and answer.
5. **Pending `…`, success `✓`.** Pending labels use the single ellipsis character ("Saving…", never "Saving..."), success states get a check ("Copied ✓", "Parents messaged ✓"). The `ActionButton` primitive bakes both in — prefer it for new async buttons (see [UI conventions](./ui-conventions.md)).
6. **Confirm dialogs explain consequences**, including what is preserved: "It will be parked, not deleted, so the history stays available" is the house standard.

The hygiene check advisorily flags new button labels containing internal-jargon tokens in changed files.

## Message Templates

Templates can use a warmer First Chord voice than admin controls.

They should still be:

- clear
- short enough to send without editing heavily
- specific about what the parent/tutor should know or do
- easy to copy into WhatsApp or email

Incoming-inbox pause acknowledgements are the deliberately light exception to
specificity: use “No worries at all, thanks for letting us know. I’ve made a note
to pause those dates.” rather than repeating names or interpreted dates. This
acknowledges the request without claiming the pause has already been actioned.
The linked Planning card owns the precise details and its later confirmation message can be specific once the
pause has been actioned.

## What Not To Do

- Do not create a large "language system" before it is needed.
- Do not add AI rewriting to core workflows yet.
- Do not make every page playful; use warmth where it helps and restraint where density matters.
- Do not hide important risks just to make the page feel calm.

---
status: canonical
audience: [human, agent]
last_verified: 2026-08-25
---
# Admin UI Conventions

This is the lightweight UI rulebook for First Chord admin surfaces. It exists so future agents copy the calm, reliable interaction patterns instead of inventing a new button style each time.

## Principle

Admin UI should reduce cognitive load:

- show the next safe action clearly
- keep the user on the same page after actions
- make pending, success, and error states visible
- avoid dramatic language, noisy colours, and surprise navigation

## Async Actions

Every button-like control must acknowledge activation immediately. This is the
shared physical interaction language even when the controls have different
visual prominence:

1. **Pressed:** on pointer or touch down, visibly depress and change surface
   colour. This must be CSS-driven so it does not wait for JavaScript or a
   network response. Keyboard focus remains clearly visible.
2. **Working:** if the action is asynchronous, disable duplicate submission and
   show a spinner plus a specific `…` label.
3. **Outcome:** show a short `✓` confirmation or a visible nearby error. A
   navigation link instead confirms its outcome by opening the destination.

The shared pressed and focus treatment lives in
`lib/admin/button-styles.mjs`. Use it through `ActionButton`, `ButtonLink`,
`ConfirmButton`, or `CopyButton`; do not reproduce those state classes on each
page. Motion is supplementary: the surface-colour change remains when reduced
motion is enabled.

Any new button that triggers async work should give feedback:

- pending: disable the action and show a spinner or saving label
- success: show a short confirmation, such as `Saved` or `Done`
- error: show a visible message near the action

Use the shared primitives when practical:

- `components/admin/ui/ActionButton.js`
- `components/admin/ui/ButtonLink.js`
- `components/admin/ui/ConfirmButton.js`
- `components/admin/ui/StatusBanner.js`
- `components/admin/ui/useAsyncAction.js`

Plain raw buttons are still fine for local UI state, such as toggles, tabs, expanding sections, or selecting a filter.

## Button Roles

Choose the role by the action's job, not by whichever colour looks attractive:

- `primary`: the one clearest next action in a local decision area
- `secondary`: an ordinary supporting action
- `quiet`: low-emphasis local controls
- `warning`: a reversible action that deserves caution, such as parking work
- `danger`: destructive or difficult-to-reverse work

Persistent toggles and disclosure controls keep their own selected/open state
and accessible state (`aria-pressed` or `aria-expanded`). Success is a temporary
outcome state, not a permanent green action hierarchy. Ordinary actions use a
44px target; compact 32px controls are reserved for repeated, low-priority
choices with clear spacing, such as a row of available lesson times.

## Destructive Actions

Destructive actions should use an explicit confirmation step and should not be visually louder than necessary.

Use `ConfirmButton` for new destructive admin actions unless the page already has a clearer local confirmation pattern.

## Copy To Clipboard

Use `components/admin/ui/CopyButton.js` for new "copy this text" controls, unless
the surface needs something the shared button genuinely cannot express.

- it sits in the top right of the block it copies, so nothing has to be selected
  by hand
- it confirms with `Copied` for two seconds, matching the pending → success rule
  in [Copy and tone](./copy-and-tone.md) → Buttons
- it falls back to a hidden textarea when `navigator.clipboard` is unavailable.
  That is not defensive padding: the API is undefined on insecure origins, so
  without it Copy silently does nothing when the admin is opened over plain http

Ten page clients still hand-roll their own clipboard call. They work and are not
worth churning on their own; new work should not add an eleventh.
`npm run hygiene:check` warns when a new changed line outside the shared button
introduces one.

## Page Refresh

Avoid `window.location.reload()` in admin and tutor-facing workflows. Prefer:

- local state updates when the API returns enough data
- `router.refresh()` when server-derived state needs re-reading
- a targeted refetch when only one panel needs updating

Full reloads lose scroll position, flash the page, and re-fetch unrelated data.

## Copy

Action labels should describe the work in plain English:

- Good: `Save progress`, `Mark parents messaged`, `Resolve absence`
- Avoid vague labels like `Submit`, `Process`, or `Execute` unless the surrounding context is obvious.

**Button language rules live in [Copy and tone](./copy-and-tone.md) → Buttons**
(label predicts outcome without internal state names; one completion verb per
family; disabled buttons say why; pending `…` → success `✓`). This file owns the
interaction mechanics; that file owns the words.

Keep helper copy short. If a line does not help Finn, Tom, or Fenella decide what to do next, it probably does not belong on the daily surface.

## Hygiene Prompt

`npm run hygiene:check` warns when new changed lines introduce:

- full-page reloads
- raw admin buttons
- direct admin API fetches

These warnings are judgement prompts, not build failures.

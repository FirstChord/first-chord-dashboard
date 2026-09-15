# Add student compatibility pointer

The old manual portal skill is retired **as the default path**. For a genuinely
new student, use `/admin/onboard`: see the **Waiting and onboarding** row in
[`AGENTS.md`](../../AGENTS.md), inspect the current code and tests, and preserve
the documented partial-failure recovery boundary.

One case still needs hands: a student already **active in MMS**, with lessons
happening, who never reached the Students sheet. `/admin/onboard` would activate
them, create a billing profile, book a first lesson and send a welcome message —
all wrong for someone already teaching. There, add the Students sheet row and the
registry entry directly. Both are required: a registry-only student is invisible
to every admin surface and renders as "Unknown student".

Never edit generated mapping or credential artifacts to compensate for an
upstream issue.

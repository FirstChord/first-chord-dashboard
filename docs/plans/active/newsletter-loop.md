---
status: active-plan
audience: [human, agent]
last_verified: 2026-09-12
---

# Newsletter loop

## Objective

Turn the monthly newsletter from a thing Fenella remembers into a thing the
school records. She keeps the editing and every decision about what the school
says; the dashboard removes the coordination, the recall, and the "what is still
missing" arithmetic.

The goal is explicitly **not** to automate Fenella out of the process.

## Whole loop (all slices)

```text
Fenella opens the month          -> one Newsletter_Issues row (month, question, deadline)
Fenella picks priority students  -> one Newsletter_Items row each, requested_at set
                                    one deterministic Planning Action for the deadline
                                 -> per-tutor request text she copies into WhatsApp
Tutor notices something          -> capture against a student they already teach
Tutor notices something extra    -> same action, requested_at blank. Unsolicited is the
                                    default path, not a special case.
Fenella reviews                  -> asked / arrived / outstanding / extras, plus one
                                    sentence on what is blocking editorial review
Fenella selects and orders       -> editorial, sort order, intro, her own per-item text
Agent renders a first assembly   -> deterministic HTML; AI proposes wording only
Fenella edits and approves       -> server renders the issue as email-ready HTML
Fenella presses Copy HTML        -> she pastes it into Mailchimp, sends her own test,
                                    and presses her own send there
```

No automatic message to any tutor or parent at any point. No step where a model
supplies an approval. **The dashboard has no ability to email a parent** — see the
Mailchimp decision below.

## Object model

Two Sheets tabs, **no status column on either**, and one existing append-only
log. Lifecycle is recalculated on read, following the teaching-relationship
precedent in [ownership](../../architecture/data/ownership.md): "The phase is
recalculated on read. There is deliberately no `Teaching_Relationships` Sheet and
no manually advanced lifecycle status."

### Five item states, each from an observable fact

| State | True when |
|---|---|
| `requested` | `requested_at` set, `captured_at` blank, `tutor_response` blank |
| `captured` | `captured_at` set, `editorial` blank |
| `declined` | `tutor_response = nothing_this_month` |
| `selected` / `not_selected` | `editorial` set to either |
| `needs_review` | `editorial` set but `captured_at` blank (contradictory; surfaced, never guessed) |

"Extra" is `captured_at && !requested_at`. "Outstanding" is
`requested_at && !captured_at && !tutor_response`. Both derived, neither stored.

This separates the four different facts a checkbox would have conflated:
**requested** is `requested_at`, **captured** is `captured_at`, **intentionally
skipped** is `tutor_response`. **Remembered** is deliberately not modelled — it
is not a fact about the school, and asking a tutor to record it is the ceremony
this design exists to avoid.

## Consent — decided 2026-09-12

The school's existing practice is to **ask before including a picture**, per
picture. That is the model the software follows; there is no bulk consent
register and no data-collection exercise.

Three answers, because that is what a parent actually says:

| Answer | Stored | Meaning |
|---|---|---|
| No | `consent_answer = no` | Not this time. Not a standing refusal. |
| Yes | `consent_answer = yes_once` | This picture only. |
| Yes, and future ones | `consent_answer = yes_ongoing` | Standing permission, **newsletter-scoped**. |

**Standing consent is derived, not stored separately.** A student has standing
newsletter consent when any `Newsletter_Items` row for their `fc_student_id`
carries `consent_answer = yes_ongoing`. No new `Students` column, and no new
concept.

Three reasons this is the right home:

1. The derivation is a complete audit record on its own — *this parent, this
   date, this ask* — where a bare `Students` cell would not say who agreed to
   what.
2. It avoids inventing a school-wide consent register before the school has
   decided what such a register would mean. That decision is Finn's and is still
   open in [data protection](../../policies/data-protection.md).
3. **Scope honesty.** Permission given for "future newsletters" authorises
   future newsletters. It must not silently become permission for social media
   or a showcase reel. Keeping the record newsletter-scoped keeps the promise
   the parent actually heard. Widening it is a new ask, not a query.

Promotion to a `Students` column stays trivial if the school later decides it
wants a cross-surface register — but that is a separate, reviewed change with its
own consent wording.

### Consent gate

`has_media` on an item is what triggers the requirement. Derived consent status:

| Status | When |
|---|---|
| `not_required` | `has_media` false |
| `cleared` | `consent_answer` is `yes_once`/`yes_ongoing`, or the student has standing consent |
| `waiting` | asked (`consent_asked_at` set), no answer yet |
| `needed` | media, no standing consent, not yet asked |
| `blocked` | `consent_answer = no` |

**Server-side invariant: an item with media cannot be marked `selected` unless
consent is `cleared`.** This is the one real guard in the workflow and it is
enforced in the route, not only in the UI.

A family that has declined before is shown to Fenella as history so she can
decide whether to ask again. The software never infers a standing refusal from
past answers, and never decides on her behalf.

### The ask itself

The dashboard **drafts** the message; Fenella sends it. Copy-to-send, the same
boundary as every other parent message here: `Communication_Log` records that a
message was copied, which is not proof it was sent. Nothing is ever sent
automatically, and the newsletter workflow performs no WhatsApp or email send.

## Sources of truth

| Fact | Owner |
|---|---|
| Issue exists, question, deadline, intro | `Newsletter_Issues` (dashboard) |
| Priority/request state | `Newsletter_Items.requested_at/_by` |
| Contribution text and metadata | `Newsletter_Items` |
| Whether a picture is involved | `Newsletter_Items.has_media` |
| Consent answer and its date | `Newsletter_Items.consent_*` |
| Standing newsletter consent | derived from the above; never stored twice |
| Editorial selection | `Newsletter_Items.editorial` |
| Media bytes (slice 3) | Google Drive |
| Media references (slice 3) | `Newsletter_Items.media_json` (Drive file IDs) |
| Generated draft (slice 2) | derived; `Proposals` lane if ever persisted |
| Rendered HTML (slice 4) | derived on demand from the selection — not stored |
| The campaign, the audience, the test, the send | **Mailchimp**, entirely. The dashboard holds no campaign id, no send state and no send capability |
| Student identity | registry `fcStudentId` — resolved, never minted |
| Tutor identity | `ADMIN_TUTORS.fcTutorId` |

Sheets for both tabs, against the
[storage boundary](../../architecture/data/storage-boundary.md) rubric: humans
create and correct the records, volume is ~15-25 items/month, direct inspection
is an operational advantage, and last-write-wins is acceptable for a per-student
row. **PostgreSQL is not used at all**: the only candidate was a Mailchimp
send claim, and the copy-and-paste decision removed the send. Nothing in this
workflow can cause duplicate external action, so nothing needs a transactional
claim.

## Slice order

| Slice | Scope | Blocked by |
|---|---|---|
| **1a** | Fenella's side: open issue, assign priorities, copyable tutor request text, record contributions, consent ask and answer, mark selected | nothing |
| **1b** | Tutor surface on `/dashboard`: the reminder strip, text capture, and photo/audio/video upload to Drive — **built 2026-09-12**, inert until tutor auth is enforced | `TUTOR_DASHBOARD_AUTH_MODE` + per-tutor emails |
| **2** | Editorial assembly: selection, order, intro, deterministic render, AI wording proposals | nothing |
| ~~3~~ | ~~Media upload as a separate slice~~ — folded into 1b (decided 2026-09-12): the tutor panel, the capability token and the auth gate are shared, so building them twice made no sense |
| **4** | Render the approved issue as HTML and give Fenella a **Copy HTML** button | slice 2 |
| ~~5~~ | ~~Production send from the dashboard~~ — **not being built** (decided 2026-09-12) | — |

### Uploading is not publishing — corrected 2026-09-12

An earlier version of this plan said consent blocked media upload. That conflated
two different things and was wrong.

Those photos already exist: on tutors' personal phones and in WhatsApp threads,
with no school control, no access boundary and no retention at all. Moving them
into a school-controlled Drive folder is a **privacy improvement**, not a new
exposure. The consent gate belongs on **publication**, which is where it already
sits: an item with media cannot be selected for an issue until a parent's answer
is recorded, re-checked server-side.

So consent does not gate upload. It gates use. What is still genuinely owed is
retention and a line in the parent-facing privacy notice — real obligations, but
not reasons to leave the files on personal phones in the meantime.

### Mailchimp: copy and paste, not an API — decided 2026-09-12

There is no Mailchimp integration and there will not be one. Slice 4 renders the
approved issue as HTML and gives Fenella a **Copy HTML** button; she pastes it
into the campaign she already builds, sends her own test, and presses her own
send.

What this decision removes, permanently:

- a third Google/Mailchimp credential and its rotation story;
- `newsletter_send_claims` in PostgreSQL, and with it the only reason this design
  needed PostgreSQL at all — the whole workflow stays in Sheets;
- campaign-state caching, the `mailchimp_campaign_id` /
  `approved_html_sha256` / `test_sent_at` / `sent_at` columns, and the
  "created the campaign but lost the ID" reconciliation path;
- every idempotency concern except the two that remain (item id, Drive ticket);
- **any code path capable of emailing parents.** "Finished editing" and "send to
  parents" are separated by construction rather than by a guard, because the
  second one happens in Mailchimp with a human's hand on it.

This sits exactly on the existing `Communication_Log` boundary: copied to send is
not proof of sending, and the dashboard never sends. Revisit only if pasting
turns out to be the slow part of Fenella's month, which it is not today.

### What the rendered HTML must look like

The newsletter carries the school's identity, so the renderer targets the
website's palette and the school's own artwork rather than inventing a look.

House palette, already documented in `components/shared/FCIcons.js:3` and used
across the dashboard:

| Colour | Hex | Role |
|---|---|---|
| Deep green | `#2F6B3D` | primary — headings, rules, links (134 uses, the brand colour) |
| Dark green | `#245230` | hover/pressed, heavier accents |
| Sage | `#6E9B6B` | secondary foliage/accent |
| Pale sage | `#A7C8A2` | tints, backgrounds, stems |
| Coral | `#F0876E` | warm accent |
| Periwinkle | `#8B8BE0` | cool accent |

Artwork in `public/`: `fc-logo-square.png`, `first-chord-banner.png`
("Explore Music Together"), `cloud.png`. Type is the system stack with the
`.fc-display` treatment for nameplates (weight 900, `-0.025em` tracking) — there
is no webfont to match, which is convenient because email clients would ignore it.

**Two constraints that shape the renderer, and must not be discovered late:**

1. **Email HTML is not app HTML.** Mailchimp and the clients behind it need
   inline `style` attributes and table-based layout; Tailwind classes, CSS custom
   properties, flex/grid and `<style>` blocks are unreliable or stripped. The
   renderer therefore emits inline styles from the hex values above — it cannot
   reuse dashboard components, and the palette must live in one shared constant
   so the two never drift.
2. **Images need absolute, publicly reachable URLs.** A relative `/cloud.png`
   resolves against Mailchimp, not against First Chord. Artwork must be
   referenced by absolute URL (or uploaded to Mailchimp's own content library
   once), and child photos in slice 3 are a separate question again — a Drive
   file is not publicly served, so a selected photo needs a deliberate hosting
   decision before it can appear in an email.

### Gate before 1b

`lib/tutor-auth-contract.mjs` returns `LEGACY_PUBLIC_ACCESS` when
`TUTOR_DASHBOARD_AUTH_MODE` is unset or unrecognised, and the legacy
`efficient-sparkle` service runs `/dashboard` publicly *with* Sheets
credentials. A tutor write route shipped as-is would therefore accept free text
about a named child from anyone who found that address.

1b adds `requireEnforcedTutorDashboardAccess()` — refuses with 503
`tutor_auth_not_enforced` when auth mode is off, making the route inert on the
legacy host and live on canonical. It is the first route in the repository to
fail closed on a missing auth mode.

While the shared `musiclessons@firstchord.co.uk` account is the only approved
identity, `captured_by` is self-attested. Fenella's screen says **recorded as**,
not **by**. Binding it to authenticated identity is a 1b/3 gate, per
[tutor surface security](../../architecture/security/tutor-student-surfaces.md).

### What switches 1b on

The code is built and deployed but **inert**. Three things, all configuration:

1. `TUTOR_DASHBOARD_AUTH_MODE=required` on the canonical service.
2. `TUTOR_DASHBOARD_EMAIL_MAP` with each tutor's Google address → tutor key.
   Until this exists, the only approved identity is the shared `musiclessons@`
   account, so no individual tutor can reach their own students.
3. The legacy public `efficient-sparkle` dashboard closed or redirected. Until
   then it keeps serving `/dashboard` with no login — the newsletter routes refuse
   to run there, but it remains the reason they have to.

Plus `DRIVE_CLIENT_ID` / `DRIVE_CLIENT_SECRET` / `DRIVE_REFRESH_TOKEN` for the
upload half specifically. Without them text capture works and upload returns
`drive_not_configured`, so the two halves can be switched on independently.

Still owed, not blocking the switch-on: an approved retention window for media in
Drive, and a parent-facing privacy notice saying the school stores it.

### How the media path is bounded

- **Credential:** its own `DRIVE_*` triple, scope `drive.file` **only** — access
  to files this app created and nothing else, so a leaked token cannot read the
  rest of First Chord's Drive. No fallback to `GOOGLE_*`, unlike the Gmail config;
  a fallback would silently widen the grant. Minted by
  `scripts/mint-drive-token.mjs`.
- **Identity:** the Drive **file ID** is stored in `media_json`. Never the folder
  path or file name, so a human renaming or moving a file breaks nothing. Names
  (`2026-09_hayley-adams_fc_std_…_a1b2c3d4.jpg`) are for browsing only.
- **Types:** an allowlist. Photo, audio and video MIME types only — a PDF, an
  HTML file or an SVG is refused, SVG particularly because it can carry script.
- **Size:** per kind — 15MB photo, 25MB audio, 60MB video. Enforced twice: once
  against the declared `Content-Length`, then again by a counter on the bytes as
  they arrive, because the declared length is a claim. The body **streams** to
  Drive rather than being buffered; holding a 60MB video in memory is how this
  feature would take a Railway instance down.
- **Order:** Drive first, then the Sheets write. An orphaned Drive file is
  recoverable garbage; a row pointing at a file that does not exist is a broken
  page. When the write fails the route says so explicitly and tells the tutor
  **not** to re-upload, and `npm run newsletter:media-report` lists the orphans.
- **Deletion:** none, anywhere in the code. Detaching a reference leaves the file
  in place on purpose. Removing a child's photograph is a deliberate human act.
- **Phone-first:** the photo is on the tutor's phone, not the desktop beside
  Practice Chat, so the capture control uses `capture` to open the camera
  directly. If this takes more taps than sending the photo on WhatsApp it will not
  get used, which is the real risk to watch — not the plumbing.

### Idempotency keys — two, and no more

1. `item_id`, deterministic from `issue_month` + `fc_student_id`, plus a client
   `captureTicket` suffix for additional contributions (slice 1b).
2. Drive `uploadTicket` (slice 3).

There is deliberately no third. The send claim this design originally needed
disappeared with the Mailchimp API: a retry can no longer email anybody twice,
because the dashboard cannot email anybody at all.

### Rollback

| Slice | Rollback |
|---|---|
| 1a / 1b | Revert the deploy. Both tabs remain, inert; nothing external was touched. Fenella returns to WhatsApp with every captured row still readable. |
| 2 | Revert. Selection and editor text survive; only the renderer is gone. |
| 3 | Revert code. Drive files stay in their dated folder — never bulk-delete on rollback. |
| 4 | Revert the renderer. Nothing external was touched: the HTML was only ever copied to a clipboard, and the selection it was rendered from survives. Fenella builds the campaign by hand as she does today. |

## Open decisions

- **How a selected child photo reaches the email** (the slice 3/4 seam). Drive
  does not publicly serve files, so a photo cannot be hot-linked from a Drive id.
  Either upload the chosen few to Mailchimp's content library by hand, or serve
  them from a narrow signed dashboard route. Not urgent, but it decides part of
  the slice 3 design.
- **Who asks the parent** once tutors are in the loop. 1a assumes Fenella. If a
  tutor asks in the lesson, the consent record needs a `consent_asked_by` and a
  tutor-side answer control.
- Whether standing newsletter consent should ever be promoted to a
  cross-surface `Students` register, and with what wording.

## Not in scope

- Any automatic message to a tutor or parent.
- `Planning_Items` as the newsletter engine. Planning gets exactly one
  deterministic Action per issue (`planning_newsletter_<YYYY-MM>`) for the
  deadline, following the onboarding `planning_first_lesson_checkin_<mmsId>`
  precedent.
- Newsletter editorial state on the student record.
- Student history, showcase or social surfaces built on the item object. The
  object is shaped so they remain possible; they are not being built.

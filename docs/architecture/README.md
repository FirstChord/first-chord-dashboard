---
status: supporting
audience: [human, agent]
last_verified: 2026-07-20
---

# Architecture

Use this folder to understand how the system works and where truth, state,
permissions, and technical boundaries live.

- [System](./system/admin-loop.md): loop architecture, tutor/student surfaces,
  student paths, and the read-only [student timeline projection](./system/student-timeline.md).
- [Data](./data/state-tabs.md): state tabs, ownership, and the Sheets/database
  boundary, plus the shared [Sheets read budget](./data/sheets-reads.md).
- [AI](./ai/runtime-integration.md): model runtime and the strict tool/proposal
  allowlist.
- [Security](./security/tutor-student-surfaces.md): current public-surface trust
  boundary.

Architecture explains structure. Operational instructions belong in
[`operations/`](../operations/README.md); behavioural rules belong in
[`policies/`](../policies/README.md).

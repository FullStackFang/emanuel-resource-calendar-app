# Design Context — Emanuel Resource Calendar

This file captures the design brief for this project. Design agents (the `/impeccable` skill and its sub-skills) should read this before touching visual code.

## Design Context

### Users
- **Temple Emanuel administrative staff** (event schedulers, facility managers) — primary daily users on desktop, often with many events open at once.
- **Approvers** (clergy, facility leads) — episodic review of the reservation queue; they want to decide, not explore.
- **Congregants and internal requesters** — low-frequency, often first-time submitting a room request. Mixed desktop/mobile.
- **Guest requesters via public token** — single-session, no account. Must feel legitimate and institutional, not like a generic form builder.

Context of use: office hours, not real-time. Decisions are auditable and consequential (real rooms, real bookings). Clarity beats speed.

### Brand Personality
**Three words**: refined, institutional, trustworthy.

**Emotional target**: users should feel *in control and unhurried* at the dominant moment of use — e.g., an admin reviewing the approval queue on a Tuesday afternoon. No urgency theatre, no gamification, no confetti.

**Voice**: formal but human. Closer to the language of a well-run synagogue office than to marketing copy. Status vocabulary is neutral and pragmatic (`draft`, `pending`, `published`, `rejected`) rather than performative (`submitted!`, `approved`).

### Aesthetic Direction
**Committed direction**: editorial-institutional. The reference space is closer to a museum publication or a university department site than to any startup dashboard.

**Visual anchors (mostly locked, open to refinement with justification)**:
- **Typography**: DM Sans (display + body), JetBrains Mono (code/IDs). *Note: DM Sans appears in the `/impeccable` reflex-reject list — the project has chosen it deliberately for neutral institutional legibility. Agents may propose alternatives but must not silently override.*
- **Palette**: Deep Sapphire primary (`#3b6eb8`) + Warm Gold accent (`#eab308`) + warm stone neutrals (never pure black/white).
- **Theme**: light mode only. Dark-mode scaffolding exists at `src/styles/design-tokens.css` lines 339–356 but is not active; do not implement dark mode unless explicitly asked.
- **Density**: moderate. Generous padding around sections, compact within data rows. Breathing room over cramming.
- **Ornament**: minimal. Subtle borders (`--border-default`) over heavy shadows. Typographic hierarchy over color shouting. The 3px gradient accent bar in `ReservationRequests.css` is the high-water mark for decoration — anything more is too much.

**Anti-references (what this must NOT resemble)**: the union of (1) generic SaaS admin dashboards with their uniform Stripe-clone card grids, (2) consumer/playful apps with illustrations and emoji, (3) flashy startup marketing with gradient hero banners and animated CTAs, and (4) legacy SharePoint-era enterprise chrome. If a design choice could have been made by any of those four categories, make a different choice.

### Design Principles
1. **Token-driven, single source of truth**. All color/space/type comes from `src/styles/design-tokens.css`. No inline values, no new ad-hoc tokens without updating the source file.
2. **Accessibility is table stakes**. Reduced motion respected, focus rings visible, ARIA labels on interactive surfaces, color contrast meets WCAG AA at minimum.
3. **In-button confirmation for destructive actions**. Two-click patterns with state feedback — no browser `confirm()` dialogs. Enforced in CLAUDE.md; mirror the existing pattern.
4. **Institutional dignity over visual flash**. If a design choice needs a gradient, glow, or decorative animation to feel "finished," reach for typography and spacing instead.
5. **Data legibility first**. This is a scheduling tool. Calendars, lists, and review queues must be scannable at a glance. Ornament serves reading, never competes with it.
6. **Respect the user's time and judgment**. No patronizing tooltips, no celebratory micro-interactions on routine actions, no marketing voice. The interface assumes the user is a responsible adult handling real bookings.

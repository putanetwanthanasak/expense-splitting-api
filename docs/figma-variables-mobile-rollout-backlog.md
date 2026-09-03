# Figma Variables — Mobile rollout backlog

Deferred items found while binding the Figma **mobile** page (canvas `0:1`) frames to
the **Design System** variable collection (`ds/*` — colours, type scale, radii,
weights, font family).

Unlike the Desktop rollout (`docs/figma-variables-rollout-backlog.md`, §A–§G), the
mobile pass is **expected to produce visible changes**: the mobile frames were drawn
before reconciliation and drifted from both the shipped CSS and the token scale.
Mobile-specific size variables live under `ds/size/mobile/*` and are sourced from
`frontend/src/index.css` (the shipped mobile rules), **not** from
`frontend/src/styles/tokens.css` (which is desktop-only, `min-width: 1024px`).

**Rollout status: ALL 8 MOBILE FRAMES DONE.** `2:1121` Groups (pilot, + re-verification),
`2:1058` Login, `2:1093` Register, `2:1161` Invitations, `2:1200` Group detail,
`2:1260` Add expense (theme-independent only — see §N), `2:1332` Balance summary,
`2:1383` Settle up. Next: the code-fix batch (§L / §M / §N) + final summary.

Token set (12 size + 2 radius, all sourced from `frontend/src/index.css`):
`ds/size/mobile/{page-title 27, headline 20.7, section 19.8, body 18, button 17.1,
subtitle 16.2, amount 16.2, field-label 15.75, meta 15.3, label 14.4, tag 13.5,
badge 12.6}`, `ds/radius/mobile/{field 6.75, card 9}`. Collection went 53 → 67.

**§L final tally (bare `<h1>` not wrapped in `.page-head` → UA 36px):**
PRESENT (4) — Invitations `2:1161`, Add expense `2:1260`, Balance summary `2:1332`,
Settle up `2:1383`.
ABSENT (4) — Groups `2:1121`, Login `2:1058`, Register `2:1093`, Group detail `2:1200`.
Fix (mobile redesign): add `.page-head` wrappers to the 4 non-`.page-head` pages, or
add a `.page > h1` rule at `1.5rem` so all 8 page titles are 27px.

Token set now: `ds/size/mobile/{page-title 27, amount 16.2, label 14.4, badge 12.6,
body 18, subtitle 16.2, field-label 15.75, meta 15.3, section 19.8, tag 13.5,
button 17.1}`, `ds/radius/mobile/{field 6.75, card 9}` — all sourced from
`frontend/src/index.css` (file:line in each description). Reuse `ds/radius/pill`
(999) for pill tags where shipped CSS says `999px`. `.button-link` labels (`0.9rem`)
reuse `ds/size/mobile/subtitle` (16.2, same value/rem as `.page-subtitle`).

- **Colours:** bound to `ds/color/*` as the reconciliation **target** — *not* an
  exact match to what ships. A re-audit against the applied CSS rules confirmed the
  pilot's colours all diverge slightly from shipped mobile (Figma is drawn on the DS
  palette; shipped mobile renders the pre-DS placeholder palette — see §K), e.g. the
  group-name `<a>` ships `--accent` `#4338ca` (indigo) where Figma has near-black
  `#17211e`. The bindings are correct for the DS goal; the earlier "matches exactly"
  wording was numeric coincidence, now corrected.
- **Radii:** initially bound to desktop tokens (`ds/radius/card` 20, `ds/radius/field`
  14); **re-verified and rebound** to new mobile tokens — `ds/radius/mobile/field`
  (6.75, `0.375rem`) and `ds/radius/mobile/card` (9, `0.5rem`) — sourced from the
  actual `index.css` rules. Visible: pilot card corners tightened `20 → 9`, input
  `14 → 6.75`.
- **Typography:** family `Noto Sans Thai → IBM Plex Sans Thai` on every Thai node;
  title `24 → 27` + weight `400 → 700`; balance amount `28 → 16.2`; status labels
  `14 → 14.4` + weight `400 → 600`; badge `12 → 12.6` + weight `400 → 600` (stays
  Inter); subtitle `14 → 16.2`; group-name + input-value `16 → 18`.
- **Tokens created so far:** `ds/size/mobile/{page-title 27, amount 16.2, label 14.4,
  badge 12.6, body 18, subtitle 16.2}`, `ds/radius/mobile/{field 6.75, card 9}` —
  all sourced from `frontend/src/index.css` (cited file:line in each description).

**Carry-forward rules for the remaining 6 frames:**
- Reuse `ds/radius/mobile/field` / `ds/radius/mobile/card` and the existing
  `ds/size/mobile/*` tokens by default; only create a new mobile token when a frame
  has a genuinely different source rule + value.
- Decision 1 (bind colours to `ds/color/*`, DS collection = target) is settled
  project-wide. Don't re-litigate per frame — bind, add any newly-touched
  elements/rules to §K, move on. No per-frame "shipped renders" column unless a
  genuinely new pattern appears.

Sections continue the Desktop lettering: **§H** onward. Node ids are Figma node ids
in the `expense-splitting-api` file.

---

## §H — Mobile balance amount: Figma drew it larger than what ships

Figma's pre-reconciliation mobile Groups frame (`2:1121`) showed the group-card
balance amount (`2:1147` / `2:1153` / `2:1159`, e.g. `฿250.00`) at **28px** — notably
larger than the **16.2px** currently shipped (`frontend/src/index.css` `.net-amount`,
`font-size: 0.9rem` × the `--ds-size-base: 18px` root).

This may reflect an intentional "the amount should be the dominant figure" design
principle — the same one that drove desktop's Phase 19 bump of `--ds-size-money-row`
from 18 → 20 ("so the row amount reads as the dominant figure").

For this reconciliation pass the Figma frame was bound **to the shipped 16.2px value**
(`ds/size/mobile/amount`), matching what actually renders today. Whether mobile
*should* move to a larger, dominant balance figure is left open — worth revisiting
when mobile redesign implementation begins. Not addressed here.

---

## §I — `2:1121` nodes with no shipped `index.css` counterpart (design-ahead-of-code)

Same category as desktop's §D: the Figma frame models form structure the shipped
`GroupListPage.tsx` does not implement, so there is **no CSS rule to source a size
token from**. Left with `fontFamily → ds/font/thai` bound (correct regardless) but
`fontSize` unbound, literal `14px`.

- **`2:1136` "+ New group"** — a section heading above the create-group form. Shipped
  form (`GroupListPage.tsx` `.inline-form`) has no heading at all — just an
  `<input>` + submit `<button>` ("+ กลุ่มใหม่", `.inline-form button` `0.95rem`).
- **`2:1138` "Group name"** — a field `<label>` above the input. Shipped input carries
  only an `aria-label` / `placeholder` ("ชื่อกลุ่มใหม่"); there is no visible
  `<label>` element.
- **`2:1135` "New group" card wrapper** — a white rounded bordered card containing the
  above heading + label + input. Shipped is a bare `<form class="inline-form">`
  (`display: flex`, no border, no radius, no background) directly in `.page` — there
  is **no card wrapper**. Its radius was rebound `ds/radius/card` → `ds/radius/mobile/card`
  (9) during the re-verification pass for consistency with the real cards, but the
  wrapper itself is design-ahead-of-code.

Resolution: bind size if/when the shipped page grows these elements (and a real rem
value exists to cite), or when a mobile redesign decides their type role
deliberately. Not a forced fit to `ds/size/meta` in the meantime — that value (14)
is the desktop meta size and matches only the stale Figma literal, not any shipped
mobile rule.

Note: the other five "family-only" nodes from the first typography pass
(`2:1131` subtitle, `2:1140` input value, `2:1145` / `2:1151` / `2:1157` group names)
were **resolved**, not deferred — they *do* have shipped counterparts
(`.page-subtitle` `0.9rem` = 16.2px; `.group-list li` link + `.inline-form input`
`1rem` = 18px), so `ds/size/mobile/subtitle` (16.2) and `ds/size/mobile/body` (18)
were created from those rules and bound. `ds/size/mobile/subtitle` shares its
computed value with `ds/size/mobile/amount` (both `.page-subtitle` and `.net-amount`
are authored at `0.9rem`) but is kept as a separate token — distinct semantic role,
distinct source rule.

---

## §J — Auth-frame nodes with no shipped mobile counterpart (design-ahead-of-code)

### `2:1058` Login

`LoginPage.tsx` renders only: `<h1>` + two `<label>`s (each wrapping an `<input>`) +
`<p class="form-error">` + submit `<button>` + a `<p>` register link. `AuthBrandPanel`
is `display: none` below 1024px. Everything below has `fontFamily → ds/font/thai`
bound (and colour + radius where applicable) but **no size/weight token** — no CSS
rule to source one from:

- **`2:1065` / `2:1066` brand mark "หารกัน"** (24px, green) — no brand element renders
  on mobile auth (`AuthBrandPanel` hidden `< 1024px`). Also copy drift: the shipped
  wordmark (`.auth-brand-name`, desktop only) is "แบ่งจ่าย", not "หารกัน".
- **`2:1069` form subtitle "แบ่งค่าใช้จ่ายง่าย ๆ…"** (14px) — `LoginPage.tsx` has no
  subtitle between the `<h1>` and the form.
- **`2:1079`–`2:1083` red inline-notice box** (icon + title + description, `#fcecee`
  bg) — mobile renders a plain `<p class="form-error">` (`0.875rem`, `--error`). The
  boxed treatment with icon exists only on desktop (`desktop.css` `.form-error`
  restyle, 7:18/7:20). `2:1082` title text maps to `.form-error` → bound
  `ds/size/mobile/field-label` (15.75); `2:1083` description has no counterpart →
  family only. Box fill `#fcecee` → `ds/color/notice-401-bg` (snapped, Decision 2a);
  radius `14` → `ds/radius/mobile/field`.
- **`2:1087`–`2:1091` amber "Please log in again" notice** (`#fff4d8` bg, `#9b6b18`
  key icon + title) — the mobile Login page renders no session-expired notice at all.
  `2:1090` / `2:1091` text → family only. Fill `#fff4d8` → `ds/color/notice-403-bg`,
  icon/title `#9b6b18` → `ds/color/warning` (snapped, Decision 2a); radius `14` →
  `ds/radius/mobile/field`.

### `2:1093` Register

Structurally identical to `LoginPage.tsx` (`.auth-card` → `<h1>` + form with N
`<label>`/`<input>` + `.form-error` + submit + link `<p>`), so all bindings reuse
Login's token set. New design-ahead-of-code nodes:

- **`2:1448` / `2:1449` back arrow** in the page header — `RegisterPage.tsx` renders
  no back control (the auth pages have no in-page nav; `AuthBrandPanel` is hidden
  `< 1024px`). Icon stroke `#17211e` → `ds/color/text` (colour only; it's a vector).
- **`2:1103` form subtitle "เริ่มแบ่งบิลกับกลุ่มของคุณ…"** — same as Login `2:1069`;
  no subtitle between `<h1>` and the form in `RegisterPage.tsx`. Family-only.

Register has **no notice nodes at all** (Figma models none; shipped shows only a
plain `.form-error` `<p>`), so none of Login's off-palette notice colours recur here.
The password field placeholder `2:1116` `#94a09c` "At least 8 characters" → bound
`ds/color/text-faint` (no shipped `::placeholder` rule — browser default; text-faint
is the DS role for faint/placeholder text).

### `2:1161` Invitations

`InvitationsPage.tsx` renders `.page` → `<h1>` + conditional `.page-subtitle` +
`<ul class="invitation-list">` of `<li class="invitation-row">` (a horizontal flex
row: `.invitation-info` on the left, two `.invitation-actions button`s on the right).
Design-ahead-of-code nodes:

- **`2:1472` / `2:1473` back arrow** — no back control in `InvitationsPage.tsx`; the
  Figma frame also omits the persistent `<NavBar>` the shipped app renders on authed
  pages (see §K). Icon stroke → `ds/color/text` (colour only).
- **`2:1176` / `2:1187` "Pending" tag** (amber `#fff4d8` fill, `#9b6b18` text,
  radius 99) — `.invitation-row` ships **no** pending tag. (`.pending-tag` exists but
  renders only in `GroupDetailPage` — frame 5.) Fill → `ds/color/notice-403-bg`,
  text → `ds/color/warning` (snapped, Decision 2a); radius `99` → **`ds/radius/pill`
  (999)** — shipped `.pending-tag { border-radius: 999px }` is an explicit pill, so
  unlike the pilot's skipped `99` (`2:1132`, a design-only shortcut) this snaps.
  `2:1177` / `2:1188` label text → family only (`0.75rem` shipped ≠ Figma 12 anyway).
- **`2:1195`–`2:1198` empty-state box** (`#f8faf9` fill, mail-check icon, title,
  desc) — shipped empty state is a bare `<p class="centered-status">` (no box, no
  icon, no dashed border). Fill `#f8faf9` → `ds/color/row-wash` (`#f7faf9`, snapped);
  radius `20` → `ds/radius/mobile/card`; icon stroke `#176b57` → `ds/color/brand`.
  `2:1197` / `2:1198` text → family only.

Resolved (real counterparts): title → `page-title` (27, see §L); subtitle →
`subtitle` (16.2, `.page-subtitle`); group name → `body` (18) + `weight/semibold`
(`.invitation-group-name { font-weight: 600 }`, no size → root `1rem`); inviter line
→ `meta` (15.3, `.muted` `0.85rem`); Accept/Decline labels → `meta` (15.3,
`.invitation-actions button` `0.85rem`). Copy drift (trivial, §E-style): Figma
"Invited by {name}" vs shipped `.muted` "เชิญเมื่อ {date}".

### `2:1200` Group detail

`GroupDetailPage.tsx` renders `.page` → back-link `<p>` + `.page-head` (`<h1>` +
`.page-actions` nav of 3 `.button-link`s) + `<section><h2>สมาชิก</h2>` (`.member-list`
of bare `<li>`s, `.pending-tag` on PENDING rows, `.inline-form.invite-form`,
`.invite-confirm` div) + `<section><h2>รายการค่าใช้จ่าย</h2>` (`.expense-list` of
`<li>` = `.expense-desc` + `.expense-amount` + `.expense-meta` + `.expense-actions`).

**§L check — NOT present.** `GroupDetailPage`'s `<h1>` *is* wrapped in `.page-head`
→ `.page-head h1` `1.5rem` = 27px, same as Groups/Login/Register. The bare-`<h1>`
UA-36px bug is so far **Invitations-only**.

Design-ahead-of-code (family-only for size; colour/radius bound where a DS token
exists):
- **`2:1487`/`2:1488` back arrow** — shipped uses a text back-link `<p><Link>← กลุ่มทั้งหมด`.
- **`2:1210` subtitle "4 members · updated today"** — `GroupDetailPage`'s `.page-head`
  has no `.page-subtitle` (h1 + nav only).
- **`2:1221`/`2:1224`/`2:1227` member-row avatars** (ellipses) — `.member-list li` has
  no avatar element (bare `<span>{name} <span class="muted">({email})</span>`).
  Fills `#e4f3ed` → `ds/color/brand-wash`, `#dde5e1` → `ds/color/border`; strokes
  `#ffffff` → `ds/color/surface`.
- **`2:1234` "Email" label** in the invite form — `.inline-form.invite-form` has no
  visible `<label>` (input carries `aria-label` + `placeholder` only).
- **`2:1237` "✓ Found: Praew S." match line** — shipped `.invite-confirm` shows a
  plain `<p>` "เชิญ {name} ({email}) …?" (inherits 18px), not a green match indicator.
  Colour `#16815f` → `ds/color/brand` (exact); size family-only.
- **`2:1231` "Invite member" card wrapper** — the shipped invite form is not wrapped
  in a card; `.invite-confirm` (a card) only appears post-lookup. Radius `20` →
  `ds/radius/mobile/card`.

Resolved (real counterparts): title → `page-title` (27); section `<h2>`s → **new
`ds/size/mobile/section` (19.8, `.page h2` `1.1rem`)** + `weight/bold` (UA `<h2>`);
member names → `body` (18); pending-tag label → **new `ds/size/mobile/tag` (13.5,
`.pending-tag` `0.75rem`)**, radius `99` → `ds/radius/pill` (999); Send-invite button
→ **new `ds/size/mobile/button` (17.1, `.inline-form button` `0.95rem`)**; action
pills → `subtitle` (16.2, `.button-link` `0.9rem`); expense desc → `body` (18) +
`weight/semibold` (`.expense-desc`); expense meta → `meta` (15.3, `.expense-meta`
`0.85rem`); expense amount → `body` (18, `.expense-amount` has no `font-size` → root
`1rem`) + `weight/bold` (`.expense-amount { font-weight: 700 }`).

`.net`-pattern check: none — `.expense-amount` has `font-variant-numeric: tabular-nums`
but **no `font-family`** on mobile (inherits `--ds-font-thai`); the numeral-font
restyle is desktop-only (`desktop.css`, per the `.expense-amount` comment). ✓
`§C` zero-radius: none — every card/pill/tag/input/button has a non-zero radius.

Minor (Figma-side, §A-style): after the action-label bump `12 → 16.2`, the first
action pill ("＋ Add expense") clips — the pill is hug/fixed and didn't grow. Not a
binding error; the Figma node needs `fill`/resize or a wider min. Tracked, not fixed.

---

## §K — Mobile `index.css` still on the pre-DS placeholder palette (whole-stylesheet)

The 8 legacy custom properties in `frontend/src/index.css` —
`--bg` `#ffffff`, `--fg` `#1a1a2e`, `--muted` `#6b6375`, `--border` `#d9d7de`,
`--accent` `#4338ca` (indigo), `--error` `#b91c1c`, `--pos` `#15803d`, `--neg`
`#b91c1c` — predate the Design System collection. `--ds-color-*` is consumed **only**
by `styles/desktop.css`, entirely inside `@media (min-width: 1024px)`. Below the
breakpoint (the whole mobile layout) nothing references `--ds-color-*`.

**Scope (grep of `index.css` + all `.tsx` — legacy vars appear only in `index.css`,
zero inline styles, ~65 rules):**

| area | legacy-palette elements |
| --- | --- |
| Global (all 8 pages) | `:root` base text `--fg` + bg `--bg`; every `<a>` → `--accent`; `.nav-bar` border, `.nav-link` `--muted`, `.nav-link-active` `--fg`, `.nav-badge` `--accent`; `.muted`, `.centered-status`, `.page-subtitle` `--muted` |
| Login / Register | `.auth-card` label/input/button (`--muted` `--border` `--bg` `--fg` `--accent`); `.form-error` `--error` |
| Group list | `.inline-form` input+button; `.group-list li` border; `.net-pos` / `.net-neg` / `.net-zero` |
| Group detail | `.expense-list li` border; `.expense-meta`; `.pending-tag`; `.invite-confirm`; `.confirm-inline`; action buttons `--accent` |
| Add expense | `.expense-form` label/input/select; `.participants` + legend; `.split-row-name` `--fg`; `.split-value`; `.running-total-off` `--neg`; `.split-hint`; `.preview` border; `.remainder` `--pos`; submit button `--accent` |
| Balance summary | `.balance-summary` border; `.balance-tree .tree-branch` `--muted`; `.button-link.secondary` `--accent` / `--border` |
| Settle up | `.settle-note` `--accent` border; `.transfer-row` / `.history-list li` border; `.transfer-row button` `--accent`; `.empty-state` `--muted` / `--border` |
| Invitations | `.invitation-row` border; `.notice` `--accent` border; `.invite-confirm-actions button` `--accent`; `.empty-state` |

**Decision:** the Figma → `ds/color/*` bind proceeds now (Figma becomes the accurate
spec). The **code** migration of `index.css` off the placeholder palette is
**deferred to mobile redesign implementation** — it is a full-stylesheet change
(~65 rules, all 8 pages), and those pages are slated for rewrites that will target
`--ds-color-*` directly. Not worth a standalone code fix in the meantime. Later
frames add their touched elements to the table above rather than re-analysing.

**Confirmed by frame:** Invitations `2:1161` — every colour behaves as the table
predicts (Accept button `--accent` indigo shipped vs Figma green → `ds/color/brand`;
`.invitation-row` border `--border`; etc.). No new pattern. Also: the Figma frame
**omits the persistent `<NavBar>`** (`.nav-bar` / `.nav-link` / `.nav-badge`) that
the shipped app renders on every authed page — Figma uses a per-page back arrow
instead. Structural divergence for the redesign to reconcile; nothing to bind.

**Group detail `2:1200`** — confirms the table (`.button-link` actions ship
`--accent` indigo vs Figma green wash → `ds/color/brand` + `ds/color/brand-wash`;
`.member-list li` / `.expense-list li` borders `--border`; `.pending-tag` text
`--muted`; expense amount inherits `--fg`). One extra: the pale green `#e4f3ed`
(action pills, member avatars) → `ds/color/brand-wash` (`#e7f3ef`, Δ ≈ 2–3/255).
The blue `#eaf2f8` / `#496a8a` on this frame is a *separate* issue — see §M.
Also: Figma omits `<NavBar>` here too (per-page back arrow instead).

---

## §L — Shipped `<h1>` inconsistency: `InvitationsPage` bare `<h1>` renders at UA 36px

`GroupListPage` wraps its title in `.page-head` → `.page-head h1 { font-size: 1.5rem }`
= 27px. `LoginPage` / `RegisterPage` use `.auth-card h1 { font-size: 1.5rem }` = 27px.
But `InvitationsPage.tsx` (line 107) renders a **bare `<h1>` directly in `.page`** —
there is no `.page h1` rule, so it falls to the UA default `font-size: 2em` = **36px**
(`font-weight: bold`).

This is a shipped-code inconsistency, not a design intent — the Figma frame draws the
Invitations title at 24px, same as every other frame's title. For the reconciliation
pass the node (`2:1170`) was bound to **`ds/size/mobile/page-title` (27)** for
cross-page consistency, matching Figma's intent and the other three page titles.

Check the remaining frames (Group detail `2:1200`, Add expense `2:1260`, Balance
summary `2:1332`, Settle up `2:1383`) for the same bare-`<h1>` pattern. Fix belongs
in the mobile redesign: either add `.page-head` wrappers or a `.page > h1` rule so
every page title is 27px.

**Progress:** Group detail `2:1200` — absent. Add expense `2:1260` — **PRESENT**
(`AddExpensePage.tsx:362`). Balance summary `2:1332` — **PRESENT**
(`BalanceSummaryPage.tsx:76` bare `<h1>ยอดคงเหลือ</h1>` in `.page balance-summary-page`).
Running tally is in the Rollout-status block at the top.

---

## §M — Off-palette "info / neutral" blue: no Design System colour equivalent

Group detail `2:1200` introduces a **blue/slate treatment the 21-colour DS palette
has no token for**:

- **`#eaf2f8`** (pale blue wash) — `2:1229` PENDING-member tag background, `2:1240`
  "You can't invite members here" notice background.
- **`#496a8a`** (slate blue) — `2:1230` "Invite pending" tag text, `2:1491`
  circle-help icon, `2:1243` notice title.

Nearest DS tokens are nowhere close (`ds/color/text-muted` `#687570` is grey-green;
the notice washes `notice-401-bg` `#fbeceb` / `notice-403-bg` `#fbf4e9` are
pink/cream). The DS collection has brand (green), danger (red), warning (amber) and
the two notice washes — **no info/neutral blue**.

These 4 fills + 1 stroke were **left unbound** (literal), not snapped. The shipped
app doesn't render this treatment at all — the mobile `.pending-tag` is a grey
bordered pill (`border: 1px solid var(--border); color: var(--muted)`), and the
403 message is a plain red `.form-error` `<p>` — so it's also design-ahead-of-code
(§J). Radius and text-size *were* bound (`ds/radius/pill`, `ds/radius/mobile/field`,
`ds/size/mobile/tag`) since those have clear answers.

**Resolution:** the mobile redesign either (a) adds an `info`/`neutral` colour set
to the DS collection (bg + text + border), or (b) restyles these to an existing DS
role (e.g. the warning wash, matching how `.pending-tag` reads as a "pending"
state). Watch the remaining 3 frames for more `#eaf2f8`/`#496a8a` usage and add it
here.

**Recurrence:** Add expense `2:1260` — the "Remainder note" pill (`2:1317` fill
`#eaf2f8`, `2:1318` text `#496a8a`) is **byte-identical** to Group detail's blue.
It shows up on a light frame *and* a dark one, so the blue "info" chip is
theme-independent — the DS `info` colour should be added as a real token pair, not
treated as a one-off.

---

## §N — Add expense `2:1260` is the only dark-themed mobile frame

The `2:1260` frame is designed in **dark mode** — frame `#101815`, text `#f3f7f5`,
surfaces `#18231f` / `#202d28`, borders `#30413a`, muted `#aab8b2`, active
segmented option `#176b57`. Every other mobile frame (`2:1121`, `2:1058`, `2:1093`,
`2:1161`, `2:1200`, `2:1332`, `2:1383`) is light.

The **"Design System" collection (`VariableCollectionId:53:87`) is light-only** — a
single "Value" mode, no dark-mode variant (confirmed: nothing in `tokens.css`, no
`prefers-color-scheme`). So there are **no dark `ds/color/*` tokens** to bind these
fills/strokes to, and snapping them to the light tokens would invert the mockup.

**Done (Option a):** radii and typography were bound normally (theme-independent) —
cards → `ds/radius/mobile/card`, inputs / segmented track / `.split-value` inputs /
submit → `ds/radius/mobile/field`, remainder pill → `ds/radius/pill`; title →
`page-title`, field labels → `field-label`, input values / participant names /
preview names+amounts / submit label → `body`, `.split-value` amount inputs →
`button` (17.1), balance hint → `meta`, "Live split preview" `<h2>` → `section`,
family → `ds/font/thai`. **No new tokens.** The two non-dark colour elements — the
disabled submit button (`2:1329` fill+stroke `#dde5e1`, `2:1330` text `#687570`) —
bound to `ds/color/border` / `ds/color/text-muted` (exact).

**Left unbound (literal):** all dark fills/strokes (~49 fills, 12 strokes); the 4
segmented-option radii (`8`, design-ahead-of-code — shipped uses a `<select>`, not
a segmented control, per desktop §D); the `#eaf2f8`/`#496a8a` remainder pill (§M).

**Resolution:** colours reconcile once either (i) a dark-mode token set is added to
the collection, or (ii) this frame is redrawn in light to match the other 7.

`.net`-pattern check (done): the preview section (`2:1310`–`2:1328`) models
**Name / Amount / Remainder as separate nodes per row**, matching the shipped
`.preview-name` / `.preview-amount` / `.remainder` split (PR #22). No
Thai-through-numeral-font bug. ✓

`§C` zero-radius: none.

---

## §O — Balance summary `2:1332`

`BalanceSummaryPage.tsx` renders `.page` → back-link `<p>` + bare `<h1>` (§L) +
`.balance-summary` section (`.balance-headline` = `<span class="…-label">` +
`<span class="…-amount">`, then `.balance-tree` `<ul>` of combined-string `<li>`s) +
`<section><h2>` + `.member-balances` `<ul>` of **combined-string `<li>`s** + a
`.button-link` + the `.empty-state` (shown *instead* when all settled).

**`.net`-pattern — CLEAN (verified against `BalanceSummaryPage.tsx` + `balance-summary.ts`).**
`describeViewerBalance` returns `headlineLabel` + `headlineAmount` separately
(`balance-summary.ts:36-38`), rendered as two spans (`.tsx:140-143`). On mobile
neither `.balance-headline-label` nor `.balance-headline-amount` has any rule in
`index.css` — both inherit `.balance-headline` (`1.15rem`/600, Thai font); the
`--ds-font-numeric` on the amount span is **desktop-only**. `.balance-tree li` and
`.member-balances li` are single combined strings but inherit `--ds-font-thai`
(no numeral-font). No element mixes Thai + numeral font. The Figma frame models
label (`2:1344`) / amount (`2:1345`) as separate nodes — matches. ✓

**§L — PRESENT** (`.tsx:76`). **§C — no bug**: every `radius: 0` node is a layout
container, status-bar chrome, or the `2:1346` "Breakdown" tree-connector frame
(carries a `#16815f` left-border stroke → `ds/color/brand`, radius stays 0).

**New token:** `ds/size/mobile/headline` = 20.7 (`.balance-headline` `1.15rem`) +
`weight/semibold` — bound to `2:1344`/`2:1345` (Figma had label 16 / amount **34**;
34 is the *desktop* `ds/size/headline`, not mobile).

Reused: title → `page-title` (27); `<h2>` → `section` (19.8); tree explanation +
tree amount + member names → `body` (18) (`.balance-tree` / `.member-balances` have
no `font-size` → root `1rem`); colours mostly exact (`#16815f` here is the *correct*
brand green — this frame didn't use `#176b57` except the party-popper vector).

Snaps: `2:1343` "Your standing" card `#e5f6ef` → `ds/color/brand-wash` (`#e7f3ef`,
Δ≈2–3/255; shipped `.balance-summary` has no bg, just a border — Figma models it as
a wash card); `2:1378` empty-state `#f8faf9` → `ds/color/row-wash`; party-popper
`#176b57` → `ds/color/brand`.

**§J (design-ahead-of-code) new nodes:**
- `2:1339`/`2:1515` back arrow — shipped uses a text back-link.
- `2:1342` subtitle "Dinner Club · สรุปเป็นภาษาง่าย ๆ" — no `.page-subtitle` in
  `BalanceSummaryPage`.
- `2:1360`/`2:1361` PENDING tag "คุณ / you" on the member card — `.member-balances li`
  has no tag (it's a flat string). Radius `99` → `ds/radius/pill`; colours `#eaf2f8`
  / `#496a8a` left unbound (§M).
- `2:1362`/`2:1369`/`2:1376` position labels + `2:1363`/`2:1370`/`2:1377` member
  amounts — the Figma "Member standings" rows split name / small position label /
  large amount into a 3-part hierarchy; shipped `.member-balances li` is **one flat
  `1rem` string** ("{name} — ควรได้รับคืน {amount}"). Names bound to `body` (18);
  the position labels (12) and amounts (24) have no separate shipped element →
  **size family-only**. Colours bound (`#16815f`/`#c94d55` exact).
- `2:1380`/`2:1381` empty-state title + description — Figma combines emoji into the
  heading; shipped `.empty-state` is `.empty-state-emoji` `<p>` (`1.75rem`) + text
  `<p>` + link `<p>`. Structure differs → size family-only (same treatment as
  Invitations `2:1197`/`2:1198`).

**§M recurrence:** `2:1360`/`2:1361` — the same `#eaf2f8` / `#496a8a` blue, now on
its **third** frame (Group detail, Add expense, Balance summary). Left unbound.

---

## §P — Settle up `2:1383`

`SettleUpPage.tsx` renders `.page` → back-link `<p>` + bare `<h1>ชำระยอด</h1>` (§L) +
`<section><h2>` + `.settle-note` (two `<p>`s) + `.transfer-list` `<ul>` of
`.transfer-row` `<li>` (`<span>{from} ควรจ่าย {to} <strong>{amt}</strong></span>` +
mark-paid `<button>`) + `<section><h2>` + `.history-list` `<ul>` of `<li>`
(`<span>{from} จ่าย {to} <strong>{amt}</strong></span>` + `.muted` date span) +
`.empty-state` (per-section, shown instead when empty).

**§L — PRESENT** (`.tsx:115`). **§C — no bug**: all `radius: 0` nodes are layout
containers, status-bar chrome, or icon frames.

**`.net`-pattern — CLEAN (verified against `SettleUpPage.tsx` + `index.css` +
`desktop.css`).** The row text is one `<span>` = Thai names + a nested `<strong>`
wrapping **only** the ฿ amount. `--ds-font-numeric` on `.transfer-row strong` is at
`desktop.css:990-991` — **desktop-only** (`@media (min-width: 1024px)` / `.app-shell`).
On mobile the whole string (strong included) is `--ds-font-thai`. The Figma frame
goes further and models every amount as a **fully separate node** (`2:1398`,
`2:1403`, `2:1414`) — no node mixes Thai + numeral font. (Matches the desktop
audit's finding for `13:210`.)

**No new tokens** — the last frame reused everything. **No §M blue** on this frame.

Bindings: title → `page-title` (27); `<h2>`s → `section` (19.8); cards + empty-states
`20` → `mobile/card` (9) (`.transfer-row` / `.history-list li` / `.empty-state` all
`border-radius: 0.5rem`); mark-paid buttons `#176b57` → `ds/color/brand`, radius `14`
→ `mobile/field` (`.transfer-row button` `0.375rem`), label → `meta` (15.3,
`.transfer-row button` `0.85rem`); transfer instruction + history transfer text →
`body` (18) (`.transfer-row` / `.history-list li` have no `font-size` → root `1rem`),
instruction colour `#687570` → `ds/color/text-muted` (Figma greys it; shipped
inherits `--fg`); transfer note `2:1406` → `subtitle` (16.2, `.settle-note p`
`0.9rem` — wins over `.muted` `0.85rem` on specificity), colour `#94a09c` →
`ds/color/text-faint`; history date → `meta` (15.3, `.muted` `0.85rem`).

**§J (design-ahead-of-code):**
- `2:1390`/`2:1530` back arrow — shipped uses a text back-link.
- `2:1393` subtitle "รายการโอนที่แนะนำ · Dinner Club" — no `.page-subtitle` in
  `SettleUpPage`.
- `2:1398`/`2:1403` transfer amounts (28, red) + `2:1414` history amount (24, green)
  — shipped `<strong>` is **inline in the row string at `1rem`**, not a separate
  emphasized/coloured element. Figma pulls each out as a big standalone node (and
  reddens the transfer amount). Size family-only; colour bound (`#c94d55` /
  `#16815f` exact).
- `2:1406` transfer note — Figma has no `.settle-note` left-border box; it's a bare
  text node. Minor.
- `2:1415`–`2:1418` + `2:1419`–`2:1422` two empty-state boxes — Figma folds emoji
  into the heading; shipped `.empty-state` = emoji `<p>` (`1.75rem`) + text `<p>`.
  Size family-only (same treatment as Invitations / Balance summary).

Snaps: `2:1415`/`2:1419` empty-state `#f8faf9` → `ds/color/row-wash`; the two
mark-paid buttons + receipt/party-popper icon strokes `#176b57` → `ds/color/brand`.

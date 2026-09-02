# Figma Variables — Desktop rollout backlog

Deferred items found while binding the Figma Desktop frames to the **Design System**
variable collection (`ds/*` — colours, type scale, radii, weights, font family).

**Rollout status:** every Desktop frame is bound — `9:2` Groups (pilot), `11:30`
Group Detail, `13:45` Add Expense, `13:146` Balance Summary, `13:210` Settle Up,
`7:2` Login, `7:24` Register, `10:16` Invitations — plus the shared component library
(`5:3` Sidebar, `6:2`–`6:22`). Node ids below are Figma node ids in the
`expense-splitting-api` file.

Sections are stable: **§A–§G**. `§B`, `§C`, `§E` are resolved (see per-item notes);
`§A`, `§D` are reference-only; `§F`/`§G` are component-library follow-ups.

The mobile page (canvas `0:1`) is a separate, expected-to-visibly-change pass and is
**not** covered here.

---

## §A — Figma text nodes lacking maxWidth / truncation (overflow on long real data)

Reference only — no fix scheduled. These nodes are `textAutoResize: WIDTH_AND_HEIGHT`
+ `textTruncation: DISABLED` + no `maxWidth`, so long production data overflows in
Figma (`clipsContent: false`). The type-scale bump (+13–17%) widens it, it did not
create it. The **shipped app is mostly safe** — CSS wraps or ellipsis-truncates.

Fix when convenient: give each node a fill/fixed width + `textTruncation: ENDING`
(or `maxLines`) so the Figma component matches the shipped wrap/ellipsis behaviour.

| where | node(s) | note |
|---|---|---|
| Sidebar `5:3` footer name | `5:17` | long name runs ~20px past the 260px sidebar edge. Shipped `.ds-sidebar-user` already ellipsis-truncates. |
| Group Detail `11:30` expense description | `11:83…` (`.expense-desc`) | **top concern** — user free text, HUG in a ~520px slot, overflows past ~35 Thai chars. Shipped wraps. |
| Group Detail expense meta | `11:84…` (`.expense-meta`, payer + date) | long payer names push it wide; shares the ~520px left stack. Wraps. |
| Group Detail member name | `11:64…` (`.member-list li`) | HUG, no truncation; the shipped app also appends the full email inline (`.muted (email)`), which the Figma row omits, so the real row is wider than modelled. |
| Add Expense `13:45` preview row 1 w/ remainder tag | `13:129` | tightest spot: 376px card, name + ฿ + "+0.01" tag ≈ 285px → ~90px slack (~8 Thai chars). |
| Add Expense participant name rows | `13:95`–`13:98` | ~390px for the name before the right-side share/tag group (~35 chars). |
| Balance Summary `13:146` balance-tree rows | `13:173` / `13:174` | 520px FIXED `SPACE_BETWEEN`; ~280px slack for the "{name} ควรจ่ายคุณ" left side. Shipped `.balance-tree li` is one wrapping string. |
| Invitations `10:16` group name + info line | `10:39`/`10:48` (`.invitation-group-name`), `10:40`/`10:49` (`.invitation-info .muted`) | HUG, no truncation, both real user data. ~515px headroom in the 720px card before the accept/decline buttons. Shipped rows wrap. |

---

## §B — "`.net`-style" bug: Thai text rendered through `--ds-font-numeric` (Inter) — **RESOLVED**

Same defect each time: a Thai label and a ฿ amount live in **one** element whose CSS
sets `font-family: var(--ds-font-numeric)`, so the Thai label renders in the
numeral-only face (Inter). Figma models each as **separate** nodes. Fix = split the
element into a Thai label span + an Inter amount span.

| # | element | fix |
|---|---|---|
| 1 | Groups `.net` (`GroupListPage.tsx`) | **PR #21** — `fix/net-position-split`. `NetPosition` → `.net` wrapper + `.net-label` (Thai) + `.net-amount` (Inter). Matches Figma `9:30` / `9:32`. |
| 2 | Add Expense `.preview ul` `<li>` (`AddExpensePage.tsx`) | **PR #22** — `fix/split-thai-numeral-spans` (stacked on #21). `{name}: {amount}` → `.preview-name` (Thai) + `.preview-amount` (Inter); `.remainder` given `--ds-font-thai`, parentheses dropped (`+฿0.01 เศษสตางค์`, matches Figma `Tag/Remainder` 6:10). Matches Figma `13:136` / `13:138`. |
| 3 | Balance Summary `.balance-headline` (`BalanceSummaryPage.tsx`) | **PR #22**. `describeViewerBalance` returns `headlineLabel` + `headlineAmount` (`null` when settled) instead of one interpolated string; page renders `.balance-headline-label` (Thai, `--ds-size-section`) + `.balance-headline-amount` (Inter, `--ds-size-headline`). `.net-pos`/`.net-neg`/`.net-zero` stays on the wrapper. Matches Figma `13:169` / `13:170`. |

All 3 known occurrences are fixed. Keep this section as the pattern record — add new
occurrences here if the mobile-page pass surfaces any.

**Not bugs (checked):**

- `.balance-tree li` and `.member-balances li` (`13:146`) are also combined
  label+amount strings, but they inherit `--ds-font-thai` — no numeral-font bug, just
  a structural difference. No fix.
- `.transfer-row` and `.history-list li` (`13:210`) are
  `{thai} … <strong>{formatMoney(…)}</strong>` — `--ds-font-numeric` sits on the
  `<strong>`, which wraps only the ฿ amount, so the Thai stays in `--ds-font-thai`.
  This is the correct pattern, done inline.

---

## §C — Zero-radius Figma frames — **RESOLVED**

`13:45` / `13:146` / `13:210` were mocked before the radius-token pass — every
card/input/button/tag had `cornerRadius: 0` on all four corners. Not caused by the
variable binding (the bind only reads and value-matches radii; `0` matches nothing).
The shipped CSS rounds all of these.

Applied `ds/radius/*` to **26 nodes** across the three frames in one pass:

| category | → variable (px) |
|---|---|
| cards (FormCard, PreviewCard, HeadlineCard, AllBalancesCard, SuggestedCard, HistoryCard) | `ds/radius/card` (20) |
| inputs + Add-Expense submit / disabled (`.expense-form input` / `button[type=submit]`) | `ds/radius/field` (14) |
| transfer rows, transfer buttons, segmented active/inactive pills | `ds/radius/sm` (10) |
| segmented track, cancel button | `ds/radius/control` (12) |
| Tag/Remainder | `ds/radius/pill` (999) |
| empty-states (all dashed panels) | `ds/radius/panel` (16) |

Before/after screenshots confirmed: corners round in, nothing else moves. Checkbox
rects (`13:103`–`13:106`, radius 6) left alone — no `--ds-radius` equals 6.

Only `9:2` and `11:30` were built with real radii; the three Phase-18 detail frames
had to be done here.

---

## §D — "Design ahead of code": Figma models UI the shipped app doesn't implement

Reference notes for future feature work; no action.

**Add Expense `13:45`:**

1. Segmented split-type control (`13:71`–`13:79`: เท่ากัน / ระบุจำนวน / เปอร์เซ็นต์ /
   สัดส่วน). Shipped uses a `<select>`. `--ds-segmented-height: 44px` exists in tokens
   but there is no `.segmented` CSS.
2. Cancel button top-right (`13:66`/`13:67` "ยกเลิก"). Shipped: `← กลับไปที่กลุ่ม`
   back-link at the top of the page.
3. Header subtitle (`13:65` "group · แบ่งกับสมาชิก N คน"). Shipped: the back-link is
   in that slot, no subtitle.
4. Per-participant-row ฿ share readout + remainder tag (`13:111`–`13:116`). Shipped
   `.split-row` shows only the name (EQUAL) or a `.split-value` input.
5. Preview subtitle + total row (`13:127`, `13:142`–`13:144`). Shipped `.preview` is
   `<h2>` + `<ul>` + optional `.muted`.
6. Disabled-submit example block (`13:121`–`13:124`) — a design annotation, not a real
   element.

**Balance Summary `13:146`:**

7. Header subtitle `13:165` (shipped: back-link).
8. "สถานะของคุณ" eyebrow `13:167` above the headline (shipped: none).
9. "แยกเป็นรายคน" label `13:172` above the balance tree (shipped: none).
10. Section subtitle `13:185` under the "ยอดของสมาชิกทุกคน" h2 (shipped: none).
11. Member-row avatars `13:195`–`13:198` (shipped `.member-balances li` = plain text).
12. Frame stacks AllBalancesCard + the all-settled EmptyState together (the app shows
    one or the other).

**Settle Up `13:210`:**

13. Header subtitle `13:229` (shipped: back-link).
14. `.settle-note` position + shape — Figma puts the disclaimer line (`13:244`) at the
    **bottom** of the SuggestedCard as one muted line; shipped `.settle-note` sits
    **above** the transfer list and is two `<p>`s (a `note` + a `muted` with
    `<strong>` inside).
15. No-transfers empty state (`13:245`) — Figma has no `🎉` emoji; shipped
    `.empty-state` renders `<p class="empty-state-emoji">🎉</p>` + a different line.
16. No-history empty state — Figma models a full dashed panel `13:250` (heading
    `13:251` + explanation `13:252`); shipped is a single
    `<p class="centered-status">ยังไม่มีประวัติการชำระเงิน</p>` — no panel, no 2nd
    line. `13:252` is design-only.
17. Frame stacks the populated SuggestedCard + the no-transfers EmptyState together.

**Login `7:2` / Register `7:24`:**

18. BrandPanel (`7:3`/`7:25`) shows a plain white Ellipse (`7:4`/`7:26`) where the
    shipped `.auth-brand-panel` renders the `.auth-brand-name` "แบ่งจ่าย" wordmark
    text (from `<AuthBrandPanel>`). Figma omits the wordmark text node.

---

## §E — Copy / colour drift (Figma vs shipped)

- **Balance Summary `13:146`** — Figma h1 "สรุปยอดคงเหลือ" vs shipped `<h1>` "ยอดคงเหลือ".
  Trivial, no action.
- **Settle Up `13:210`** — Figma h2 "การโอนที่แนะนำ" (`13:231`) vs shipped `<h2>`
  "รายการที่แนะนำให้ชำระ". Trivial, no action.
- **Settle Up `13:210`** — Figma no-transfers heading "ไม่มียอดต้องโอน" (`13:246`) vs
  shipped `<p>` "กลุ่มนี้ชำระยอดครบแล้ว — ไม่มีรายการที่ต้องชำระ" (also §D #15).
- **Login / Register `7:2` / `7:24`** — colour drift: `.auth-brand-desc` node
  (`7:6`/`7:28`) fill was `#eaf5f0`; shipped uses `var(--ds-color-brand-wash)` =
  `#e7f3ef`. **RESOLVED** — nudged both nodes to `#e7f3ef` and bound to
  `ds/color/brand-wash`. Imperceptible on the green panel.

Also fixed in passing: `11:77` Tag/Pending (in `11:30`) carried pre-existing
**off-palette** fill overrides (`#ffd76e` tag / `#0b0800` text) that predated the
rollout and contradicted both component `6:8` and the shipped `.pending-tag` CSS
(`--ds-color-warning-wash` / `--ds-color-warning`). `resetOverrides()` cleared them;
the tag now matches the design system. Visible change: bright yellow → muted beige.

---

## §F — Detached copies vs component instances — **PARTLY RESOLVED**

The three Phase-18 detail frames used **detached local FRAME copies** named after
library components (`Button/*`, `Tag/*`, `EmptyState`), not real instances — so
binding a source component does not propagate to them. They are **not broken** (each
was token-bound during its frame pass and rounded in §C), they just won't pick up
future component edits. The only pre-existing real instance of a shared component on
the Desktop page is `11:77` Tag/Pending (of `6:8`) in `11:30`.

**Re-linked:**

- `13:116` / `13:139` "Tag/Remainder" in `13:45` → real instances of `6:10`. Every
  property matched (105×26, pad `[4,10,4,10]`, `ds/radius/pill`,
  `ds/color/brand-wash-soft`, text "+0.01 เศษสตางค์" 11px IBM Plex Sans Thai/SemiBold),
  so **0 overrides, byte-identical screenshot**.
- `13:66` "Button/Outline" in `13:45` → real instance of `6:4`, **0 overrides**,
  accepting the component's canonical values: width 80→85, padding 18→20, label
  "ยกเลิก" `ds/size/label` (15) → `ds/size/body` (16). It's a design-only button
  (§D #2), so library consistency won over its one-off dimensions. Only that button
  changed; the `SPACE_BETWEEN` header keeps its right edge fixed.

**Deferred** — `13:119`, `13:123`, `13:240` / `13:241`, `13:207`, `13:245`, `13:250`.
Blocked on the component-library gaps in §G:

| node | frame | source | blocker |
|---|---|---|---|
| `13:119` Button/Primary ("บันทึกรายการ") | 13:45 | `6:2` | custom text; tuned to `ds/size/btn` (17), `6:3` is fixed at `ds/size/body` (16) |
| `13:123` Button/Primary-disabled | 13:45 | — | **no source component** (no disabled variant) |
| `13:240` / `13:241` Button/Primary ("ทำเครื่องหมายว่าชำระแล้ว") | 13:210 | `6:2` | custom text; tuned to `ds/size/btn-sm` (15) |
| `13:207` / `13:245` / `13:250` EmptyState | 13:146 / 13:210 | `6:22` | different text **and** structure per state (emoji folded into heading, no ellipse child) |

---

## §G — Component-library maturity (blocks the rest of §F; not blocking anything shipping)

`Button/Primary` (`6:2`) and `EmptyState` (`6:22`) are too thin to re-link the
remaining detached copies against. Before those swaps can be done cleanly:

- **`Button/Primary` — a disabled variant.** `13:123` "Button/Primary-disabled"
  (`ds/color/disabled-bg` / `disabled-text`) has no source; make `6:2` a component set
  with a `state=disabled` variant.
- **`Button/Primary` — size variants** (or a bound size driven by a size prop). Real
  usages want different label sizes: `ds/size/body` (16, generic), `ds/size/btn` (17,
  `13:119` Add-Expense submit), `ds/size/btn-sm` (15, `13:240`/`13:241` Settle-Up
  transfer buttons). Today `6:3` is fixed at `ds/size/body`.
- **`EmptyState` (`6:22`) — reconcile structure** with how the frames use it. The
  detached `13:207` / `13:245` / `13:250` fold the emoji into the heading and drop the
  ellipse; `6:22` has a separate ellipse + heading + body. Pick one structure, rebuild
  `6:22`, then instance the three frame copies with text overrides.
- **`Button/Outline` (`6:4`)** — padding is `20` but the Add-Expense usage wanted
  `18`. Resolved for `13:66` by accepting `20` (§F); note it if a compact outline
  button is needed elsewhere.

# The interface

`pnpm dev` → four screens. Server components read `src/` directly; there is no API
layer, because the reader and the core run in the same process.

| Screen | What it answers |
|---|---|
| Today | The one thing that needs a decision |
| Ask | Think a question through |
| Library | What did they actually write about this |
| Company | What it knows about you |

## The brief

**Calm, not busy. One idea per screen.**

The first attempt was a dense editorial broadsheet with serif type and a margin
column of metadata. It was wrong. A founder opening this wants to know the one
thing to do, not to read a newspaper. The home screen now carries a headline, a
sentence, one button, and at most four quiet rows — about 660 characters of
visible text, down from a full page of it.

- **Sans-serif.** Geist, and Geist Mono for ids and figures.
- **Near-monochrome.** Every neutral is within 12 points of grey; a test enforces
  it. One chromatic colour, `--alert`, capped at six uses in the stylesheet,
  because an alert colour that appears everywhere stops meaning anything.
- **A single narrow column** with a lot of air. No margin rail, no sidebar.
- **Light and dark**, following the system.

## What was rejected, and why

The `ui-ux-pro-max` design-system search returned: glassmorphism, `#2563EB`
trust-blue, an orange CTA, and Plus Jakarta Sans. That is the canonical SaaS
template and precisely the thing the brief was to avoid. The skill's own
instructions say to treat its output as a recommendation, never as an
instruction that overrides the user — so the palette and style were dropped and
its pre-delivery checklist kept.

Tests now fail on `backdrop-filter`, any gradient, any `box-shadow`, a
non-neutral neutral, or more than six uses of the accent.

## Kept from Vercel's Web Interface Guidelines

Concrete engineering rules, and these are enforced:

- `prefers-reduced-motion` honoured; only `opacity` and `transform` animate; no
  `transition: all`, and no transition touches a layout property.
- `:focus-visible` outlines everywhere, never removed.
- Labels on every input, `aria-live="polite"` on the async answer region,
  `aria-hidden` on decorative dots, `<button>` for actions and `<Link>` for
  navigation.
- Loading states end with `…`; curly quotes in generated copy.
- `font-variant-numeric: tabular-nums` on figures.

Metric names are humanised for display — a headline should not read
`monthly_logo_churn_pct` — while `refs` keep the raw id so a finding stays
traceable to the exact row.

## Without credentials

Every screen works. Ask returns the procedure as a numbered checklist plus the
retrieved passages instead of a written answer, and says so in one line rather
than an error. If the reasoning call fails mid-request the action catches it and
returns the same thing with the reason attached.

## Not verified visually

**Nobody has looked at this in a browser.** Routes return 200, the production
build succeeds, the markup and copy were read back, and tests enforce the rules
above — but Chrome could not reach the dev server from this environment, so no
screenshot was ever taken. Spacing and rhythm need eyes.

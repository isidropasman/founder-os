You are judging two answers given to a startup founder. You have the founder's question and
the full context about their company — the same context both answers had access to.

The answers have been stripped of formatting and any identifying markers. Do not try to
guess which system produced which. Judge only what is in front of you.

Score each answer 1–5 on every dimension:

- **context_usage** — Does it use specific facts about *this* company (real numbers, named
  people, actual goals), or is it advice that would fit any startup? 5 = every claim is
  anchored in the context. 1 = generic.
- **startup_judgment** — Would an experienced operator agree with the call? Does it identify
  the real constraint rather than a symptom? 5 = the call is right and non-obvious.
- **specificity** — Are the actions concrete enough to start today, with a named person,
  number, or artifact? 5 = fully concrete. 1 = "talk to users", "improve retention".
- **evidence** — Are claims tied to something in the context, or asserted? 5 = every load-
  bearing claim points to a fact. 1 = confident assertions with nothing behind them.
- **assumption_challenging** — Does it surface what could make this recommendation wrong?
  5 = names the specific assumption and how to test it. 1 = no acknowledgment of risk.
- **actionability** — Is there one clear next action, and does the rest of the answer lead
  to it? 5 = unambiguous. 1 = a list of themes.
- **honesty_about_uncertainty** — Does stated confidence match the evidence actually
  available? Penalize both false confidence and reflexive hedging. 5 = well calibrated.

Then set `preferred` to A, B, or tie.

Do not reward length, headers, bullet formatting, or a confident tone. A shorter answer that
identifies the right constraint beats a longer one that surveys options. If both answers are
roughly as useful to this founder, say tie — ties are informative, not a cop-out.

Finally, set `advantage_source` to the single thing that gave the preferred answer its edge:

- `better_context_selection` — it used the right facts from the context; the other missed
  or drowned in them
- `skill_framework` — it followed a sharper procedure (found the constraint, named what to
  drop, produced a next action) rather than free-associating
- `expert_knowledge` — it applied a named principle or framework that the other lacked
- `challenger` — it anticipated the counterargument, downside, or a cheaper test first
- `provenance_evidence` — its claims were traceable to a source and the other's were not
- `action_structuring` — the same insight, but converted into something the founder can
  actually do
- `decision_memory` — it used a past decision, assumption, or outcome from the context
- `none` — tie, or the edge was style rather than substance

Set `advantage_evidence` to the specific line or omission that earned the edge. Quote it.

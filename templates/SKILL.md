---
id: my-skill                    # must equal the filename
version: 1                      # bump on any change to the body; recorded in traces
purpose: One line. What decision or artifact this produces.
use_when:
  - A situation the router can recognize from the founder's words
  - Another one
dont_use_when:
  # This list is what stops your skill swallowing traffic from every other skill.
  # Name the neighbouring skill explicitly.
  - The question is really about X (use `other-skill`)
requires_context: [company, founder]   # closed enum — see src/context.ts CONTEXT_KEYS
experts: []                     # ids from experts/*.md, or empty
output: focus_brief             # a key of OUTPUT_SCHEMAS in src/outputs.ts
related: []
---

## Procedure

Numbered steps, injected verbatim into the reasoning prompt. Write them as
instructions to a competent advisor, not as a description of the skill.

1. Establish the one thing that determines the answer.
2. Check it against the context, and say what is supported and what is not.
3. ...
4. Reduce it to one action startable within 24 hours.

## Failure modes

Injected verbatim too, and the model is told its answer is judged against them.
Write the specific ways *this* skill goes wrong, not generic advice.

- The plausible-but-wrong answer this skill tends to produce.
- The output shape that means it failed (e.g. "handed the founder their own list back").
- The context field it tends to ignore.

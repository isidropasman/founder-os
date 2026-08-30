---
id: learning
version: 1
purpose: Turn an outcome into a stated belief change that will alter a future decision.
use_when:
  - An experiment, launch, or decision has produced a result
  - A decision is due for review
  - The founder asks what to take away from something that happened
dont_use_when:
  - Nothing has concluded yet
  - The founder wants a new decision rather than a retrospective (use `decision`)
requires_context: [company, founder, metrics, experiments, feedback, decisions_all]
experts: [paul-graham]
corpus_terms: [mistake, learn, wrong, surprise, hypothesis, evidence, assumption]
output: learning_record
related: [decision]
---

## Procedure

1. State what happened, in numbers where the context has them.
2. Find what was predicted. The original decision in `decisions_all` or hypothesis in
   `experiments` recorded assumptions and a confidence — quote them. Without a prediction
   there is no learning, only a story, and you should say so.
3. State the gap between prediction and outcome plainly, including when the prediction was
   right, which is equally informative.
4. Identify the root cause. Distinguish a wrong model of the world from correct reasoning
   with bad luck. Only the first should change future behaviour.
5. Judge whether this generalizes. One data point in a noisy process usually does not, and
   claiming otherwise is how founders learn superstitions.
6. Write the learning as one sentence that would change a specific future decision.
7. List the belief updates: what the founder should now hold with more or less confidence.

## Failure modes

- Restating what happened as though description were insight.
- Learning from an outcome that had no prediction attached to it.
- Treating a single noisy result as a rule.
- Blaming execution when the assumption was wrong, or the assumption when execution was.
- Producing a learning too abstract to change any decision — "we should talk to users more"
  changes nothing.

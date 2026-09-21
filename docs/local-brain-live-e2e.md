# Local Brain live evidence

This run intentionally did not call an embedding API, Codex CLI, or Claude CLI.
The deterministic suite validates the contracts, but it is not evidence that an
authenticated harness emitted a grounded answer.

## OpenAI semantic retrieval

Required variable: `OPENAI_API_KEY`. The local database must already contain the
approved corpus.

```bash
FOUNDEROS_EMBEDDINGS=openai pnpm knowledge embed
FOUNDEROS_EMBEDDINGS=openai pnpm knowledge:eval
```

Evidence to retain: the embedding report must show non-zero claim embeddings;
`knowledge:eval` must retain MRR ≥ 0.800, recall@10 ≥ 0.800, p95 ≤ 250 ms, and
no more than 0.050 recall or MRR drop relative to `evals/baselines/retrieval.json`.

## Codex CLI Brain E2E

Required state: `codex` is installed and authenticated with `codex login`.

```bash
pnpm exec tsx scripts/local-brain-e2e.ts --provider codex-cli
```

Evidence to retain: JSON output has `"mode": "answer"`,
`"citationFidelity": 1`, and the stage timing object. A non-zero exit means the
model did not return the structured, source-cited contract.

## Claude CLI Brain E2E

Required state: `claude` is installed and authenticated with `claude auth login`.

```bash
pnpm exec tsx scripts/local-brain-e2e.ts --provider claude-cli
```

Evidence to retain: the same structured JSON and citation-fidelity fields as the
Codex run. No browser automation or consumer web session is used by either command.

## Utility evaluation

The checked-in fixtures under `evals/utility` cover PMF, customer discovery,
pricing, GTM, hiring, and fundraising. They exercise citation resolution and
the action/evidence contract without a provider, so their result is reported as
the `fixture utility gate`. This is deliberately separate from answer quality
from a real authenticated harness.

After blinded human review of real answers, write the ignored local file
`evals/results/utility.json` as an array of `{ "category", "score" }` records,
where category is one of `pmf`, `customer-discovery`, `pricing`, `gtm`, `hiring`,
or `fundraising` and score is 1–5. `pnpm knowledge:eval` requires every category
to have a mean score of at least 4.0; until then it reports the `human utility gate`
as blocked.

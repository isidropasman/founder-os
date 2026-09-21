# Portfolio evaluations

`founderos` and `context_dump` run through the same provider/model for every fixture. Both receive the same approved, versioned Knowledge Base passages; only their portfolio-context assembly differs. A packet is rejected when a record is blocked, crosses an unlinked project boundary, names an unavailable passage, or quotes text absent from that passage.

## Providers

Use one of these options. Do not commit either credential.

```bash
# Anthropic API
printf '\nANTHROPIC_API_KEY=your-active-key\n' >> .env
FOUNDEROS_MODEL_REASON=anthropic:claude-opus-5 pnpm eval:portfolio -- --all
```

```bash
# Existing ChatGPT/Codex login; no API key is read or written
codex login
pnpm eval:portfolio:codex
```

The Codex command requires `codex` on `PATH` and an authenticated local session. `codex login status` verifies that state.

If the backend says the selected model requires a newer Codex version, update the local CLI and retry; this changes the CLI binary, not the ChatGPT session or any API key.

```bash
codex update
codex --version
pnpm eval:portfolio:codex
```

## Run and inspect

```bash
# One fixture
pnpm eval:portfolio -- --provider codex-cli evals/portfolio/tradeoff-shared-constraint.yaml

# Every trade-off fixture
pnpm eval:portfolio -- --provider codex-cli --all
```

Each run writes an ignored JSON file under `evals/results/`. It contains private input, retrieved passage versions, both prompts, raw model output, selected IDs, judge rounds, tokens and latency. Do not commit those files.

`invalid_run` means the provider or blind judge failed. In that state `scores` and `differences` are `null`, there is no winner, and no layer is diagnosed as non-contributing. A valid run reports per-arm strategic judgment, grounding, trade-off quality, project contamination, tokens and latency. Token counts are cost units; FounderOS does not estimate USD because provider pricing is not part of the response contract.

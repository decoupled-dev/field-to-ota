# UI design rules (enterprise console)

- Calm, dense, legible: Linear / Datadog / GitHub Actions, not a marketing page.
- Inter, 13–14 px base, tabular numerals for metrics, 8 px grid, 1 px borders, 6 px radius.
- Neutral slate palette, one accent (blue-600). Status colours only for status:
  passed emerald · running blue (subtle pulse) · awaiting approval amber · failed red · pending slate.
- No gradients, emoji, glassmorphism or hero text. Light and dark themes via CSS variables.
- Every stage view answers: what happened, why (agent reasoning), with what evidence (artifacts), where (links).
- Simulated connectors are always labelled.

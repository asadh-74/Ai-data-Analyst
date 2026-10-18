# AI Data Analyst

CSV analysis dashboard with calculated full-file summary statistics, charts, report export and optional Gemini explanations.

## Run
Node 22+: `npm install`, then `npm start`. Open port 3000. Render: Node runtime, build `npm install --omit=dev`, start `npm start`. `/health` checks readiness.

Set `GEMINI_API_KEY` privately in Render to enable real AI answers. `GEMINI_MODEL` selects a provider model available to your account. Without a key, **computed statistics mode** works and is explicitly labeled; it does not answer arbitrary questions with an LLM. Never publish credentials. Use fictional CSVs; when AI is enabled a representative sample and aggregate statistics are transmitted to Google.

Requests are limited to 2 MB and 20 analysis requests per minute per connection address. The public demo is not a secure data room. Charts and PDF export use browser libraries.

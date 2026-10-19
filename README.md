# AI Data Analyst

CSV analysis dashboard with calculated full-file summary statistics, charts, report export and optional Gemini explanations.

## Run
Node 22+: `npm install`, then `npm start`. Open port 3000. Render: Node runtime, build `npm install --omit=dev`, start `npm start`. `/health` checks readiness.

Set `GEMINI_API_KEY` privately in Render to enable real AI answers. `GEMINI_MODEL` selects a provider model available to your account. Without a key, **computed statistics mode** works and is explicitly labeled; it does not answer arbitrary questions with an LLM. Never publish credentials. Use fictional CSVs; when AI is enabled a representative sample and aggregate statistics are transmitted to Google.

Requests are limited to 2 MB and 20 analysis requests per minute per connection address. The public demo is not a secure data room. Charts and PDF export use browser libraries.


## Complete recording workflow
1. Load the sample CSV or upload a sanitized dataset.
2. Show data quality: row count, missing cells, duplicate rows, and numeric correlations.
3. Choose category, measure, and sum/mean/count in the chart builder. Charts aggregate actual rows without an AI dependency.
4. Ask a question. With a working server-side Gemini key the backend calls Gemini; otherwise the interface explicitly labels computed-statistics fallback.
5. Open a saved analysis and download its JSON or use the PDF export.

History is isolated using an HTTP-only browser cookie and a server-side file (last 10 runs per browser, capped sessions). Free Render temporary storage resets on restart/deploy. Use fictional or sanitized data. Configure GEMINI_API_KEY only in private server environment variables; never commit credentials. Real AI availability depends on provider key validity and quota.

## Automated business reporting
Open `/reports` to merge up to five CSV sources using `date,order_id,revenue,cost,region`. Sources must use the same columns and currency. Exact duplicates are removed; every conflicting order-ID version and invalid row is excluded from KPIs. Calculations use integer cents.
Schedules generate actual reports over the uploaded snapshot (15-second demo, hourly, daily, weekly), with pause/resume, run-now, JSON, clean CSV and printable HTML exports. Print the HTML to save a PDF. No external source refresh or email delivery is connected.
Browser sessions isolate schedules/reports. The timer runs only while this web process is awake and catches up once for overdue jobs. Free Render suspension/redeployment cannot guarantee durable scheduling. Production needs durable storage and an always-on worker. `npm test` covers source merging, exceptions, scheduler execution and session isolation.

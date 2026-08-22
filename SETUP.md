# Setup & Deploy

## 1. Get a Gemini API key
1. Go to https://aistudio.google.com/app/apikey and create a key.
2. IMPORTANT: your old key was pasted in a chat, treat it as leaked — generate a fresh one.

## 2. Local dev
```
npm install
vercel dev
```
Create a local `.env` (copied from `.env.example`) with your real key. Never commit `.env`.

## 3. Deploy on Vercel
1. Push this folder to a GitHub repo (don't commit `.env` or a real key — `.env.example` is just a template).
2. Import the repo in Vercel.
3. In the Vercel dashboard: Project → Settings → Environment Variables → add
   `GEMINI_API_KEY` = your key → Save.
4. Redeploy (env var changes need a redeploy to take effect).

## What was actually broken (root cause)
`api/analyze.js` was calling `gemini-1.5-flash`, `gemini-pro`, and `gemini-1.0-pro`.
Google permanently retired every Gemini 1.0 and 1.5 model in 2026 — every real call
was returning a 404, so the app silently fell back to its hardcoded "demo" response
every single time, regardless of whether your key was valid.

## What changed in this pass
- Switched to the current `@google/genai` SDK and current model IDs
  (`gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-3.1-flash-lite` fallback chain).
- `api/chat.js` now actually calls Gemini instead of returning a hardcoded string.
- Server-side CSV parser now handles quoted fields (commas/quotes inside cells) instead
  of breaking on `split(',')`.
- Real full-dataset statistics (min/max/mean/sum for numeric columns, top values for
  categorical columns) are computed server-side and given to the model, instead of
  just the first 5 rows.
- For files over ~300 rows, only stats + an evenly-sampled subset are sent to the model
  (not the raw file), so very large CSVs (100k+ rows) don't blow the token budget.
- The AI now returns a small JSON block with real chart data, and the frontend renders
  it with Chart.js — the chart used to just draw random numbers regardless of your data.
- Added a working PDF export (html2pdf.js) and a dark/light theme toggle.

## Known limitations / good next steps (not done in this pass)
These are the items from your longer wishlist that need real backend infrastructure
and are worth doing as separate, focused pieces of work rather than bolted on blind:
- Authentication + user accounts
- A database to persist uploaded datasets and analysis/chat history
- Multiple model providers (OpenAI, Claude, Ollama) as actual selectable backends
- True SQL *execution* (right now the SQL is AI-generated text, not run against real data)
- Streaming responses instead of waiting for the full completion

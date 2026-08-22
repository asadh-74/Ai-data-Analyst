const { GoogleGenAI } = require("@google/genai");

// Gemini 1.0 and 1.5 models (gemini-pro, gemini-1.5-flash, gemini-1.0-pro) were
// permanently retired by Google in 2026 and now return 404 on every call.
// These are the current, supported model IDs (checked most-capable/cheap first).
const MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite"];

// Above this many rows we stop sending the raw file to the model and switch to
// stats + a sample instead, so a 100k+ row CSV doesn't blow the prompt/token budget.
const MAX_RAW_ROWS_FOR_FULL_SEND = 300;
const SAMPLE_ROWS = 25;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { question, csvData, filename, model = "gemini" } = req.body;

    if (!question || !csvData) {
      return res.status(400).json({ error: "Missing question or csvData" });
    }

    const parsed = parseCSV(csvData);
    if (!parsed.headers.length || !parsed.rows.length) {
      return res.status(400).json({ error: "Couldn't parse any rows from that CSV." });
    }

    const stats = computeStats(parsed.headers, parsed.rows);
    const promptSample = parsed.rows.length > MAX_RAW_ROWS_FOR_FULL_SEND
      ? sampleRows(parsed.rows, SAMPLE_ROWS)
      : parsed.rows.slice(0, SAMPLE_ROWS);

    const prompt = buildPrompt({
      filename: filename || "data.csv",
      question,
      headers: parsed.headers,
      totalRows: parsed.rows.length,
      stats,
      sampleRows: promptSample,
    });

    let responseText = "";
    let usedModel = "demo";
    let apiError = null;

    if (model === "gemini" && process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        let lastError = null;

        for (const modelName of MODEL_CANDIDATES) {
          try {
            const result = await ai.models.generateContent({
              model: modelName,
              contents: prompt,
            });
            responseText = result.text;
            usedModel = modelName;
            if (responseText) break;
          } catch (err) {
            lastError = err;
          }
        }

        if (!responseText) throw lastError || new Error("No response from any Gemini model");
      } catch (err) {
        apiError = err.message || String(err);
        console.error("Gemini API Error:", apiError);
        responseText = null;
      }
    }

    if (!responseText) {
      responseText = generateDemoResponse(question, parsed.headers, stats, apiError);
      usedModel = apiError ? "demo (API failed)" : "demo";
    }

    const { analysis, chartData } = extractChartData(responseText, stats);

    res.status(200).json({
      success: true,
      analysis,
      chartData,
      model: usedModel,
      apiError: apiError || undefined,
      columns: parsed.headers,
      rowCount: parsed.rows.length,
      stats,
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message });
  }
};

// --- CSV parsing (handles quoted fields containing commas/newlines) ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const cleaned = rows.filter(r => r.some(c => c.trim() !== ""));
  if (!cleaned.length) return { headers: [], rows: [] };

  const headers = cleaned[0].map(h => h.trim());
  const dataRows = cleaned.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
  return { headers, rows: dataRows };
}

function sampleRows(rows, n) {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

// --- Real statistics over the FULL dataset, not just a preview ---
function computeStats(headers, rows) {
  const stats = {};
  for (const h of headers) {
    const values = rows.map(r => r[h]).filter(v => v !== "" && v != null);
    const numericValues = values.map(v => Number(v)).filter(v => !Number.isNaN(v));
    const isNumeric = numericValues.length > 0 && numericValues.length >= values.length * 0.8;

    if (isNumeric) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const mean = sum / numericValues.length;
      stats[h] = {
        type: "numeric",
        count: numericValues.length,
        missing: rows.length - values.length,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        mean: Number(mean.toFixed(2)),
        sum: Number(sum.toFixed(2)),
      };
    } else {
      const counts = {};
      for (const v of values) counts[v] = (counts[v] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([value, count]) => ({ value, count }));
      stats[h] = {
        type: "categorical",
        count: values.length,
        missing: rows.length - values.length,
        distinct: Object.keys(counts).length,
        top,
      };
    }
  }
  return stats;
}

function buildPrompt({ filename, question, headers, totalRows, stats, sampleRows }) {
  const statsBlock = headers.map(h => {
    const s = stats[h];
    if (s.type === "numeric") {
      return `- ${h} (numeric): min=${s.min}, max=${s.max}, mean=${s.mean}, sum=${s.sum}, missing=${s.missing}`;
    }
    return `- ${h} (categorical): ${s.distinct} distinct values, missing=${s.missing}, top values: ${s.top.map(t => `${t.value} (${t.count})`).join(", ")}`;
  }).join("\n");

  const sampleBlock = sampleRows.map(r => headers.map(h => r[h]).join(", ")).join("\n");

  return `You are an expert Data Analyst AI embedded in a web app. A user uploaded "${filename}" with ${totalRows} rows and these columns: ${headers.join(", ")}.

Precomputed statistics over the FULL dataset (use these — they are accurate, not estimates):
${statsBlock}

A representative sample of rows:
${sampleBlock}

User Question: "${question}"

Respond in this exact structure, using GitHub-flavored markdown:

## SQL Query
A PostgreSQL query (table name: uploaded_data) that answers the question, using the real column names above.

## Python Code
A short pandas/matplotlib snippet that answers the question, using the real column names above.

## Analysis
2-4 sentences answering the question directly, grounded in the actual statistics given (not the tiny sample).

## Chart Recommendation
Name the best chart type and explain briefly why.

## Key Insights
3-5 bullet points of concrete, specific insights (cite real numbers from the stats).

## Chart Data
Then output ONE fenced json code block (\`\`\`json ... \`\`\`) with this exact shape, using REAL values derived from the statistics above (not placeholders), for the single most relevant column/metric to this question:
{"type": "bar", "title": "short title", "labels": ["..."], "values": [numbers]}
Use at most 10 labels/values.`;
}

// Pull the trailing ```json chart block out of the model's markdown response
function extractChartData(text, stats) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (match) {
    try {
      const chartData = JSON.parse(match[1]);
      const analysis = text.slice(0, match.index).trim();
      if (chartData && Array.isArray(chartData.labels) && Array.isArray(chartData.values)) {
        return { analysis, chartData };
      }
    } catch (e) {
      // fall through to fallback below
    }
  }
  return { analysis: text.trim(), chartData: fallbackChartData(stats) };
}

// If the model didn't return usable chart JSON, build one from real stats anyway
function fallbackChartData(stats) {
  const numericEntry = Object.entries(stats).find(([, s]) => s.type === "numeric");
  if (numericEntry) {
    const [name, s] = numericEntry;
    return { type: "bar", title: `${name} summary`, labels: ["Min", "Mean", "Max"], values: [s.min, s.mean, s.max] };
  }
  const catEntry = Object.entries(stats).find(([, s]) => s.type === "categorical");
  if (catEntry) {
    const [name, s] = catEntry;
    return { type: "bar", title: `Top ${name}`, labels: s.top.map(t => t.value), values: s.top.map(t => t.count) };
  }
  return { type: "bar", title: "No numeric data", labels: [], values: [] };
}

function generateDemoResponse(question, headers, stats, apiError) {
  const col = headers[0];
  const colStats = stats[col];
  let errorNote = "";

  if (apiError) {
    errorNote = `\n\n---\n\n⚠️ **API Issue Detected:** ${apiError}\n\n**To fix this:**\n1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create a NEW API key\n2. Go to [Google Cloud Console](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com) and enable the **Generative Language API**\n3. Add the key to your Vercel project's Environment Variables as \`GEMINI_API_KEY\` (Project Settings → Environment Variables), then redeploy\n4. Make sure the model names in \`api/analyze.js\` match currently supported Gemini models (gemini-1.5-flash and gemini-pro are retired)\n\n*Showing a stats-based demo response below:*\n\n`;
  }

  const statsLines = headers.map(h => {
    const s = stats[h];
    return s.type === "numeric"
      ? `- **${h}**: min ${s.min}, max ${s.max}, mean ${s.mean}`
      : `- **${h}**: ${s.distinct} distinct values, top: ${s.top[0]?.value ?? "n/a"}`;
  }).join("\n");

  return `${errorNote}## SQL Query
\`\`\`sql
SELECT ${headers.join(", ")}, COUNT(*) as total
FROM uploaded_data
GROUP BY ${col}
ORDER BY total DESC
LIMIT 10;
\`\`\`

## Python Code
\`\`\`python
import pandas as pd

df = pd.read_csv('data.csv')
print(df.describe(include='all'))
print(df['${col}'].value_counts().head(10))
\`\`\`

## Analysis
Based on the full dataset (not just a preview), here's what the columns look like:
${statsLines}

Your question was: "${question}" — connect a working Gemini key to get a real, question-specific answer instead of this stats summary.

## Chart Recommendation
${colStats.type === "numeric" ? "**Histogram** — good for seeing the distribution of a numeric column." : "**Bar Chart** — best for comparing category counts."}

## Key Insights
- Dataset has ${headers.length} columns
- \`${col}\` is ${colStats.type === "numeric" ? "numeric" : `categorical with ${colStats.distinct} distinct values`}
- This is a fallback response — no live model call was made`;
}

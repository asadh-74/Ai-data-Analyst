const { GoogleGenAI } = require("@google/genai");

// Override GEMINI_MODEL privately when provider availability changes.
const MODEL_CANDIDATES = [process.env.GEMINI_MODEL || "gemini-3.8-flash"];

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

    if (typeof question !== "string" || typeof csvData !== "string" || !question.trim() || !csvData.trim() || question.length > 2000) {
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
              config: {maxOutputTokens:4096},
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
        apiError = "The AI provider is unavailable. Showing computed statistics instead.";
        console.error("Gemini request failed");
        apiError = /API key not valid|invalid.*key|API_KEY_INVALID/i.test(err.message||'') ? 'The configured AI key was rejected by the provider.' : (Number(err.status)===429 ? 'AI quota or rate limit reached.' : 'The AI provider could not complete the request.');
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
    console.error("Analysis request failed");
    res.status(400).json({ error: "Could not analyze this CSV. Check the file format and question." });
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

  if(inQuotes) throw new Error('CSV contains an unclosed quoted field');
  const headers = cleaned[0].map(h => h.trim());
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('CSV needs unique nonempty headers');
  if(headers.length>100||cleaned.length>50001)throw new Error('Use at most 100 columns and 50000 rows');
  if(cleaned.slice(1).some(r=>r.length!==headers.length))throw new Error('CSV rows must match the header column count');
  const dataRows = cleaned.slice(1).map(r => {
    const obj = Object.create(null);
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
  const stats = Object.create(null);
  for (const h of headers) {
    const values = rows.map(r => r[h]).filter(v => v !== "" && v != null);
    const numericValues = values.map(v => Number(v)).filter(v => Number.isFinite(v));
    const isNumeric = numericValues.length > 0 && numericValues.length >= values.length * 0.8;

    if (isNumeric) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      const mean = sum / numericValues.length;
      stats[h] = {
        type: "numeric",
        count: numericValues.length,
        missing: rows.length - values.length,
        min: numericValues.reduce((a,b) => Math.min(a,b), Infinity),
        max: numericValues.reduce((a,b) => Math.max(a,b), -Infinity),
        mean: Number(mean.toFixed(2)),
        sum: Number(sum.toFixed(2)),
      };
    } else {
      const counts = Object.create(null);
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

  errorNote = "**Computed statistics mode — not an AI answer.** " + (apiError || "AI is not configured or statistics mode was selected.") + "\n\n";

  const statsLines = headers.map(h => {
    const s = stats[h];
    return s.type === "numeric"
      ? `- **${h}**: min ${s.min}, max ${s.max}, mean ${s.mean}`
      : `- **${h}**: ${s.distinct} distinct values, top: ${s.top[0]?.value ?? "n/a"}`;
  }).join("\n");

  return `${errorNote}## SQL Query
\`\`\`sql
SELECT "${col.replace(/"/g, '""')}", COUNT(*) as total
FROM uploaded_data
GROUP BY "${col.replace(/"/g, '""')}"
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


module.exports.inspect = function(csvData){
  if(typeof csvData!=='string')throw Error('Missing CSV text');
  const parsed=parseCSV(csvData);if(!parsed.rows.length)throw Error('CSV has no data rows');
  const stats=computeStats(parsed.headers,parsed.rows),numeric=parsed.headers.filter(h=>stats[h].type==='numeric');
  const duplicates=parsed.rows.length-new Set(parsed.rows.map(r=>JSON.stringify(r))).size;
  const missing=Object.values(stats).reduce((a,s)=>a+s.missing,0);
  const correlations=[];
  for(let i=0;i<Math.min(numeric.length,8);i++)for(let j=i+1;j<Math.min(numeric.length,8);j++){
    const a=numeric[i],b=numeric[j],pairs=parsed.rows.filter(r=>r[a]!==''&&r[b]!==''&&Number.isFinite(Number(r[a]))&&Number.isFinite(Number(r[b]))).map(r=>[Number(r[a]),Number(r[b])]);
    if(pairs.length<3)continue;const n=pairs.length,mx=pairs.reduce((s,r)=>s+r[0],0)/n,my=pairs.reduce((s,r)=>s+r[1],0)/n;
    let cov=0,vx=0,vy=0;for(const [x,y] of pairs){cov+=(x-mx)*(y-my);vx+=(x-mx)**2;vy+=(y-my)**2}if(vx&&vy)correlations.push({a,b,r:Number((cov/Math.sqrt(vx*vy)).toFixed(4))});
  }
  return {headers:parsed.headers,rowCount:parsed.rows.length,preview:parsed.rows.slice(0,10),stats,quality:{duplicateRows:duplicates,missingCells:missing,numericColumns:numeric.length,correlations},chartData:fallbackChartData(stats)};
};
module.exports.chart = function(body){
  const {headers,rows}=parseCSV(body.csvData||'');const {x,y,aggregation='sum'}=body;
  if(!headers.includes(x)||!['sum','mean','count'].includes(aggregation)||(aggregation!=='count'&&!headers.includes(y)))throw Error('Choose valid chart columns and aggregation');
  const groups=new Map();for(const row of rows){const label=row[x]||'(missing)';if(aggregation!=='count'&&(row[y]===''||!Number.isFinite(Number(row[y]))))continue;const g=groups.get(label)||{sum:0,count:0};g.count++;if(aggregation!=='count')g.sum+=Number(row[y]);groups.set(label,g)}
  const items=[...groups].slice(0,30);return {type:'bar',title:aggregation+' by '+x,labels:items.map(([k])=>k),values:items.map(([,g])=>aggregation==='count'?g.count:aggregation==='mean'?Number((g.sum/g.count).toFixed(2)):Number(g.sum.toFixed(2))),groupCount:groups.size,shownGroups:items.length};
};

module.exports.parseCSV = parseCSV;

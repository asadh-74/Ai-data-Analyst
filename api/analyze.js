const { GoogleGenerativeAI } = require("@google/generative-ai");

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

    const lines = csvData.trim().split("\n");
    const headers = lines[0].split(",").map(h => h.trim());
    const sampleRows = lines.slice(1, 6);
    
    const prompt = `You are an expert Data Analyst. A user uploaded a CSV file named "${filename || 'data.csv'}".

CSV Columns: ${headers.join(", ")}
Sample Data (first 5 rows):
${sampleRows.join("\n")}

User Question: "${question}"

Provide a comprehensive analysis with these sections:
1. **SQL Query** - Write a PostgreSQL-compatible SQL query to answer this
2. **Python Code** - Provide pandas/matplotlib code for analysis
3. **Analysis** - Explain the findings in plain English
4. **Chart Recommendation** - Suggest the best chart type (bar, line, pie, scatter, histogram)
5. **Key Insights** - Bullet points of actionable insights

Format with clear markdown headers.`;

    let responseText = "";
    
    if (model === "gemini" && process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
      const result = await geminiModel.generateContent(prompt);
      responseText = result.response.text();
    } else {
      responseText = generateDemoResponse(question, headers, sampleRows);
    }

    res.status(200).json({ 
      success: true, 
      analysis: responseText,
      model: model,
      columns: headers,
      rowCount: lines.length - 1
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message });
  }
};

function generateDemoResponse(question, headers, rows) {
  const col = headers[0];
  return `## SQL Query
\`\`\`sql
SELECT ${headers.join(", ")}, COUNT(*) as total
FROM uploaded_data
GROUP BY ${headers[0]}
ORDER BY total DESC
LIMIT 10;
\`\`\`

## Python Code
\`\`\`python
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv('data.csv')
print(df.describe())

# Top values
plt.figure(figsize=(10,6))
df['${col}'].value_counts().head(10).plot(kind='bar')
plt.title('Top ${col} Distribution')
plt.tight_layout()
plt.savefig('chart.png')
\`\`\`

## Analysis
Based on the uploaded dataset with ${rows.length} sample rows and columns **${headers.join(", ")}**, your question about "${question}" can be answered by aggregating on \`${col}\`.

## Chart Recommendation
**Bar Chart** — Best for comparing categorical values across ${col}.

## Key Insights
- • Dataset contains ${headers.length} dimensions to analyze
- • Primary key column appears to be \`${col}\`
- • Consider filtering outliers before deep analysis
- • Time-series patterns may emerge if date columns exist`;
}

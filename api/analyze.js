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
    let usedModel = "demo";
    let apiError = null;
    
    // Try Gemini API if key exists
    if (model === "gemini" && process.env.GEMINI_API_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // Try gemini-1.5-flash first, then fall back to gemini-pro
        const modelNames = ["gemini-1.5-flash", "gemini-pro", "gemini-1.0-pro"];
        let lastError = null;
        
        for (const modelName of modelNames) {
          try {
            const geminiModel = genAI.getGenerativeModel({ model: modelName });
            const result = await geminiModel.generateContent(prompt);
            responseText = result.response.text();
            usedModel = modelName;
            break; // Success! Exit the loop
          } catch (err) {
            lastError = err;
            // Continue to next model name
          }
        }
        
        if (!responseText && lastError) {
          throw lastError;
        }
      } catch (err) {
        apiError = err.message;
        console.error("Gemini API Error:", err.message);
        // Fall back to demo response
        responseText = generateDemoResponse(question, headers, sampleRows, apiError);
        usedModel = "demo (API failed)";
      }
    } else {
      responseText = generateDemoResponse(question, headers, sampleRows, "No API key configured");
      usedModel = "demo";
    }

    res.status(200).json({ 
      success: true, 
      analysis: responseText,
      model: usedModel,
      columns: headers,
      rowCount: lines.length - 1
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: error.message });
  }
};

function generateDemoResponse(question, headers, rows, apiError) {
  const col = headers[0];
  let errorNote = "";
  
  if (apiError) {
    errorNote = `\n\n---
\n⚠️ **API Issue Detected:** ${apiError}\n\n**To fix this:**\n1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create a NEW API key\n2. Go to [Google Cloud Console](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com) and enable **Generative Language API**\n3. Make sure billing is enabled on your Google Cloud project\n4. Add the new key to Vercel Environment Variables as \`GEMINI_API_KEY\`\n\n*Showing demo response below:*\n\n`;
  }
  
  return `${errorNote}## SQL Query
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

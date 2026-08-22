const { GoogleGenAI } = require("@google/genai");

const MODEL_CANDIDATES = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-flash-lite"];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, history = [], columns = [] } = req.body;
    if (!message) return res.status(400).json({ error: "Missing message" });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(200).json({
        reply: "No Gemini API key is configured on the server, so I can't chat for real right now. Add GEMINI_API_KEY in your Vercel project's Environment Variables, redeploy, and try again.",
        suggestions: ["Show summary statistics", "Find correlations", "Detect outliers", "Create a dashboard"],
      });
    }

    const contextLine = columns.length
      ? `The user currently has a dataset loaded with these columns: ${columns.join(", ")}.`
      : "The user hasn't uploaded a dataset yet.";

    const historyText = history
      .slice(-6)
      .map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
      .join("\n");

    const prompt = `You are a friendly, concise AI Data Analyst assistant inside a web app. ${contextLine}
${historyText ? `Recent conversation:\n${historyText}\n` : ""}
User: ${message}

Reply in 2-4 short sentences, plain language, no markdown headers.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let reply = null;
    let lastError = null;

    for (const modelName of MODEL_CANDIDATES) {
      try {
        const result = await ai.models.generateContent({ model: modelName, contents: prompt });
        reply = result.text;
        if (reply) break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!reply) throw lastError || new Error("No response from any Gemini model");

    res.status(200).json({
      reply,
      suggestions: ["Show summary statistics", "Find correlations", "Detect outliers", "Create a dashboard"],
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(200).json({
      reply: `I hit an error talking to the model: ${error.message}. Upload a CSV and ask a specific question — that endpoint has more detailed error handling.`,
      suggestions: ["Show summary statistics", "Find correlations"],
    });
  }
};

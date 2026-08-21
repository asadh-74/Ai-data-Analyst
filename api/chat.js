module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, history = [] } = req.body;

  res.status(200).json({
    reply: `I analyzed your request: "${message}". As your AI Data Analyst, I can help you clean data, write SQL queries, generate Python visualizations, and extract business insights. Upload a CSV and ask me anything about it!`,
    suggestions: ["Show summary statistics", "Find correlations", "Detect outliers", "Create a dashboard"]
  });
};

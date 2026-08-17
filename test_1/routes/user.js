const express = require("express");
const { answerQuestion } = require("../services/ragService");

const router = express.Router();

router.get("/askAI/:userID", async function(req, res) {
  const { userID } = req.params;
  const question = String(req.body.question || req.query.question || "").trim();
  const apiKey = String(
    req.get("x-api-key") || req.body.apiKey || req.query.apiKey || ""
  ).trim();

  if (!question) {
    return res.status(400).json({ error: "question is required." });
  }

  if (!apiKey) {
    return res.status(400).json({ error: "apiKey is required." });
  }

  try {
    const result = await answerQuestion(userID, question, apiKey);
    return res.json(result);
  } catch (error) {
    if ([400, 401, 404, 502].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error(`RAG failed for user ${userID}:`, error);
    return res.status(500).json({
      error: "질문 처리 중 서버 오류가 발생했습니다.",
    });
  }
});

module.exports = router;

const express = require("express");
const { answerQuestion } = require("../services/ragService");

const router = express.Router();

router.get("/askAI/:userID", async function(req, res) {
  const { userID } = req.params;
  const body = req.body || {};
  const query = req.query || {};
  const question = String(body.question || query.question || "").trim();
  // body에 return이 명시되어 있으면 null도 유효한 값으로 유지한다.
  const returnValue = Object.prototype.hasOwnProperty.call(body, "return")
    ? body.return
    : query.return;
  const apiKey = String(
    req.get("x-api-key") || body.apiKey || query.apiKey || ""
  ).trim();

  if (!question) {
    return res.status(400).json({ error: "question is required." });
  }

  if (!apiKey) {
    return res.status(400).json({ error: "apiKey is required." });
  }

  try {
    const result = await answerQuestion(userID, question, apiKey, returnValue);
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

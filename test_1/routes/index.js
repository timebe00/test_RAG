const express = require("express");
const {
  answerQuestion,
  processTelegramFeedback,
} = require("../services/ragService");

const router = express.Router();

router.get("/", function(req, res) {
  return res.json({ test: "OK" });
});

// https://api.telegram.org/bot<token>/setWebhook?url=https://www.destop.p-e.kr/telegram/webhook/message
router.post("/telegram/webhook/message", async function(req, res) {
  const message = req.body?.message;
  const replyText = message?.reply_to_message?.text;
  const feedback = String(message?.text || "").trim();

  try {
    const result = await processTelegramFeedback(replyText, feedback);
    return res.json(result);
  } catch (error) {
    console.error("Telegram feedback regeneration failed:", error);
    return res.status(500).json({
      ok: false,
      error: "피드백 기반 답변 재생성에 실패했습니다.",
    });
  }
});

router.get("/askAI/:userID", async function(req, res) {
  const { userID } = req.params;
  const question = String(req.body.question || req.query.question || "").trim();

  if (!question) {
    return res.status(400).json({ error: "question is required." });
  }

  try {
    const result = await answerQuestion(userID, question);
    return res.json(result);
  } catch (error) {
    if (error.status === 400 || error.status === 404) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error(`RAG failed for user ${userID}:`, error);
    return res.status(500).json({
      error: "질문 처리 중 서버 오류가 발생했습니다.",
    });
  }
});

module.exports = router;

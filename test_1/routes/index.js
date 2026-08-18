const express = require("express");
const {
  answerQuestion,
  processTelegramFeedback,
  sendLatestAnswer,
  sendAllPendingAnswers,
  excludeAnswer,
  excludeAllAnswers,
} = require("../services/ragService");

const router = express.Router();

router.get("/", function(req, res) {
  return res.json({ test: "OK" });
});

// https://api.telegram.org/bot<token>/setWebhook?url=https://www.destop.p-e.kr/telegram/webhook/message
router.post("/telegram/webhook/message", async function(req, res) {
  const message = req.body?.message;
  const chatId = message?.chat?.id;
  const replyText = message?.reply_to_message?.text;
  const feedback = String(message?.text || "").trim();

  // 회신한 질문 한 건의 최신 답변을 외부 연동 주소로 발송한다.
  if (replyText && config.sendKey.send.includes(feedback)) {
    try {
      return res.json(await sendLatestAnswer(replyText, chatId));
    } catch (error) {
      console.error("Latest answer delivery failed:", error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.message || "답변 발송 처리에 실패했습니다.",
      });
    }
  // 현재 발송 전 상태인 모든 질문의 최신 답변을 순서대로 발송한다.
  } else if (config.sendKey.allSend.includes(feedback)) {
    try {
      return res.json(await sendAllPendingAnswers(chatId));
    } catch (error) {
      console.error("Pending answer delivery failed:", error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.message || "전체 답변 발송 처리에 실패했습니다.",
      });
    }
  // 회신한 질문 한 건을 발송 제외 상태로 변경한다.
  } else if (replyText && config.sendKey.del.includes(feedback)) {
    try {
      return res.json(await excludeAnswer(replyText, chatId));
    } catch (error) {
      console.error("Answer exclusion failed:", error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.message || "답변 제외 처리에 실패했습니다.",
      });
    }
  // 해당 Telegram 사용자에게 연결된 모든 질문을 발송 제외 처리한다.
  } else if (config.sendKey.allDel.includes(feedback)) {
    try {
      return res.json(await excludeAllAnswers(chatId));
    } catch (error) {
      console.error("Pending answer exclusion failed:", error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.message || "전체 답변 제외 처리에 실패했습니다.",
      });
    }
  }

  try {
    const result = await processTelegramFeedback(replyText, feedback);
    return res.json(result);
  } catch (error) {
    console.error("Telegram feedback regeneration failed:", error);
    return res.status(error.status || 500).json({
      ok: false,
      error: error.message || "피드백 기반 답변 재생성에 실패했습니다.",
    });
  }
});

router.post("/askAI/user", async function(req, res) {
  const userID = req.body.userID || req.query.userID || "";
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

   if (!userID) {
    return res.status(400).json({ error: "userID is required." });
  }

  try {
    const result = await answerQuestion(userID, question, apiKey, returnValue);

    return res.json({
      result: true,
      question_id : result.questionIds[0],
    });
  } catch (error) {
    if ([400, 401, 404, 502].includes(error.status)) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error(`RAG failed for user ${userID}:`, error);
    return res.status(500).json({
      result: false,
      error: "질문 처리 중 서버 오류가 발생했습니다.",
    });
  }
});

module.exports = router;

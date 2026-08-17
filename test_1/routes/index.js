var express = require('express');
var router = express.Router();

const { Ollama } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const { searchUserKnowledge } = require(base + "/lib/userKnowledge");
const { getOllamaBaseUrl } = require(base + "/lib/ollamaConfig");
const { sendMessage } = require(base + "/lib/sendTelegram");

function extractQAndA(text) {
  if (typeof text !== "string") {
    return null;
  }

  const match = text.match(/Q\s*:\s*([\s\S]*?)\n\s*A\s*:\s*([\s\S]*)/);
  if (!match) {
    return null;
  }

  return {
    question: match[1].trim(),
    answer: match[2].trim(),
  };
}

async function generateAnswerFromContext(question, context) {
  const ollamaBaseUrl = getOllamaBaseUrl();
  const chatModelName = config.ollama.chatModel.name;

  const prompt = ChatPromptTemplate.fromTemplate(`
Answer only from the reference context below.
If the context does not contain the answer, say you do not know.
Always answer in Korean.

Reference context:
{context}

Question:
{question}
`);

  const model = new Ollama({
    model: chatModelName,
    baseUrl: ollamaBaseUrl,
  });

  return prompt.pipe(model).pipe(new StringOutputParser()).invoke({ context, question });
}

async function regenerateAnswerWithFeedback(question, previousAnswer, feedback) {
  const ollamaBaseUrl = getOllamaBaseUrl();
  const chatModelName = config.ollama.chatModel.name;

  const prompt = ChatPromptTemplate.fromTemplate(`
You are revising a previous answer based on user feedback.
Keep the answer in Korean.
Use the original question, the previous answer, and the feedback to produce a better answer.
If the feedback asks for a correction, fix the answer accordingly.
If the feedback asks for clarification, make the answer clearer and more specific.
Do not mention that you are an AI.

Original question:
{question}

Previous answer:
{previousAnswer}

User feedback:
{feedback}
`);

  const model = new Ollama({
    model: chatModelName,
    baseUrl: ollamaBaseUrl,
  });

  return prompt.pipe(model).pipe(new StringOutputParser()).invoke({
    question,
    previousAnswer,
    feedback,
  });
}

/* GET home page. */
router.get('/sandMesTelegram', async function(req, res, next) {
  await sendMessage("test_send");

  res.json({ test: "test" });
});

//  https://api.telegram.org/bot<token>/setWebhook?url=https://www.destop.p-e.kr/telegram/webhook/message
//  텔레그램에서 답변에 대한 피드백을 받는 웹훅
router.post('/telegram/webhook/message', async function(req, res, next) {
  try {
    const message = req.body && req.body.message ? req.body.message : null;
    const replyToMessage = message && message.reply_to_message ? message.reply_to_message : null;
    const feedback = message && message.text ? String(message.text).trim() : "";
    const original = extractQAndA(replyToMessage && replyToMessage.text ? replyToMessage.text : "");

    if (!replyToMessage || !original || !feedback) {
      return res.json({
        ok: true,
        handled: false,
        reason: "missing reply_to_message, parsed Q/A, or feedback text",
      });
    }

    const revisedAnswer = await regenerateAnswerWithFeedback(
      original.question,
      original.answer,
      feedback
    );

    const outgoingText = [
      `Q: ${original.question}`,
      `A: ${revisedAnswer}`,
    ].join("\n\n");

    await sendMessage(outgoingText);

    return res.json({
      ok: true,
      handled: true,
      question: original.question,
      previousAnswer: original.answer,
      feedback,
      revisedAnswer,
    });
  } catch (error) {
    console.error("telegram feedback regeneration failed:", error);
    return res.status(500).json({
      ok: false,
      error: "피드백 기반 답변 재생성에 실패했습니다.",
    });
  }
});

// 기존 RAG 질문 응답 API
async function answerQuestion(req, res) {
  const { userID } = req.params;
  const question = String(req.body.question || req.query.question || "").trim();

  if (!question) {
    return res.status(400).json({ error: "question is required." });
  }

  try {
    const topChunks = await searchUserKnowledge(userID, question, 5);
    const context = topChunks.map((chunk) => chunk.pageContent).join("\n\n");
    const answer = await generateAnswerFromContext(question, context);

    const answerTxt = `Q: ${question}\nA: ${answer}`;
    await sendMessage(answerTxt);

    return res.json({
      userID,
      question,
      answer,
      sources: [...new Set(topChunks.map((chunk) => chunk.metadata?.fileName).filter(Boolean))],
    });
  } catch (error) {
    if (error.status === 400 || error.status === 404) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error(`RAG failed for user ${userID}:`, error);
    return res.status(500).json({ error: "질문 처리 중 서버 오류가 발생했습니다." });
  }
}

router.get("/askAI/:userID", answerQuestion);

module.exports = router;

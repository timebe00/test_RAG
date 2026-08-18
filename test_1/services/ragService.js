const { Ollama } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const axios = require("axios");

const { searchUserKnowledge } = require("../lib/userKnowledge");
const { getOllamaBaseUrl } = require("../lib/ollamaConfig");
const { sendMessage } = require("../lib/sendTelegram");
const {
  selectTelegramIntegrations,
  insertQuestion,
  insertAnswer,
  selectLatestAnswerForFeedback,
  selectLatestAnswerForDelivery,
  selectPendingAnswersForDelivery,
  selectAllAnswersForExclusion,
  insertFeedbackAnswer,
  updateAnswerTelegramStatus,
  updateQuestionDeliveryStatus,
} = require("../modules/ragModule");

function extractQuestionId(text) {
  const match = String(text || "").match(
    /(?:^|\n)[ \t]*ID[ \t]*:[ \t]*(\d+)[ \t]*(?:\n|$)/i
  );
  return match ? match[1] : null;
}

// 사용자에게 전달할 발송/제외 결과 메시지를 동일한 형식으로 생성한다.
function formatDeliveryMessage(title, delivery) {
  return [
    title,
    "",
    `id:${delivery.questionId}`,
    "",
    `Q:${delivery.question}`,
    "",
    `A:${delivery.answer}`,
  ].join("\n");
}

// Telegram 알림 실패가 외부 답변 발송 결과를 변경하지 않도록 별도로 처리한다.
async function notifyDelivery(delivery, title) {
  try {
    await sendMessage(
      formatDeliveryMessage(title, delivery),
      delivery.telegramBotToken,
      delivery.telegramChatId
    );
  } catch (error) {
    console.error(
      `Telegram delivery notification failed for question ${delivery.questionId}:`,
      error
    );
  }
}

// 연동 설정에 지정된 HTTP 메소드와 인증정보를 사용해 최신 답변을 반환한다.
async function deliverAnswer(delivery) {
  const method = String(delivery.returnMethod || "POST").trim().toUpperCase();
  // DB에는 JSON 문자열로 저장되어 있으므로 원래 자료형으로 복원해 전달한다.
  const payload = {
    answer: delivery.answer,
    return: delivery.returnValue == null
      ? null
      : JSON.parse(delivery.returnValue),
  };
  const headers = {};

  if (delivery.returnAuthValue != null && String(delivery.returnAuthValue).trim()) {
    // 인증값이 없으면 Authorization 헤더 자체를 추가하지 않는다.
    headers.Authorization = String(delivery.returnAuthValue).trim();
  }

  const request = {
    url: delivery.returnUrl,
    method,
    headers,
  };

  if (["GET", "HEAD"].includes(method)) {
    request.params = payload;
  } else {
    request.data = payload;
  }

  try {
    await axios(request);
  } catch (error) {
    console.error(`Answer delivery failed for question ${delivery.questionId}:`, error);

    try {
      await updateQuestionDeliveryStatus(delivery.questionId, "4");
    } catch (statusError) {
      console.error(
        `Delivery status update failed for question ${delivery.questionId}:`,
        statusError
      );
    }

    await notifyDelivery(delivery, "발송 실패");
    return {
      questionId: String(delivery.questionId),
      sent: false,
      error: error.message,
    };
  }

  await updateQuestionDeliveryStatus(delivery.questionId, "2");
  await notifyDelivery(delivery, "발송 완료");
  return { questionId: String(delivery.questionId), sent: true };
}

// 회신 메시지의 질문 ID를 기준으로 발송 상태와 관계없이 최신 답변을 발송한다.
async function sendLatestAnswer(replyText, chatId) {
  const questionId = extractQuestionId(replyText);
  if (!questionId) {
    const error = new Error("회신한 메시지에서 질문 ID를 찾을 수 없습니다.");
    error.status = 400;
    throw error;
  }

  const rows = await selectLatestAnswerForDelivery(questionId, String(chatId));
  if (rows.length === 0) {
    const error = new Error("발송할 질문 또는 답변을 찾을 수 없습니다.");
    error.status = 404;
    throw error;
  }

  return deliverAnswer(rows[0]);
}

// 발송 전(send_type=1) 질문을 조회된 순서대로 한 건씩 발송한다.
async function sendAllPendingAnswers(chatId) {
  const deliveries = await selectPendingAnswersForDelivery(String(chatId));
  const results = [];

  for (const delivery of deliveries) {
    results.push(await deliverAnswer(delivery));
  }

  return {
    total: results.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    results,
  };
}

// 질문 상태를 발송 제외로 변경한 후 최신 답변 내용과 함께 알림을 보낸다.
async function excludeDelivery(delivery) {
  await updateQuestionDeliveryStatus(delivery.questionId, "3");
  await notifyDelivery(delivery, "제외 완료");

  return {
    questionId: String(delivery.questionId),
    excluded: true,
  };
}

// 회신 메시지에서 선택한 질문 한 건을 발송 제외 처리한다.
async function excludeAnswer(replyText, chatId) {
  const questionId = extractQuestionId(replyText);
  if (!questionId) {
    const error = new Error("회신한 메시지에서 질문 ID를 찾을 수 없습니다.");
    error.status = 400;
    throw error;
  }

  const rows = await selectLatestAnswerForDelivery(questionId, String(chatId));
  if (rows.length === 0) {
    const error = new Error("제외할 질문 또는 답변을 찾을 수 없습니다.");
    error.status = 404;
    throw error;
  }

  return excludeDelivery(rows[0]);
}

// 해당 Telegram 사용자에게 연결된 모든 질문을 한 건씩 발송 제외 처리한다.
async function excludeAllAnswers(chatId) {
  const deliveries = await selectAllAnswersForExclusion(String(chatId));
  const results = [];

  for (const delivery of deliveries) {
    results.push(await excludeDelivery(delivery));
  }

  return {
    total: results.length,
    excluded: results.length,
    results,
  };
}

function createModel() {
  return new Ollama({
    model: config.ollama.chatModel.name,
    baseUrl: getOllamaBaseUrl(),
  });
}

function extractQAndA(text) {
  if (typeof text !== "string") {
    return null;
  }

  const idMatch = text.match(
    /(?:^|\n)[ \t]*ID[ \t]*:[ \t]*(\d+)[ \t]*(?:\n|$)/i
  );
  const contentMatch = text.match(
    /Q\s*:\s*([\s\S]*?)\n\s*A\s*:\s*([\s\S]*?)(?=\n\s*ID\s*:|$)/i
  );

  if (!idMatch || !contentMatch) {
    return null;
  }

  return {
    questionId: idMatch[1],
    question: contentMatch[1].trim(),
    answer: contentMatch[2].trim(),
  };
}

async function generateAnswerFromContext(question, context) {
  const prompt = ChatPromptTemplate.fromTemplate(`
Answer only from the reference context below.
If the context does not contain the answer, say you do not know.
Always answer in Korean.

Reference context:
{context}

Question:
{question}
`);

  return prompt.pipe(createModel()).pipe(new StringOutputParser()).invoke({
    context,
    question,
  });
}

async function regenerateAnswerWithFeedback(question, previousAnswer, feedback) {
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

  return prompt.pipe(createModel()).pipe(new StringOutputParser()).invoke({
    question,
    previousAnswer,
    feedback,
  });
}

async function processTelegramFeedback(replyText, feedback) {
  const original = extractQAndA(replyText);

  if (!original || !feedback) {
    return {
      ok: true,
      handled: false,
      reason: "missing reply_to_message, parsed ID/Q/A, or feedback text",
    };
  }

  const latestRows = await selectLatestAnswerForFeedback(original.questionId);
  if (latestRows.length === 0) {
    const error = new Error("Question or previous answer not found.");
    error.status = 404;
    throw error;
  }

  const latest = latestRows[0];

  const revisedAnswer = await regenerateAnswerWithFeedback(
    latest.question,
    latest.previousAnswer,
    feedback
  );

  const insertResult = await insertFeedbackAnswer(
    latest.questionId,
    latest.answerId,
    revisedAnswer,
    feedback
  );
  const answerId = String(insertResult.insertId);
  const message = [
    `ID:${latest.questionId}`,
    `Q: ${latest.question}`,
    `A: ${revisedAnswer}`,
  ].join("\n");

  try {
    await sendMessage(
      message,
      latest.telegramBotToken,
      latest.telegramChatId
    );
  } catch (error) {
    await updateAnswerTelegramStatus(answerId, "2");
    error.status = 502;
    throw error;
  }

  await updateAnswerTelegramStatus(answerId, "1");

  return {
    ok: true,
    handled: true,
    questionId: String(latest.questionId),
    answerId,
    prevAnswerId: String(latest.answerId),
    question: latest.question,
    previousAnswer: latest.previousAnswer,
    feedback,
    revisedAnswer,
  };
}

async function answerQuestion(userID, question, apiKey, returnValue) {
  const integrations = await selectTelegramIntegrations(userID, apiKey);

  if (integrations.length === 0) {
    const error = new Error("Invalid userID or apiKey.");
    error.status = 401;
    throw error;
  }

  // 전달받은 return 값의 객체/배열/원시 타입을 보존할 수 있도록 문자열화한다.
  const returnText = returnValue === undefined
    ? null
    : JSON.stringify(returnValue);
  const questionIds = [];
  for (const integration of integrations) {
    const result = await insertQuestion(
      integration.integrationsId,
      question,
      returnText
    );
    questionIds.push(String(result.insertId));
  }

  const topChunks = await searchUserKnowledge(userID, question, 5);
  const context = topChunks.map((chunk) => chunk.pageContent).join("\n\n");
  const answer = await generateAnswerFromContext(question, context);

  const answerIds = [];
  for (const questionId of questionIds) {
    const result = await insertAnswer(questionId, answer);
    answerIds.push(String(result.insertId));
  }

  const failedAnswerIds = [];

  for (let index = 0; index < integrations.length; index += 1) {
    const integration = integrations[index];
    const questionId = questionIds[index];
    const answerId = answerIds[index];
    const message = `ID:${questionId}\nQ: ${question}\nA: ${answer}`;

    let deliveryError = null;

    try {
      await sendMessage(
        message,
        integration.telegramBotToken,
        integration.telegramChatId
      );
    } catch (error) {
      deliveryError = error;
    }

    if (deliveryError) {
      console.error(`Telegram delivery failed for answer ${answerId}:`, deliveryError);
      failedAnswerIds.push(answerId);

      try {
        await updateAnswerTelegramStatus(answerId, "2");
      } catch (statusError) {
        console.error(`Telegram status update failed for answer ${answerId}:`, statusError);
      }

      continue;
    }

    await updateAnswerTelegramStatus(answerId, "1");
  }

  if (failedAnswerIds.length > 0) {
    const error = new Error("Telegram message delivery failed.");
    error.status = 502;
    error.failedAnswerIds = failedAnswerIds;
    throw error;
  }

  return {
    userID,
    questionIds,
    answerIds,
    question,
    answer,
    sources: [...new Set(
      topChunks
        .map((chunk) => chunk.metadata?.fileName)
        .filter(Boolean)
    )],
  };
}

module.exports = {
  answerQuestion,
  processTelegramFeedback,
  sendLatestAnswer,
  sendAllPendingAnswers,
  excludeAnswer,
  excludeAllAnswers,
};

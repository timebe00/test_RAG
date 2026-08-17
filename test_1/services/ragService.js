const { Ollama } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const { searchUserKnowledge } = require("../lib/userKnowledge");
const { getOllamaBaseUrl } = require("../lib/ollamaConfig");
const { sendMessage } = require("../lib/sendTelegram");
const {
  selectTelegramIntegrations,
  insertQuestion,
  insertAnswer,
  selectLatestAnswerForFeedback,
  insertFeedbackAnswer,
  updateAnswerTelegramStatus,
} = require("../modules/ragModule");

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

async function answerQuestion(userID, question, apiKey) {
  const integrations = await selectTelegramIntegrations(userID, apiKey);

  if (integrations.length === 0) {
    const error = new Error("Invalid userID or apiKey.");
    error.status = 401;
    throw error;
  }

  const questionIds = [];
  for (const integration of integrations) {
    const result = await insertQuestion(integration.integrationsId, question);
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
};

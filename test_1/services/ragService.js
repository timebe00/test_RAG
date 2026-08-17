const { Ollama } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const { searchUserKnowledge } = require("../lib/userKnowledge");
const { getOllamaBaseUrl } = require("../lib/ollamaConfig");
const { sendMessage } = require("../lib/sendTelegram");

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
      reason: "missing reply_to_message, parsed Q/A, or feedback text",
    };
  }

  const revisedAnswer = await regenerateAnswerWithFeedback(
    original.question,
    original.answer,
    feedback
  );

  await sendMessage([
    `Q: ${original.question}`,
    `A: ${revisedAnswer}`,
  ].join("\n\n"));

  return {
    ok: true,
    handled: true,
    question: original.question,
    previousAnswer: original.answer,
    feedback,
    revisedAnswer,
  };
}

async function answerQuestion(userID, question) {
  const topChunks = await searchUserKnowledge(userID, question, 5);
  const context = topChunks.map((chunk) => chunk.pageContent).join("\n\n");
  const answer = await generateAnswerFromContext(question, context);

  await sendMessage(`Q: ${question}\nA: ${answer}`);

  return {
    userID,
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

const path = require("path");
const mybatisMapper = require("mybatis-mapper");
const { query } = require("../lib/database");

const namespace = "rag";
const mapperPath = path.join(__dirname, "../sqlmap/rag.xml");

mybatisMapper.createMapper([mapperPath]);

function getSql(statementId, params = {}) {
  return mybatisMapper.getStatement(namespace, statementId, params, {
    language: "mariadb",
    indent: "  ",
  });
}

async function selectTelegramIntegrations(userID, apiKey) {
  return query(getSql("selectTelegramIntegrations", { userID, apiKey }));
}

async function insertQuestion(integrationsId, question, returnText) {
  return query(getSql("insertQuestion", {
    integrationsId,
    question,
    returnText,
  }));
}

async function insertAnswer(questionId, answer) {
  return query(getSql("insertAnswer", { questionId, answer }));
}

async function selectLatestAnswerForFeedback(questionId) {
  return query(getSql("selectLatestAnswerForFeedback", { questionId }));
}

async function selectLatestAnswerForDelivery(questionId, chatId) {
  return query(getSql("selectLatestAnswerForDelivery", { questionId, chatId }));
}

async function selectPendingAnswersForDelivery(chatId) {
  return query(getSql("selectPendingAnswersForDelivery", { chatId }));
}

async function selectAllAnswersForExclusion(chatId) {
  return query(getSql("selectAllAnswersForExclusion", { chatId }));
}

async function insertFeedbackAnswer(questionId, prevAnswerId, answer, feedback) {
  return query(getSql("insertFeedbackAnswer", {
    questionId,
    prevAnswerId,
    answer,
    feedback,
  }));
}

async function updateAnswerTelegramStatus(answerId, telSendType) {
  return query(getSql("updateAnswerTelegramStatus", {
    answerId,
    telSendType,
  }));
}

async function updateQuestionDeliveryStatus(questionId, sendType) {
  return query(getSql("updateQuestionDeliveryStatus", {
    questionId,
    sendType,
  }));
}

module.exports = {
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
};

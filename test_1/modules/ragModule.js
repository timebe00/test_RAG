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

async function insertQuestion(integrationsId, question) {
  return query(getSql("insertQuestion", { integrationsId, question }));
}

async function insertAnswer(questionId, answer) {
  return query(getSql("insertAnswer", { questionId, answer }));
}

async function updateAnswerTelegramStatus(answerId, telSendType) {
  return query(getSql("updateAnswerTelegramStatus", {
    answerId,
    telSendType,
  }));
}

module.exports = {
  selectTelegramIntegrations,
  insertQuestion,
  insertAnswer,
  updateAnswerTelegramStatus,
};

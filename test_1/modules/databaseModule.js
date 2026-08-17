const path = require("path");
const mybatisMapper = require("mybatis-mapper");
const { query } = require("../lib/database");

const namespace = "database";
const mapperPath = path.join(__dirname, "../sqlmap/database.xml");

mybatisMapper.createMapper([mapperPath]);

function getSql(statementId, params = {}) {
  return mybatisMapper.getStatement(namespace, statementId, params, {
    language: "mariadb",
    indent: "  ",
  });
}

async function selectDatabaseStatus() {
  return query(getSql("selectDatabaseStatus"));
}

async function selectTables() {
  return query(getSql("selectTables"));
}

module.exports = {
  selectDatabaseStatus,
  selectTables,
};

const {
  selectDatabaseStatus,
  selectTables,
} = require("../modules/databaseModule");

async function getDatabaseStatus() {
  const statusRows = await selectDatabaseStatus();
  const tableRows = await selectTables();

  return {
    ...statusRows[0],
    tables: tableRows.map((row) => row.tableName),
  };
}

module.exports = {
  getDatabaseStatus,
};

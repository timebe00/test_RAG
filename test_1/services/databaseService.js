const { query } = require("../lib/database");

async function getDatabaseStatus() {
  const statusRows = await query(`
    SELECT
      1 AS connectionTest,
      DATABASE() AS databaseName,
      VERSION() AS version,
      NOW() AS serverTime
  `);

  const tableRows = await query(`
    SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);

  return {
    ...statusRows[0],
    tables: tableRows.map((row) => row.tableName),
  };
}

module.exports = {
  getDatabaseStatus,
};

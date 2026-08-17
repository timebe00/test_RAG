const mariadb = require("mariadb");

const pool = mariadb.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.passwordEnv,
  database: config.database.databaseEnv,
  connectionLimit: config.database.connectionLimit,
  acquireTimeout: config.database.acquireTimeout,
});

async function query(sql, params = []) {
  let connection;

  try {
    connection = await pool.getConnection();
    return await connection.query(sql, params);
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = {
  pool,
  query,
};

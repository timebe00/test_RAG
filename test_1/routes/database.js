const express = require("express");
const { getDatabaseStatus } = require("../services/databaseService");

const router = express.Router();

router.get("/test", async function(req, res) {
  try {
    const database = await getDatabaseStatus();

    return res.json({
      ok: true,
      database,
    });
  } catch (error) {
    console.error("Database connection test failed:", error);

    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

module.exports = router;

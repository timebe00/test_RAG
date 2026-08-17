var express = require('express');
var router = express.Router();

const { sendMessage } = require(base + "/lib/sendTelegram");


/* GET home page. */
router.get('/sandMesTelegram', async function(req, res, next) {
  let test = await sendMessage("test_send");

  res.json({test : "test"})
});

//  https://api.telegram.org/bot<토큰>/setWebhook?url=https://www.destop.p-e.kr/telegram/webhook/message
router.post('/telegram/webhook/message', async function(req, res, next) {
  console.log("!!!!!!!!!", req.body.message.text)

  res.json({test : "test2"})
});

module.exports = router;

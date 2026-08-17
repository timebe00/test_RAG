var express = require('express');
var router = express.Router();

const { sendMessage } = require(base + "/lib/sendTelegram");

/* GET home page. */
router.get('/sandMesTelegram', async function(req, res, next) {
  let test = await sendMessage("test_send");

  res.json({test : "test"})
});

//  https://api.telegram.org/bot<토큰>/setWebhook?url=https://www.destop.p-e.kr/telegram/webhook/message
//  텔레그렘에서 답변 받기
router.post('/telegram/webhook/message', async function(req, res, next) {
  if(req.body.message.reply_to_message) {
    const beforAns = req.body.message.reply_to_message.text;
    const getQueAns = beforAns.match(/Q\s*:\s*([\s\S]*?)\n\s*A\s*:\s*([\s\S]*)/);
    if(!getQueAns) {
      await sendMessage("답변 오류");
    }

    //  본래 질문
    const question = getQueAns[1].trim();
    //  본래 답변
    const answer = getQueAns[2].trim();
    //  답변에 대한 피드백
    const feedback = req.body.message.text;
  }

  res.json({test : "test2"})
});

module.exports = router;

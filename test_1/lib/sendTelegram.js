const axios = require('axios');

async function sendMessage(
    msg,
    botToken,
    chatId
) {
    await axios({
        url : "https://api.telegram.org/bot" + botToken + "/sendmessage",
        method:"GET",
        params: {
            chat_id : chatId,
            text : msg
        }
    })
} 

module.exports = {
  sendMessage,
};

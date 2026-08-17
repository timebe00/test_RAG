const axios = require('axios');

async function sendMessage(
    msg,
    botToken = config.telegram.key,
    chatId = config.telegram.clientId
) {
    await axios({
        url : config.telegram.link + "/bot" + botToken + "/sendmessage",
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

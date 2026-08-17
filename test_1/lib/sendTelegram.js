const axios = require('axios');
const telegram = require("node-telegram-bot-api")

async function sendMessage(msg) {
    await axios({
        url : config.telegram.link + "/bot" + config.telegram.key + "/sendmessage",
        method:"GET",
        params: {
            chat_id : config.telegram.clientId,
            text : msg
        }
    })
} 

module.exports = {
  sendMessage,
};

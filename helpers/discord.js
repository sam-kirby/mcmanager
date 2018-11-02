const request = require('request')

function sendDiscordMessage (name, action, apiRequest, requester = "Nobody") {
  request({
    method: 'post',
    url: `https://discordapp.com/api/webhooks/${apiRequest.env.discordID}/${apiRequest.env.discordToken}`,
    json: true,
    body: {
      content: `${name} has been ${action} by ${requester}`
    }
  })
}

module.exports = sendDiscordMessage

const fs = require('fs')
const aws = require('aws-sdk')
const ec2 = new aws.EC2()
const discord = require('./discord')

function genService (server, apiRequest) {
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/kf2/kf2server.sh', (err, data) => {
      if (err) reject(err)
      let output = data.toString().replace(/£REGION/g, apiRequest.env.region)
      output = output.replace(/£BUCKET/g, apiRequest.env.kf2configBucket)
      output = output.replace(/£WEBHOOKID/g, apiRequest.env.kf2DiscordID)
      output = output.replace(/£WEBHOOKTOKEN/g, apiRequest.env.kf2DiscordToken)
      output = output.replace(/£CODE/g, server.code)
      output = output.replace(/£DOMAIN/g, apiRequest.env.domain.slice(0,-1))
      output = output.replace(/£PASSWORD/g, server.special.password)
      resolve(Buffer.from(output).toString('base64'))
    })
  })
}

function genMonitor (server, apiRequest) {
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/kf2/monitor.sh', (err, data) => {
      if (err) reject(err)
      let output = data.toString().replace(/£REGION/g, apiRequest.env.region)
      output = output.replace(/£ACCOUNT/g, apiRequest.env.awsAccountId)
      output = output.replace(/£DOMAIN/g, apiRequest.env.domain)
      output = output.replace(/£HOSTEDZONEID/g, apiRequest.env.hostedZone)
      output = output.replace(/£FBTOKEN/g, apiRequest.env.facebookAccessToken)
      output = output.replace(/£CODE/g, server.code)
      resolve(Buffer.from(output).toString('base64'))
    })
  })
}

function genPrepare (server, apiRequest) {
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/kf2/prepare.sh', (err, data) => {
      if (err) reject(err)
      let output = data.toString().replace(/£REGION/g, apiRequest.env.region)
      output = output.replace(/£HOSTEDZONEID/g, apiRequest.env.hostedZone)
      output = output.replace(/£DOMAIN/g, apiRequest.env.domain)
      output = output.replace(/£BUCKET/g, apiRequest.env.kf2configBucket)
      output = output.replace(/£BETA/g, server.special.beta ? "-beta preview" : "")
      output = output.replace(/£CODE/g, server.code)
      resolve(Buffer.from(output).toString('base64'))
    })
  })
}

function genUserData (server, apiRequest) {
  let userData
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/kf2/userdata.yml', (err, data) => {
      if (err) reject(err)
      resolve(data)
    })
  }).then((output) => {
    userData = userData = output.toString()
    return genPrepare(server, apiRequest)
  }).then((prepare) => {
    userData = userData.replace(/£PREPARE/g, prepare)
    return genService(server, apiRequest)
  }).then((service) => {
    userData = userData.replace(/£SERVICE/g, service)
    return genMonitor(server, apiRequest)
  }).then((monitor) => {
    userData = userData.replace(/£MONITOR/g, monitor)
    return Buffer.from(userData).toString('base64')
  })
}

/**
 * Generate userdata for requested server, determine if spot price is low enough, and then submit an SFR
 * @param server
 * @param apiRequest
 * @returns {Promise.<TResult>}
 */
function kf2start (server, apiRequest) {
  let config
  return new Promise((resolve, reject) => {
    if (server.lastState === 'Started') { reject(Error(`${server.name} must be stopped first`)) }
    fs.readFile('./resource/config.json', (err, data) => {
      if (err) reject(err)
      else resolve(data.toString())
    })
  }).then((data) => {
    config = data
    return genUserData(server, apiRequest)
  }).then((userData) => {
    config = config.replace(/£UDATA/g, userData)
    // check if spot price is below max in any availability zone
    return new Promise((resolve, reject) => {
      ec2.describeSpotPriceHistory({
          AvailabilityZone: 'eu-west-2a',
          InstanceTypes: [server.instance],
          MaxResults: 1,
          ProductDescriptions: ['Linux/UNIX']
        },
        (err, result) => {
          if (err) reject(err)
          else resolve(parseFloat(result.SpotPriceHistory[0].SpotPrice))
        })
    })
  }).then((spA) => {
    if (spA > parseFloat(server.maxprice)) {
      return new Promise((resolve, reject) => {
        ec2.describeSpotPriceHistory({
            AvailabilityZone: 'eu-west-2b',
            InstanceTypes: [server.instance],
            MaxResults: 1,
            ProductDescriptions: ['Linux/UNIX']
          },
          (err, result) => {
            if (err) reject(err)
            else resolve(parseFloat(result.SpotPriceHistory[0].SpotPrice))
          })
      }).then((spB) => {
        if (spB > parseFloat(server.maxprice)) {
          return new Promise((resolve, reject) => {
            ec2.describeSpotPriceHistory({
                AvailabilityZone: 'eu-west-2c',
                InstanceTypes: [server.instance],
                MaxResults: 1,
                ProductDescriptions: ['Linux/UNIX']
              },
              (err, result) => {
                if (err) reject(err)
                else resolve(parseFloat(result.SpotPriceHistory[0].SpotPrice))
              })
          })
        } else return true
      }).then((spC) => {
        return spC <= parseFloat(server.maxprice)
      })
    } else return true
  }).then((priceGood) => {
    return new Promise((resolve, reject) => {
      if (!priceGood) reject(Error(`Spot instance price is currently too high to start ${server.name}`))
      ec2.describeImages({
        Filters: [
          {
            Name: 'owner-alias',
            Values: ['amazon']
          },
          {
            Name: 'name',
            Values: ['amzn2-ami-hvm*']
          }
        ]
      }, (err, data) => {
        if (err) reject(err)
        var result = data.Images.sort((a, b) => (a.CreationDate > b.CreationDate) ? 1 : ((b.CreationDate > a.CreationDate) ? -1 : 0))
        resolve(result.slice(-1)[0].ImageId)
      })
    })
  }).then((ami) => {
    return new Promise((resolve, reject) => {
      let now = new Date()
      config = config.replace(/£FROM/g, now.toISOString())
      config = config.replace(/£TO/g, new Date(now.getTime() + 64800000).toISOString())
      config = config.replace(/£INSTANCETYPE/g, server.instance)
      config = config.replace(/£ACCOUNT/g, apiRequest.env.awsAccountId)
      config = config.replace(/£KEY/g, apiRequest.env.keyName)
      config = config.replace(/£SGID/g, apiRequest.env.kf2sgid)
      config = config.replace(/£MAXPRICE/g, server.maxprice)
      config = config.replace(/£AMI/g, ami)
      ec2.requestSpotFleet({ SpotFleetRequestConfig: JSON.parse(config) }, (err, data) => {
        if (err) reject(err)
        else {
          resolve(data.SpotFleetRequestId)
        }
      })
    })
  }).then((response) => {
    console.log(response)
    if (response.substr(0, 3) === 'sfr') {
      server.lastSFR = response
      server.lastState = 'Started'
      return `${server.name} is now starting\n` +
        `Open the console and use the command below when Hans is ready\n` +
        `open ${server.code}.${apiRequest.env.domain.slice(0,-1)}?password=${server.special.password}\n` +
        `The webadmin is on port 8080; user is admin, password is ${server.special.admin}`
    } else return response
  }).catch((err) => {
    return `${server.name} could not be started because ${err.message}`
  })
}

module.exports = kf2start

const fs = require('fs')
const aws = require('aws-sdk')
const ec2 = new aws.EC2()
const discord = require('./discord')

function genService (server, apiRequest) {
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/music/music.sh', (err, data) => {
      if (err) reject(err)
      let output = data.toString()
      resolve(Buffer.from(output).toString('base64'))
    })
  })
}

function genMonitor (server, apiRequest) {
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/music/monitor.sh', (err, data) => {
      if (err) reject(err)
      let output = data.toString().replace(/£REGION/g, apiRequest.env.region)
      output = output.replace(/£ACCOUNT/g, apiRequest.env.awsAccountId)
      output = output.replace(/£FBTOKEN/g, apiRequest.env.facebookAccessToken)
      output = output.replace(/£CODE/g, server.code)
      resolve(Buffer.from(output).toString('base64'))
    })
  })
}

function genPrepare (server, apiRequest) {
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/music/prepare.sh', (err, data) => {
      if (err) reject(err)
      let output = data.toString().replace(/£REGION/g, apiRequest.env.region)
      output = output.replace(/£BUCKET/g, apiRequest.env.musicbotBucket)
      resolve(Buffer.from(output).toString('base64'))
    })
  })
}

function genUserData (server, apiRequest) {
  let userData
  return new Promise((resolve, reject) => {
    fs.readFile('./resource/music/userdata.yml', (err, data) => {
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
function musicstart (server, apiRequest) {
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
      config = config.replace(/£SGID/g, apiRequest.env.musicbotsgid)
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
      return `${server.name} is now starting`
    } else return response
  }).catch((err) => {
    return `${server.name} could not be started because ${err.message}`
  })
}

module.exports = musicstart

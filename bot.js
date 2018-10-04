'use strict';
const botBuilder = require('claudia-bot-builder');
const fbTemplate = botBuilder.fbTemplate;
const aws = require('aws-sdk');
const s3 = new aws.S3();
const ec2 = new aws.EC2();
const sqs = new aws.SQS();
const request = require('request');
const start = require('./helpers/start');
const discord = require('./helpers/discord');

let users;
let servers;
let servers_modified = false;
let users_modified = false;

/**
 * Retrieves files from Amazon s3, returning a promise which when resolved gives the file body.
 * @param {string} bucket Name of the bucket to retrieve from
 * @param {string} filename Name of the file to retrieve
 */
function readS3File(bucket, filename) {
    return new Promise((resolve, reject) => {
        s3.getObject({Bucket: bucket, Key: filename}, (err, data) => {
            if (err) reject(err);
            else resolve(data.Body);
        });
    });
}

/**
 * Writes a file to s3, the returned promise does not resolve anything, but rejects errors
 * @param {string} bucket
 * @param {string} filename
 * @param {string} body
 * @returns {Promise}
 */
function writeS3File(bucket, filename, body) {
    return new Promise((resolve, reject) => {
        s3.putObject({Body: body, Bucket: bucket, Key: filename}, (err, data) => {
            if (err) reject(err);
        });
    });
}

/**
 * Retrieves and parses a JSON formatted object from s3
 * @param {string} bucket Name of the bucket to retrieve from
 * @param {string} filename Name of the file to retrieve and parse
 */
function readS3JSON(bucket, filename) {
    return readS3File(bucket, filename)
    .then((data) => {
        return JSON.parse(data);
    });
}

/**
 * Writes a JSON serializable object to s3
 * @param bucket
 * @param filename
 * @param object
 * @returns {Promise}
 */
function writeS3JSON(bucket, filename, object) {
    return writeS3File(bucket, filename, JSON.stringify(object));
}

/**
 * Use Facebook's User API to get the name of a user who has initiated conversation with the bot.
 * @param {string} id page scoped ID that the message was retrieved from
 * @param {string} access_token Page access token to use to make the request
 */
function getUserName(id, access_token) {
    return new Promise((resolve, reject) => {
        request({
            url: "https://graph.facebook.com/v2.10/" + id,
            qs: {
                access_token: access_token,
                fields: "first_name,last_name"
            },
            method: "GET"
        }, (error, response, body) => {
            if (error) reject(error);
            else resolve(JSON.parse(body));
        });
    });
}

/**
 * Determines if a user has been approved to use this bot
 * @param userID
 * @returns {boolean}
 */
function userAuthenticated(userID) {
    if (users[userID]) {
        if (users[userID].authorised) return true;
    }
    return false;
}

/**
 * Generates the main menu using the server list. Facebook supports a maximum of 5 servers.
 * @returns {*}
 */
function main_menu()
{
    let reply = new fbTemplate.Generic();
    for(let id in servers) {
        reply.addBubble(servers[id].name, servers[id].subtitle)
        .addImage(servers[id].image)
        .addButton("Start", `START_${servers[id].code}`)
        .addButton("Stop", `STOP_${servers[id].code}`)
        .addButton("Status", `STATUS_${servers[id].code}`);
    }
    return reply.get();
}

/**
 * Determines the state of a server, and if it is still running attempts to stop it.
 * TODO: Check the spot request has a running instance associated with it
 * @param server
 * @param apiRequest
 * @returns {Promise.<TResult>}
 */
function stop(server, apiRequest) {
    return new Promise((resolve, reject) => {
        //check still running
        ec2.describeSpotFleetRequests({SpotFleetRequestIds: [server.lastSFR]}, (err, data) => {
            if (err) reject(err);
            else resolve(data.SpotFleetRequestConfigs[0].SpotFleetRequestState);
        });
    })
    .then((state) => {
        return new Promise((resolve,reject) => {
            if(state !== "active" && state !== "submitted")
                resolve(`It seems ${server.name} has already stopped or is stopping`);
            else if (state === "submitted")
                ec2.cancelSpotFleetRequests({SpotFleetRequestIds: [server.lastSFR]}, (err, data) => {
                   if (err) reject(err);
                   else resolve(`Server ${server.name} had not yet been fulfilled - the request has been cancelled`);
                });
            else {
                sqs.sendMessage({QueueUrl:
                    `https://sqs.${apiRequest.env.region}.amazonaws.com/${apiRequest.env.awsAccountId}/${server.code}`,
                MessageBody: "na",
                MessageAttributes: {
                    "cmd":{
                        DataType: "String",
                        StringValue: "stop"
                }}}, (err, data) => {
                    if (err) reject(err);
                    else resolve(`Server ${server.name} was successfully instructed to stop.`);
                });
            }
        });
    });
}


function status(server, userID, apiRequest) {
    return new Promise((resolve, reject) => {
        //check still running
        ec2.describeSpotFleetRequests({SpotFleetRequestIds: [server.lastSFR]}, (err, data) => {
            if (err) reject(err);
            else resolve(data.SpotFleetRequestConfigs[0].SpotFleetRequestState);
        });
    })
        .then((state) => {
            return new Promise((resolve,reject) => {
                if(state !== "active" && state !== "submitted")
                    resolve(`It seems ${server.name} is currently not running`);
                else if(state === "submitted")
                    resolve(`The spot request has been submitted but not yet fulfilled`);
                else {
                    sqs.sendMessage({QueueUrl:
                            `https://sqs.${apiRequest.env.region}.amazonaws.com/${apiRequest.env.awsAccountId}/${server.code}`,
                        MessageBody: "na",
                        MessageAttributes: {
                            "cmd":{
                                DataType: "String",
                                StringValue: "status"
                            },
                            "user": {
                                DataType: "String",
                                StringValue: userID
                            }}}, (err, data) => {
                        if (err) reject(err);
                        else resolve(`Server ${server.name} has been asked to provide you with its current status.`);
                    });
                }
            });
        });
}

/**
 * Function for directing commands to appropriate functions
 * @param cmd
 * @param userID
 * @param apiRequest
 * @returns {Promise}
 */
function direct(cmd, userID, apiRequest) {
    return new Promise((resolve, reject) => {
        if (cmd === 'GET_STARTED')
            resolve(`Hi ${users[userID].first_name}, you are already authorised to use this bot`);
        if (cmd === 'MAIN_MENU')
            resolve(main_menu());
        if (cmd === 'NOTIFY') {
            users[userID].notify = !users[userID].notify;
            users_modified = true;
            resolve(`Your notification setting is: ${users[userID].notify}`);
        }
        if (cmd.substr(0,5) === 'START') {
            let target = servers[cmd.substr(6)];
            servers_modified=true;
            resolve(start(target, apiRequest));
        }
        if (cmd.substr(0,4) === 'STOP') {
            let target = servers[cmd.substr(5)];
            if (target.lastState === "Stopped") resolve(`It doesn't look like ${target.name} is running`);
            else {
                discord(target.name, "stopped", apiRequest);
                target.lastState = "Stopped";
                servers_modified = true;
                resolve(stop(target, apiRequest));
            }
        }
        if (cmd.substr(0,6) === 'STATUS') {
            let target = servers[cmd.substr(7)];
            resolve(status(target, userID, apiRequest));
        }
        if (cmd.substr(0,5) === 'ADMIN') {
            if (users[userID].admin) {
                if (cmd.substr(6) === "APPROVE") {
                    for (let user in users) {
                        if (!users[user].authorised) resolve(new fbTemplate.Text(`User ${users[user].first_name} ${users[user].last_name} not authorised`)
                        .addQuickReply('Approve', `AUTH_${user}`)
                        .addQuickReply('Deny', `NOAUTH_${user}`).get());
                    }
                    resolve("No new users");
                }
            }
        }
        if (cmd.substr(0,4) === "AUTH") {
            users[cmd.substr(5)].authorised = true;
            users_modified = true;
            resolve(`Operation successful`);
        }
        if (cmd.substr(0,6) === "NOAUTH") {
            delete users[cmd.substr(7)];
            users_modified = true;
            resolve(`Operation successful`);
        }
    });
}

/**
 * Initial message handler
 * @param message
 * @param apiRequest
 * @returns {Promise.<TResult>}
 */
function handleMessage(message, apiRequest) {
    return readS3JSON(apiRequest.env.configBucket, "users.json")
    .then((data) => {
        users = data;
        return userAuthenticated(message.sender);
    })
    .then((auth) => {
        return new Promise((resolve, reject) => {
            if (!auth) reject("AUTH");
            else resolve(readS3JSON(apiRequest.env.configBucket, "servers.json"));
        });
    })
    .then ((data) => {
        servers = data;
        return direct(message.text, message.sender, apiRequest);
    })
    .catch((err) => {
        if (err === "AUTH") {
            if (users[message.sender]) {
                return "Your authorisation is pending";
            }
            if(message.text === "GET_STARTED") {
                return getUserName(message.sender, apiRequest.env.facebookAccessToken)
                .then((name) => {
                    users[message.sender] = {
                        authorised: false,
                        admin: false,
                        first_name: name.first_name,
                        last_name: name.last_name,
                        notify: false
                    };
                    users_modified = true;
                    return "Your details have been registered, pending moderation";
                });
            }
        }
        console.log(err);
        return `An error has occurred and has been logged:\n${err}`;
    });
}

const api = botBuilder((message, apiRequest) => {
    aws.config.update({region: apiRequest.env.region});
    console.log(JSON.stringify(message));
    return handleMessage(message, apiRequest)
    .then((response) => {
        if (servers_modified) writeS3JSON(apiRequest.env.configBucket, "servers.json", servers);
        if (users_modified) writeS3JSON(apiRequest.env.configBucket, "users.json", users);
        console.log(response);
        return response;
    });
},{platforms: ['facebook']});

api.addPostDeployConfig('discordID', 'Discord Webhook ID:', 'configure-discord');
api.addPostDeployConfig('discordToken', 'Discord Webhook Token:', 'configure-discord');
api.addPostDeployConfig('region', 'AWS region in which to launch servers:', 'configure-bot');
api.addPostDeployConfig('configBucket', 'Bucket which stores config data:', 'configure-bot');
api.addPostDeployConfig('mcmpBucket', 'Bucket containing minecraft mod packs:', 'configure-mc');
api.addPostDeployConfig('worldBucket', 'Bucket containing minecraft worlds:', 'configure-mc');
api.addPostDeployConfig('hostedZone', 'Enter the ID of the hosted zone to use with this bot:', 'configure-bot');
api.addPostDeployConfig('domain', 'Enter the domain to use as the root for the servers:', 'configure-bot');
api.addPostDeployConfig('sgid', 'Enter the Security Group ID to use with the minecraft servers:', 'configure-mc');
api.addPostDeployConfig('keyName', 'Enter the name of the key pair to use for ssh connections:', 'configure-mc');
api.addPostDeployConfig('awsAccountId', 'Enter the AWS account ID that will be used to launch the servers:', 'configure-bot');

module.exports = api;
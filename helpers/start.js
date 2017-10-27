var fs = require('fs'),
    aws = require('aws-sdk'),
    ec2 = new aws.EC2()
    discord = require('./discord');

function genService(server, apiRequest) {
    return new Promise((resolve, reject) => {
        fs.readFile("./resource/mcserver.sh", (err, data) => {
            if (err) reject(err);
            var output = data.toString().replace(/£JAR/g, server.special.jar);
            output = output.replace(/£MAXMEM/g, server.special.maxmem);
            output = output.replace(/£CODE/g, server.code);
            output = output.replace(/£WORLD/g, apiRequest.env.worldBucket);
            output = output.replace(/£REGION/g, apiRequest.env.region);
            resolve(Buffer.from(output).toString('base64'));
        });
    });
}

function genMonitor(server, apiRequest) {
    return new Promise((resolve, reject) => {
        fs.readFile("./resource/monitor.sh", (err, data) => {
            if(err) reject(err);
            var output = data.toString().replace(/£CODE/g, server.code);
            output = output.replace(/£REGION/g, apiRequest.env.region);
            output = output.replace(/£ACCOUNT/g, apiRequest.env.awsAccountId);
            output = output.replace(/£DOMAIN/g, apiRequest.env.domain);
            output = output.replace(/£HOSTEDZONEID/g, apiRequest.env.hostedZone);
            resolve(Buffer.from(output).toString('base64'));
        });
    });
}

function genPrepare(server, apiRequest) {
    return new Promise((resolve, reject) => {
        fs.readFile("./resource/prepare.sh", (err,data) => {
            if (err) reject(err);
            var output = data.toString().replace(/£CODE/g, server.code);
            output = output.replace(/£REGION/g, apiRequest.env.region);
            output = output.replace(/£HOSTEDZONEID/g, apiRequest.env.hostedZone);
            output = output.replace(/£DOMAIN/g, apiRequest.env.domain);
            output = output.replace(/£MCMP/g, apiRequest.env.mcmpBucket);
            output = output.replace(/£WORLD/g, apiRequest.env.worldBucket);
            resolve(Buffer.from(output).toString('base64'));
        });
    });
}

function genUserData(server, apiRequest) {
    var userData;
    return new Promise((resolve, reject) => {
        fs.readFile("./resource/userdata.yml", (err, data) => {
            if (err) reject(err);
            resolve(data);
        });
    })
    .then((output) => {
        userData = userData = output.toString();
        return genPrepare(server, apiRequest);
    })
    .then((prepare) => {
        userData = userData.replace(/£PREPARE/g, prepare);
        return genService(server, apiRequest);
    })
    .then((service) => {
        userData = userData.replace(/£SERVICE/g, service);
        return genMonitor(server, apiRequest);
    })
    .then((monitor) => {
        userData = userData.replace(/£MONITOR/g, monitor);
        return Buffer.from(userData).toString('base64');
    });
}

function start(server, apiRequest) {
    var config;
    return new Promise((resolve, reject) => {
        if (server.lastState === "Started")
            reject(`${server.name} must be stopped first`);
        fs.readFile("./resource/config.json", (err,data) => {
            if (err) reject(err);
            else resolve(data.toString());
        });
    }).then((data) => {
        config = data;
        return genUserData(server, apiRequest);
    })
    .then((userData) => {
        config = config.replace(/£UDATA/g, userData);
        //check if spot price is below max in any availability zone
        return new Promise((resolve, reject) => {
            ec2.describeSpotPriceHistory({AvailabilityZone:'eu-west-2a', InstanceTypes:[server.instance], MaxResults:1}, (err, result) => {
                if (err) reject(err);
                else resolve(parseFloat(result.SpotPriceHistory[0].SpotPrice));
            });
        });
    })
    .then((spA) => {
        if (spA > parseFloat(server.maxprice)) return new Promise((resolve, reject) => {
            ec2.describeSpotPriceHistory({AvailabilityZone:'eu-west-2b', InstanceTypes:[server.instance], MaxResults:1}, (err, result) => {
                if (err) reject(err);
                else resolve(parseFloat(result.SpotPriceHistory[0].SpotPrice));
            });
        })
        .then((spB) => {
            if (spB > parseFloat(server.maxprice)) return false;
            else return true;
        });
        else return true;
    })
    .then((priceGood) => {
        return new Promise((resolve, reject) => {
            if (!priceGood) reject(`Spot instance price is currently too high to start ${server.name}`);
            now = new Date();
            config = config.replace(/£FROM/g, now.toISOString());
            config = config.replace(/£TO/g, new Date(now.getTime() + 64800000).toISOString());
            config = config.replace(/£INSTANCETYPE/g, server.instance);
            config = config.replace(/£ACCOUNT/g, apiRequest.env.awsAccountId);
            config = config.replace(/£KEY/g, apiRequest.env.keyName);
            config = config.replace(/£SGID/g, apiRequest.env.sgid);
            config = config.replace(/£MAXPRICE/g, server.maxprice);
            console.log(config);
            ec2.requestSpotFleet({SpotFleetRequestConfig: JSON.parse(config)}, (err, data) => {
                if (err) reject(err);
                else {
                    resolve(data.SpotFleetRequestId);
                }
            });
        });
    })
    .then((response) => {
        console.log(response);
        if (response.substr(0,3) === "sfr") {
            server.lastSFR = response;
            server.lastState = "Started";
            discord(server.name, "started", apiRequest);
            return `${server.name} is now starting with address ${server.code}.${apiRequest.env.domain} Please wait 5 minutes before connecting or checking its status`;
        }
        else return response;
    })
    .catch((response) => {
        return `${server.name} could not be started because ${response}`;
    });
}

module.exports = start;
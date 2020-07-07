const fs = require('fs');
const axios = require('axios');
const publicIp = require('public-ip');
const moment = require('moment-timezone');
const AWS = require('aws-sdk');
require('dotenv').config();

const required = ['AWS_DOMAINS', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_HOSTED_ZONE_ID'];
const AWS_DOMAINS = (process.env.AWS_DOMAINS !== undefined && process.env.AWS_DOMAINS !== '') ? process.env.AWS_DOMAINS.split(',').map((AWS_DOMAIN) => AWS_DOMAIN.trim()) : [];

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
const route53 = new AWS.Route53();

const run = async () => {
  for (let i = 0; i < required.length; i++) {
    if (process.env[required[i]] === '' || process.env[required[i]] === undefined) {
      console.log('missing environment variables');
      return;
    }
  }

  if (!AWS_DOMAINS.length) {
    console.log('at least one domain needs to be set');
    return;
  }

  const tz = (process.env.TZ === undefined || process.env.TZ === '') ? 'America/Detroit' : process.env.TZ;

  const time = moment().tz(tz).format('MM/DD/YYYY hh:mm:ssa');
  const currentIp = await publicIp.v4();

  console.log('-'.repeat(time.length));
  console.log(time);
  console.log('-'.repeat(time.length));

  if (!fs.existsSync('ip.json')) {
    fs.writeFileSync('ip.json', JSON.stringify({ ip: currentIp }));
  }

  const previousIp = JSON.parse(fs.readFileSync('ip.json')).ip;

  if (currentIp === previousIp) {
    console.log('no change');
    return;
  }

  console.log(`previous: ${previousIp}\ncurrent: ${currentIp}`);

  try {
    const allRecordSets = await route53.listResourceRecordSets({ HostedZoneId: process.env.AWS_HOSTED_ZONE_ID }).promise();
    for (let i = 0; i < allRecordSets.ResourceRecordSets.length; i += 1) {
      const recordSet = allRecordSets.ResourceRecordSets[i];
      if (AWS_DOMAINS.includes(recordSet.Name)) {
        await route53.changeResourceRecordSets({
          ChangeBatch: {
            Changes: [
              {
                Action: 'UPSERT',
                ResourceRecordSet: {
                  Name: recordSet.Name,
                  Type: 'A',
                  ResourceRecords: [{ Value: currentIp }],
                  TTL: 300,
                },
              },
            ],
          },
          HostedZoneId: process.env.AWS_HOSTED_ZONE_ID,
        }).promise();
      }
    }
    console.log('updated route 53');
    fs.writeFileSync('ip.json', JSON.stringify({ ip: currentIp }));
    if (process.env.POST_URL !== undefined && process.env.POST_URL !== '') {
      await axios({
        method: 'post',
        url: process.env.POST_URL,
        data: {
          title: 'IP Changed',
          text: `Previous: ${previousIp}\nCurrent: ${currentIp}`,
        },
      });
    }
  } catch (error) {
    console.log('error updating route 53');
    console.log(error.message);
  }
};

(async () => {
  await run();
  const interval = (process.env.INTERVAL === undefined || process.env.INTERVAL === '') ? 0 : parseFloat(process.env.INTERVAL);
  if (interval > 0) {
    setTimeout(async () => {
      await run();
    }, interval * 60 * 1000);
  }
})();

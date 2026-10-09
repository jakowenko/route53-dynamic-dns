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

  console.log('-'.repeat(time.length));
  console.log(time);
  console.log('-'.repeat(time.length));

  try {
    const currentIp = await publicIp.v4();

    // Route 53 is the source of truth for the previous IP, so restarts and
    // other instances updating the same records don't trigger false changes.
    const recordSets = [];
    let params = { HostedZoneId: process.env.AWS_HOSTED_ZONE_ID };
    for (;;) {
      const page = await route53.listResourceRecordSets(params).promise();
      recordSets.push(...page.ResourceRecordSets);
      if (!page.IsTruncated) break;
      params = {
        ...params,
        StartRecordName: page.NextRecordName,
        StartRecordType: page.NextRecordType,
        StartRecordIdentifier: page.NextRecordIdentifier,
      };
    }

    const aRecords = recordSets.filter((recordSet) => recordSet.Type === 'A' && AWS_DOMAINS.includes(recordSet.Name.replace(/\.$/, '')));
    const missing = AWS_DOMAINS.filter((domain) => !aRecords.some((recordSet) => recordSet.Name.replace(/\.$/, '') === domain));
    if (missing.length) {
      console.log(`no A record found for: ${missing.join(', ')}`);
    }

    const outdated = aRecords.filter((recordSet) => (recordSet.ResourceRecords || []).map((record) => record.Value).join(',') !== currentIp);
    if (!outdated.length) {
      console.log('no change');
      return;
    }

    const previousIps = [...new Set(outdated.map((recordSet) => (recordSet.ResourceRecords || []).map((record) => record.Value).join(',') || 'none'))];
    const previousIp = previousIps.join(', ');
    console.log(`previous: ${previousIp}\ncurrent: ${currentIp}`);

    await route53.changeResourceRecordSets({
      ChangeBatch: {
        Changes: outdated.map((recordSet) => ({
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: recordSet.Name,
            Type: 'A',
            ResourceRecords: [{ Value: currentIp }],
            TTL: 300,
          },
        })),
      },
      HostedZoneId: process.env.AWS_HOSTED_ZONE_ID,
    }).promise();
    console.log(`${outdated.length} record(s) updated in route 53`);

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
    setInterval(async () => {
      await run();
    }, interval * 60 * 1000);
  }
})();

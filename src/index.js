const { Route53Client, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand } = require('@aws-sdk/client-route-53');

try {
  process.loadEnvFile();
} catch (error) {
  // no .env file, use the environment as is
}

const required = ['AWS_DOMAINS', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_HOSTED_ZONE_ID'];
const AWS_DOMAINS = (process.env.AWS_DOMAINS !== undefined && process.env.AWS_DOMAINS !== '') ? process.env.AWS_DOMAINS.split(',').map((AWS_DOMAIN) => AWS_DOMAIN.trim()) : [];
const IP_URLS = ['https://checkip.amazonaws.com', 'https://api.ipify.org', 'https://ipv4.icanhazip.com'];

const route53 = new Route53Client({ region: process.env.AWS_REGION });

const timestamp = (tz) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}${parts.dayPeriod.toLowerCase()}`;
};

const publicIp = async () => {
  for (const url of IP_URLS) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const ip = (await response.text()).trim();
      if (response.ok && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return ip;
    } catch (error) {
      // try the next service
    }
  }
  throw new Error('unable to determine public ip');
};

const recordValue = (recordSet) => (recordSet.ResourceRecords || []).map((record) => record.Value).join(',');

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
  const time = timestamp(tz);

  console.log('-'.repeat(time.length));
  console.log(time);
  console.log('-'.repeat(time.length));

  try {
    const currentIp = await publicIp();

    // Route 53 is the source of truth for the previous IP, so restarts and
    // other instances updating the same records don't trigger false changes.
    const recordSets = [];
    let params = { HostedZoneId: process.env.AWS_HOSTED_ZONE_ID };
    for (;;) {
      const page = await route53.send(new ListResourceRecordSetsCommand(params));
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

    const outdated = aRecords.filter((recordSet) => recordValue(recordSet) !== currentIp);
    if (!outdated.length) {
      console.log('no change');
      return;
    }

    const previousIp = [...new Set(outdated.map((recordSet) => recordValue(recordSet) || 'none'))].join(', ');
    console.log(`previous: ${previousIp}\ncurrent: ${currentIp}`);

    await route53.send(new ChangeResourceRecordSetsCommand({
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
    }));
    console.log(`${outdated.length} record(s) updated in route 53`);

    if (process.env.POST_URL !== undefined && process.env.POST_URL !== '') {
      await fetch(process.env.POST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'IP Changed',
          text: `Previous: ${previousIp}\nCurrent: ${currentIp}`,
        }),
        signal: AbortSignal.timeout(10000),
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

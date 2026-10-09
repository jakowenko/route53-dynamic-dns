Keeps Route 53 A records pointed at your public IP. Each check compares the public IP with the A records already in Route 53 and only updates (and notifies about) the ones that differ, so restarts don't cause false changes and several instances can safely manage the same records.

## Options

| Name | Description |
|--|--|
| INTERVAL | Interval in minutes before rechecking public IP |
| AWS_DOMAINS | Comma separated list of domains to update (home.example.com, vpn.example.com) |
| AWS_ACCESS_KEY_ID | AWS Access Key for IAM user |
| AWS_SECRET_ACCESS_KEY | AWS Secret Access Key for IAM user |
| AWS_REGION | AWS Region |
| AWS_HOSTED_ZONE_ID | AWS Route53 Hosted Zone ID |
| POST_URL | Optional URL that receives a JSON POST (`title`, `text`) when the IP changes |
| TZ | Timezone used in logs (default `America/Detroit`) |

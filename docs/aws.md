# AWS access and the EC2 console

## Connect

Account, CLI profile and resource ids live in the gitignored `.env` (start from `.env.example`). Keys stay in
`~/.aws/credentials` under `AWS_PROFILE`, never in the repo. Use `ap-southeast-2` (Sydney): the organization's SCP
denies EC2 in the other regions.

```bash
set -a; . ./.env; set +a            # AWS_PROFILE, AWS_REGION and launch defaults
aws sts get-caller-identity         # confirm the expected account and user
aws ec2 describe-instances --filters Name=tag:app,Values=field-to-fix \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,PublicIpAddress]' --output table
```

Nothing in the code hardcodes a region: the backend reads
`AWS_REGION` (then `AWS_DEFAULT_REGION`, default `ap-southeast-2`) and picks the matching Bedrock inference
profile (`apac.amazon.nova-lite-v1:0` in Sydney) unless `BEDROCK_MODEL_ID` is set.

## Launch the console

```bash
infra/_launch.sh                    # prints the instance id
```

Reads defaults from `.env`. In `ap-southeast-2` these already exist and are reused:

| Resource | Name / id |
|---|---|
| Security group | `f2f-console-sg`, id in `.env` as `SG` (22 and 8000 from the IP that created it) |
| Key pair | `field-to-fix-key` (private key `infra/field-to-fix-key.pem`, gitignored; only copy) |
| Instance profile | `f2f-console-agentcore-profile` → role `f2f-console-agentcore-role` (Bedrock + AgentCore invoke) |

Any that is missing is created. The instance clones `master` from GitHub, builds the Docker image and serves
the console on `:8000` (about 5 minutes). Container settings are written to `/etc/f2f.env` on the instance.

```bash
IP=$(aws ec2 describe-instances --filters Name=tag:app,Values=field-to-fix Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
curl http://$IP:8000/api/health     # {"mode":"aws","llm":"bedrock",...}
```

If your IP changed, allow the new one:

```bash
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 8000 \
  --cidr "$(curl -s https://checkip.amazonaws.com)/32"     # repeat with --port 22 for SSH
```

## Redeploy, stop, terminate

```bash
ssh -i infra/field-to-fix-key.pem ec2-user@$IP 'sudo bash /opt/field-to-ota/infra/_redeploy_remote.sh'
aws ec2 stop-instances --instance-ids <id>        # keeps the 20 GB disk (~$2/month); new IP on start
aws ec2 terminate-instances --instance-ids <id>   # deletes instance and disk; SG, key and role stay
```

## AgentCore

`DISCOVERY_AGENTCORE_ARN` / `RCA_AGENTCORE_ARN` are unset, so field discovery and RCA run in-process (NHTSA /
Reddit / issue-tracker APIs plus Bedrock classification). The earlier harnesses were in another account
(in us-east-1) and are not reachable from here. To use AgentCore, create harnesses in this account
in `ap-southeast-2` and set the ARNs in `.env` before launching.

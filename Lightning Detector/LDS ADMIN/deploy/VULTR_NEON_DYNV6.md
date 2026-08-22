# Vultr + Neon + dynv6 deployment

This guide deploys the panel on a small Vultr VPS, with the database on
Neon (free Postgres) and the public hostname on dynv6.net (free dynamic
DNS). The client gets a single branded URL like
`https://lightning.dynv6.net`. The Clickatell gateway runs invisibly
server-side.

## 0. What you need

- Vultr account → 1 small "Cloud Compute" instance
  ($6/mo, 1 vCPU / 1 GB / Ubuntu 24.04 LTS is plenty)
- Neon account → free project, region close to your VPS
- dynv6.net account → one free hostname, e.g. `lightning.dynv6.net`
- Clickatell account with a One API setup (SMS)

## 1. Create the Neon database

1. Sign up at https://neon.tech, create project `lightning-alerts`,
   pick the region closest to the Vultr region you'll use.
2. Default database `neondb` is fine.
3. In **Connection Details** select **Pooled connection** → copy the
   `postgres://...` string. This goes into `.env` as `DATABASE_URL`.
4. Tables are created automatically on first boot of the panel.

## 2. Create the Vultr VPS

1. Deploy → Cloud Compute → Regular → Ubuntu 24.04 LTS → 1 GB plan.
2. Add your SSH key, deploy. Copy the public IPv4 (and IPv6 if shown).
3. SSH in:
   ```bash
   ssh root@<VPS_IP>
   apt update && apt -y upgrade
   apt -y install ca-certificates curl ufw
   curl -fsSL https://get.docker.com | sh
   ufw allow OpenSSH
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw --force enable
   ```

## 3. Point dynv6 at the VPS

1. Sign up at https://dynv6.net, create a hostname, e.g.
   `lightning.dynv6.net` (DNS zone type works fine).
2. Set the **A record** to your Vultr IPv4 (and **AAAA** to IPv6 if any).
3. (Optional) On the VPS, install dynv6's updater so the IP self-heals
   if Vultr ever changes it:
   ```bash
   curl -fsSL https://dynv6.com/scripts/dynv6.sh -o /usr/local/bin/dynv6.sh
   chmod +x /usr/local/bin/dynv6.sh
   # token + hostname from dynv6 dashboard
   echo '*/5 * * * * root /usr/local/bin/dynv6.sh <HOSTNAME> <TOKEN> >/dev/null 2>&1' \
        >/etc/cron.d/dynv6
   ```
4. Verify from your laptop: `ping lightning.dynv6.net` should return the
   VPS IP.

## 4. Copy the panel to the VPS

From your dev machine (or `git clone` directly on the VPS):
```bash
scp -r admin_panel root@<VPS_IP>:/opt/lightning-panel
ssh root@<VPS_IP>
cd /opt/lightning-panel
cp .env.example .env
nano .env
```
Fill in:
- `APP_SECRET_KEY`: `openssl rand -hex 48`
- `DATABASE_URL`: Neon pooled connection string
- `ALERT_WEBHOOK_TOKEN`: `openssl rand -hex 32`  (also goes on the Pi)
- `CLICKATELL_API_KEY`: from the Clickatell One API (SMS) setup
- `CLICKATELL_DLR_TOKEN`: optional shared secret for delivery-receipt
  callbacks (must match the value configured in Clickatell)
- `SECURE_COOKIES`: leave as `true` (served over HTTPS via Caddy)
- `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`

> The shipped `.env` already has a strong `APP_SECRET_KEY` and
> `ALERT_WEBHOOK_TOKEN` generated for you, and the same token is already set
> on the Pi in `lightning_config.json`. You still need to fill in
> `DATABASE_URL` (Neon) and `CLICKATELL_API_KEY` (from your Clickatell portal).

### Quick deploy (script)
Once `.env` is filled in and dynv6 points here, run the one-shot script
instead of doing steps 5-6 by hand. It preflight-checks `.env`, installs
Docker + Caddy, builds the container, and configures HTTPS:
```bash
sudo DOMAIN=gwld1-admin.dynv6.net bash deploy/deploy_on_vps.sh
```

## 5. Bring the panel up

```bash
docker compose up -d --build
docker compose logs -f panel    # confirm it boots and connects to Neon
```
The panel listens only on `127.0.0.1:8000`; Caddy will be the public face.

## 6. Install Caddy for HTTPS

```bash
apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
     | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
     | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt -y install caddy

cp /opt/lightning-panel/deploy/Caddyfile /etc/caddy/Caddyfile
sed -i 's/{$DOMAIN}/gwld1-admin.dynv6.net/' /etc/caddy/Caddyfile  # use yours
systemctl restart caddy
```
Caddy will auto-issue a Let's Encrypt cert for the dynv6 hostname within
~30 seconds. Browse `https://gwld1-admin.dynv6.net`; you should land on
the login page.

## 7. Wire the Pi

In `/path/to/lightning_config.json` on the Pi:
```json
{
  "alert_webhook_enabled": true,
  "alert_webhook_url":   "https://gwld1-admin.dynv6.net/api/v1/lightning",
  "alert_webhook_token": "<same as ALERT_WEBHOOK_TOKEN in VPS .env>",
  "alert_webhook_timeout": 5,
  "alert_distance_km": 15
}
```
```bash
sudo systemctl restart lightning-detector.service
```
Trigger a test event (or wait for one). Watch on the VPS:
```bash
docker compose logs -f panel
```
And in the panel UI under **Events** you'll see the row with per-recipient
delivery status.

## 8. Optional hardening

- Restrict `/api/v1/lightning` to the Pi's public IP in the Caddyfile
  (snippet provided, commented out).
- Snapshot Neon nightly (built-in point-in-time restore on paid tier;
  manual `pg_dump` cron on free tier).
- Rotate `ALERT_WEBHOOK_TOKEN` and `CLICKATELL_API_KEY` quarterly.
- Add fail2ban for SSH.

## 9. Updates

```bash
cd /opt/lightning-panel
git pull              # or scp the new files
docker compose up -d --build
```
SQLAlchemy `create_all` is idempotent; existing Neon tables are kept.
For destructive schema changes, add Alembic later.

## Cost summary

| Item    | Tier              | Monthly |
|---------|-------------------|---------|
| Vultr   | 1 GB Cloud Compute| $6      |
| Neon    | Free              | $0      |
| dynv6   | Free              | $0      |
| Caddy   | OSS               | $0      |
| Clickatell | pay-per-message | usage   |

Total fixed: **$6/month** for the hosted panel.

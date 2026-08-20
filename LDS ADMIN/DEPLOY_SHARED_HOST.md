# Deploying the panel to the shared host

`deploy/deploy_on_vps.sh` must **not** be run against the current server. This
is the procedure that replaces it.

## Why the old script is unsafe here

It was written for a dedicated, single-purpose VPS. Near the end it does:

```bash
sed "s/{\$DOMAIN}/$DOMAIN/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl restart caddy
```

`deploy/Caddyfile` declares one site, so that **replaces the entire reverse
proxy config with a single vhost**. The script also installs Caddy, which binds
ports 80 and 443, and runs `ufw enable`.

## What the layout actually is now

Verified by DNS lookup, TCP probe and HTTP response headers:

| Host | Resolves to | tcp/22 | HTTPS | Notes |
|------|-------------|--------|-------|-------|
| `gwld1-admin.dynv6.net` | 139.84.238.225 | no answer | no answer | the panel's old dedicated VPS, decommissioned |
| `adminpanel.stratusweather.co.za` | 139.84.242.126 | open | 303 to `/login`, `Server: uvicorn` | the panel, live |
| `stratusweather.co.za` | 139.84.242.126 | open | 200 | Stratus, live |

Both sites are on **one box**, `139.84.242.126`. Stratus lives in `/opt/stratus`
and is fronted by Traefik on 80/443 (see the traefik labels in
`deploy/docker-compose.prod.yml` in the Stratus repo). So installing Caddy there
would contend for those ports and drop the Stratus vhost.

The defaults in `deploy/_ssh_deploy.py` still point at the decommissioned host,
so that script needs `DEPLOY_HOST` / `DEPLOY_DOMAIN` overriding before use.

## The change being deployed needs no proxy work at all

This release is **application code and static files only**:

- `app/static/vendor/` - four vendored bundles (react, prop-types, react-dom, recharts)
- `app/static/js/cpu-chart.js`, `app/static/js/storm-view.js`
- `app/static/style.css`
- `app/templates/base.html`, `app/templates/dashboard.html`

No new port, no new hostname, no new route. The reverse proxy already sends
`adminpanel.stratusweather.co.za` to the panel container, and `/static` is
already mounted and serving (`/static/style.css` and `/static/app.js` both
return 200 today, while the new files return 404). So the deploy is: put the
files on the box, rebuild the panel container. Nothing else is touched.

## Procedure

Set the target first. Adjust `PANEL_DIR` if the panel does not live in
`/opt/lightning-panel` on this box.

```bash
HOST=root@139.84.242.126
PANEL_DIR=/opt/lightning-panel
```

### 1. Confirm where the panel lives and what runs it

```bash
ssh $HOST 'docker ps --format "{{.Names}}\t{{.Image}}\t{{.Ports}}"'
ssh $HOST 'ls -la /opt'
ssh $HOST 'docker inspect lightning-alert-panel --format "{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}"'
```

Note which reverse proxy is actually running before changing anything:

```bash
ssh $HOST 'ss -ltnp | grep -E ":(80|443) "'
```

### 2. Back up first

```bash
ssh $HOST "cd $PANEL_DIR && tar -czf /root/panel-backup-\$(date +%F-%H%M).tar.gz app data .env"
```

The panel keeps its SQLite database in `data/panel.db` when `DATABASE_URL` is
SQLite. If it is pointed at Neon Postgres, that is backed up separately and the
tar above is only the code and config.

### 3. Upload

Send only the directories that changed. `--delete` is scoped to `app/static`
and `app/templates` so a removed asset does not linger, and nothing outside
those paths can be affected.

```bash
rsync -az --delete \
  --exclude '__pycache__' \
  "app/static/" "$HOST:$PANEL_DIR/app/static/"

rsync -az --delete \
  "app/templates/" "$HOST:$PANEL_DIR/app/templates/"

rsync -az --exclude '__pycache__' \
  app/*.py app/routes "$HOST:$PANEL_DIR/app/"
```

If `rsync` is unavailable on Windows, use the existing bundle path instead but
stop before the proxy step:

```bash
python deploy/_ssh_deploy.py   # after setting DEPLOY_HOST/DEPLOY_DOMAIN
```

and be aware that script calls `deploy_on_vps.sh` at the end, which is the part
that must not run here. Prefer the rsync route.

### 4. Rebuild only the panel

`docker compose` scopes to the project in that directory, so this cannot touch
the Stratus containers.

```bash
ssh $HOST "cd $PANEL_DIR && docker compose up -d --build panel"
ssh $HOST "cd $PANEL_DIR && docker compose ps"
```

Do **not** run `docker compose down` on a shared box if the compose file has
ever been extended to include proxy services. `up -d --build panel` recreates
just the one service.

### 5. Verify

```bash
# app is up behind the proxy
curl -s -o /dev/null -w '%{http_code}\n' https://adminpanel.stratusweather.co.za/login

# the new assets now resolve (these returned 404 before the deploy)
for p in /static/js/cpu-chart.js /static/js/storm-view.js /static/vendor/recharts.js \
         /static/vendor/react.production.min.js /static/vendor/react-dom.production.min.js \
         /static/vendor/prop-types.min.js; do
  printf '%-46s %s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' https://adminpanel.stratusweather.co.za$p)"
done

# Stratus is untouched
curl -s -o /dev/null -w '%{http_code}\n' https://stratusweather.co.za/
```

All asset checks should be 200 and both sites should stay up.

Then log in, open the dashboard and confirm:

- the CPU chart is interactive, with WARN 70 and CRIT 78 reference lines
- the 24h / 7d / 30d buttons refetch
- the storm card draws distance rings with the energy legend
- the browser console shows no CSP violations

### 6. Run the suite against the real WeasyPrint libraries

This is the only place the PDF generation check actually executes; it skips on a
developer machine without Pango and GObject.

```bash
ssh $HOST "cd $PANEL_DIR && docker build -f Dockerfile.test -t lds-admin:test . && docker run --rm lds-admin:test"
```

Expect 77 tests with none skipped. Off-container it is 76 passed, 1 skipped.

## Rollback

```bash
ssh $HOST "cd $PANEL_DIR && tar -xzf /root/panel-backup-<stamp>.tar.gz && docker compose up -d --build panel"
```

## Credentials

Nothing in this repo holds a working credential for `139.84.242.126`:

- `deploy/keys/gwld1_deploy` was issued for the decommissioned host and is
  rejected there (`Permission denied (publickey,password)`).
- `deploy/.deploy_secret` is absent, and the hardcoded fallback password was
  removed from `deploy/_ssh_deploy.py` because this folder is committed.

Supply access as either:

- an SSH key already authorised on the box, passed as `DEPLOY_KEY`, or
- the root password in `deploy/.deploy_secret` (one line, gitignored) or the
  `DEPLOY_PASSWORD` environment variable.

// Check Dropbox metadata for Wonderkop file
const path = '/CAMPBELLSCI/Environgaka/GLENCORE WONDERKOP/IT_Environgaka_Glencore_Wonderkop_Table1.dat';

async function getAccessToken() {
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('No access_token: ' + JSON.stringify(j));
  return j.access_token;
}

async function main() {
  const token = await getAccessToken();
  console.log('Got access token');

  const res = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const j = await res.json();
  console.log('Metadata response:');
  console.log(JSON.stringify(j, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });

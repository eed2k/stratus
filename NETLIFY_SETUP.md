# Netlify Deployment Setup

## Required Settings in Netlify Dashboard

Go to: **Site settings → Build & deploy → Build command**

### Build Settings
| Setting | Value |
|---------|-------|
| **Base directory** | (empty or /) |
| **Build command** | `npm run build` |
| **Publish directory** | `client/dist` |
| **Functions directory** | `netlify/functions` |

⚠️ **IMPORTANT**: These UI settings will override `netlify.toml` if they are configured. Make sure they match exactly.

### Environment Variables
Go to: **Site settings → Build & deploy → Environment**

Add these environment variables:
```
DATABASE_URL = postgresql://user:password@host:5432/dbname
JWT_SECRET = [random 32-character secret]
```

To generate JWT_SECRET on Windows PowerShell:
```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

## Verify Before Deploying
1. ✅ `netlify.toml` is committed to GitHub
2. ✅ `package.json` has `build` script: `npm run build:functions && npm run build:client`
3. ✅ `client/package.json` has build script
4. ✅ `serverless-src/functions/` has TypeScript files
5. ✅ UI settings match values above

## If Build Still Fails
1. Clear build cache: Site settings → Build & deploy → Trigger deploy → Clear cache and retry
2. Check build logs for exact error
3. Verify `netlify.toml` is present in repository root

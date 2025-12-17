# Netlify Deployment Setup for STRATUS

## Step 1: Connect GitHub Repository

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Click **Add new site** → **Import an existing project**
3. Choose **GitHub** and select your repository: `reuxnergy-admin1/stratus`

## Step 2: Configure Build Settings

| Setting | Value |
|---------|-------|
| **Base directory** | (leave empty) |
| **Build command** | `npm run build` |
| **Publish directory** | `client/dist` |
| **Functions directory** | `netlify/functions` |

## Step 3: Environment Variables

Go to: **Site settings → Environment variables**

Add this environment variable:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your PostgreSQL connection string |

**Note:** You'll need a production PostgreSQL database. Options:
- [Neon](https://neon.tech) (free tier available)
- [Supabase](https://supabase.com) (free tier available)
- [Railway](https://railway.app)

## Step 4: Enable Identity (Already Done)

Your site already has Netlify Identity enabled. Users registered in Identity will be able to log in.

## Step 5: Deploy

1. Click **Deploy site**
2. Wait for the build to complete
3. Visit your site URL

## Verify Deployment

After deploying:
1. Visit your Netlify site URL
2. Click **Sign In**
3. The Netlify Identity widget should appear
4. Log in with your verified email
5. After login, you should see the dashboard

## Troubleshooting

### Build fails
1. Check the build logs in Netlify
2. Ensure `netlify.toml` is committed to your repository
3. Clear cache: **Deploys** → **Trigger deploy** → **Clear cache and deploy site**

### Identity not working
1. Verify Identity is enabled: **Site settings** → **Identity**
2. Check that your user email is verified
3. Ensure Registration is set to **Open** or **Invite only**

### Database connection fails
1. Verify `DATABASE_URL` is set correctly in environment variables
2. Ensure the database allows connections from Netlify's IP addresses
3. Check if the database requires SSL (add `?sslmode=require` to the URL)

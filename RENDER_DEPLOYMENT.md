# 🚀 Mamar Bari POS - Render Deployment Guide

Follow these steps exactly to deploy your system to Render for free today!

## Prerequisites
1. Create a free account at [Render.com](https://render.com)
2. Push this entire `mamar-bari-pos-crm` folder to a GitHub repository.
3. Connect your GitHub account to Render.

---

## Step 1: Deploy the Database
Render offers a free managed PostgreSQL database.

1. In the Render Dashboard, click **New +** -> **PostgreSQL**.
2. Name it `mamrbari-db` (or anything you want).
3. Select the **Free** tier.
4. Click **Create Database**.
5. Once it spins up, copy the **Internal Database URL** (if deploying backend to Render) or the **External Database URL**. It will look something like `postgres://user:pass@render.com/mamrbari`.

> [!IMPORTANT]  
> Once your Render database is running, you must run the schema file against it to create the tables. You can use the Adminer interface, pgAdmin, or run this command locally replacing the URL with your Render External DB URL:  
> `psql "postgres://user:pass@render.com/mamrbari" -f backend/schema.sql`

---

## Step 2: Deploy the Backend
The backend runs the API, WebSockets, and Authentication.

1. In the Render Dashboard, click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. **Settings:**
   - **Name:** `mamrbari-api`
   - **Root Directory:** `backend` (Very important!)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. **Environment Variables:**
   - Click "Advanced" and add these environment variables:
     - `DATABASE_URL` = *(Paste the Database URL you copied in Step 1)*
     - `JWT_SECRET` = `mamar_bari_production_key_2026`
5. Select **Free Tier** and click **Create Web Service**.
6. Wait for the deploy to finish. Copy the assigned URL (e.g., `https://mamrbari-api.onrender.com`).

---

## Step 3: Deploy the Frontend
The React frontend can be deployed as a lightning-fast Static Site (100% free, never sleeps).

1. In the Render Dashboard, click **New +** -> **Static Site**.
2. Connect the same GitHub repository.
3. **Settings:**
   - **Name:** `mamrbari-pos`
   - **Root Directory:** `frontend` (Very important!)
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. **Environment Variables:**
   - Add this variable so the frontend knows where the backend lives:
     - `VITE_API_URL` = *(Paste the Backend URL from Step 2, e.g., https://mamrbari-api.onrender.com)*
5. Click **Create Static Site**.

---

## Step 4: Keep the Backend Awake (Uptime Robot)
Because you are on Render's free tier, the backend (`mamrbari-api`) will go to sleep after 15 minutes of inactivity. We just added a `/health` route to prevent this.

1. Go to [UptimeRobot.com](https://uptimerobot.com) and create a free account.
2. Click **Add New Monitor**.
3. **Monitor Type:** `HTTP(s)`
4. **Friendly Name:** `Mamar Bari Backend`
5. **URL (or IP):** `https://mamrbari-api.onrender.com/health` (Replace with your actual backend URL + `/health`)
6. **Monitoring Interval:** Every 5 minutes.
7. Click **Create Monitor**.

**🎉 You're Done!** 
Your restaurant POS is now live on the internet, secure, and will stay awake 24/7 for zero hosting costs!

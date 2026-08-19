# Deployment Guide

This guide describes how to deploy the Job Ingestion Pipeline and Dashboard using the provided [Dockerfile](file:///c:/Users/saumy/Downloads/Acdyon/Dockerfile).

Because the service uses a local SQLite database, **you must configure a persistent disk (volume) mount** to ensure database records are not lost when the container restarts or redeploys.

---

## 1. Render Deployment (Docker)

Render supports containerized applications with persistent disks.

### Steps:
1. Connect your GitHub repository to **Render**.
2. Create a new **Web Service**.
3. Select **Docker** as the Runtime (Render detects the [Dockerfile](file:///c:/Users/saumy/Downloads/Acdyon/Dockerfile) automatically).
4. Scroll down to the **Advanced** section and add a **Persistent Disk (Volume)**:
   - **Name**: `jobs-db-volume` (or any name)
   - **Mount Path**: `/app/data`
   - **Size**: `1 GiB` (minimum free tier or lowest size is sufficient)
5. Add the following **Environment Variables** in the Service settings:
   - `DB_PATH`: `/app/data/jobs.db` *(Points SQLite inside the persistent volume mount)*
   - `NODE_ENV`: `production`
   - `FETCH_INTERVAL_MINUTES`: `30` *(Recommended for production to space out API scraping cycles)*
6. Click **Deploy Web Service**.

---

## 2. Railway Deployment (Docker)

Railway builds and deploys Docker containers out-of-the-box.

### Steps:
1. Create a new project on **Railway** and link your GitHub repository.
2. Railway detects the [Dockerfile](file:///c:/Users/saumy/Downloads/Acdyon/Dockerfile) and schedules a build automatically.
3. Once build starts, go to the Service's **Settings** tab.
4. Under the **Volumes** section, click **Add Volume** to attach a persistent volume:
   - **Mount Path**: `/app/data`
5. Go to the **Variables** tab and add:
   - `DB_PATH`: `/app/data/jobs.db`
   - `NODE_ENV`: `production`
   - `FETCH_INTERVAL_MINUTES`: `30`
6. Redeploy the service.

---

## 3. Fly.io Deployment

Fly.io is optimized for containerized apps and makes volume attachments straightforward via CLI.

### Steps:
1. Initialize the app launcher:
   ```bash
   fly launch
   ```
   *(Select default options. Do not deploy yet).*
2. Create a persistent volume in your preferred region:
   ```bash
   fly volumes create jobs_data --size 1 --region <your-region-code>
   ```
3. Open the generated `fly.toml` file and add the volume mount configuration:
   ```toml
   [[mounts]]
     source = "jobs_data"
     destination = "/app/data"
   ```
4. Set your environment variables in `fly.toml` or via CLI:
   ```bash
   fly secrets set DB_PATH=/app/data/jobs.db FETCH_INTERVAL_MINUTES=30 NODE_ENV=production
   ```
5. Run the deployment:
   ```bash
   fly deploy
   ```

---

## 4. Local Verification (Docker Build)

To verify the Docker container compiles and runs locally on your machine before pushing:

1. Build the image:
   ```bash
   docker build -t scraper-service .
   ```
2. Run the container, mapping the host port `3000` to container port `3000`, and mounting a local directory for database persistence:
   ```bash
   docker run -p 3000:3000 -v ./data:/app/data scraper-service
   ```
3. Open `http://localhost:3000/` in your browser to verify operations.

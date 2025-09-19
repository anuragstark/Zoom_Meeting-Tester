# Zoom Meeting Tester

Minimal web app to create Zoom meetings via:
- Server-to-Server OAuth (Account-level)
- Standard OAuth App (Authorization Code)

It auto-generates tokens on the backend and only shows host/join links on the frontend.

## 1) Prerequisites
- Node.js 18+ (recommended: Node 20)
- npm 8+
- Zoom account with:
  - Server-to-Server OAuth app (for S2S flow)
  - OAuth app (Authorization Code) with redirect URL set

## 2) Clone & Install
```bash
cd ~
git clone https://github.com/anuragstark/Zoom_Meeting-Tester.git
cd zoom-meeting-tester
npm install
```

## 3) Configure Environment
Copy the example and fill values (optional: you can also enter creds in the UI):
```bash
cp .env.example .env
```
`.env` keys:
- SESSION_SECRET: any random string
- PORT: default 3000
- ZOOM_S2S_CLIENT_ID, ZOOM_S2S_CLIENT_SECRET, ZOOM_S2S_ACCOUNT_ID
- ZOOM_OAUTH_CLIENT_ID, ZOOM_OAUTH_CLIENT_SECRET, ZOOM_OAUTH_REDIRECT_URI, ZOOM_OAUTH_SCOPE

Note: Redirect URI must match your Zoom OAuth app (default `http://localhost:3000/auth/callback`).

## 4) Run (Local)
```bash
npm run dev
```
Open `http://localhost:3000`.

## 5) Using the App
- S2S tab:
  - Enter Client ID, Client Secret, Account ID or leave blank to use `.env`.
  - Click "Create Meeting (S2S)" to get Host and Join links.
- OAuth tab:
  - Enter Client ID, Client Secret, Redirect URI (or use `.env`).
  - Click "Login with Zoom" to authorize, then "Create Meeting (OAuth)".
- Logs tab:
  - Live logs stream in real-time (SSE). Use Refresh or Clear if needed.

## 6) Docker

### Build and run (production) - Just For Practice
```bash
cd ~/zoom-meeting-tester
docker compose --profile prod up --build -d
```
Open `http://localhost:3000`

### Dev with hot-reload
```bash
cd ~/zoom-meeting-tester
docker compose --profile dev up
```
The dev service mounts your local folder and runs nodemon.

## Troubleshooting
- OAuth login says missing config:
  - Either fill all three fields (Client ID, Secret, Redirect URI) or set them in `.env` and leave fields blank.
- OAuth redirect mismatch:
  - Ensure `ZOOM_OAUTH_REDIRECT_URI` exactly matches your Zoom app settings.
- S2S 401/invalid client:
  - Verify S2S Client ID/Secret and Account ID are from the Server-to-Server OAuth app.
- Corporate firewall/CORS:
  - The app runs on localhost:3000; ensure this is reachable and not blocked.

---

## 🙏 Acknowledgments
- **Docker** - For containerization technology
---

**Made with ❤️ in the  Anurag Stark**

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const cookieSession = require('cookie-session');

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(
  cookieSession({
    name: 'session',
    secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
    httpOnly: true,
    sameSite: 'lax',
  })
);

const PORT = process.env.PORT || 3000;

// In-memory log buffer and SSE subscriptions
const logBuffer = [];
const maxLogs = 500;
const sseClients = new Set();

function addLog(level, args) {
  const entry = {
    level,
    message: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
    time: new Date().toISOString(),
  };
  logBuffer.push(entry);
  if (logBuffer.length > maxLogs) logBuffer.splice(0, logBuffer.length - maxLogs);
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

// Wrap console methods to capture logs
['log', 'info', 'warn', 'error'].forEach(level => {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try { addLog(level, args); } catch (_) {}
    original(...args);
  };
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Basic request logger for API routes
app.use((req, _res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    console.info('HTTP', req.method, req.path);
  }
  next();
});

// Logs REST endpoints
app.get('/api/logs', (req, res) => {
  res.json({ logs: logBuffer });
});

app.post('/api/logs/clear', (req, res) => {
  logBuffer.length = 0;
  res.json({ ok: true });
});

// Logs SSE stream
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send a ping comment to keep connection alive
  res.write(': connected\n\n');

  // Send recent buffer
  for (const entry of logBuffer) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  sseClients.add(res);
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Utility: build Basic auth header
function buildBasicAuthHeader(clientId, clientSecret) {
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return `Basic ${encoded}`;
}


// Server-to-Server OAuth

app.post('/api/s2s/meetings', async (req, res) => {
  try {
    console.info('S2S: create meeting request received');
    const {
      clientId: bodyClientId,
      clientSecret: bodyClientSecret,
      accountId: bodyAccountId,
      topic = 'Test Meeting',
      duration = 30,
      start_time, // optional ISO8601
      timezone,
    } = req.body || {};

    const clientId = bodyClientId || process.env.ZOOM_S2S_CLIENT_ID;
    const clientSecret = bodyClientSecret || process.env.ZOOM_S2S_CLIENT_SECRET;
    const accountId = bodyAccountId || process.env.ZOOM_S2S_ACCOUNT_ID;

    if (!clientId || !clientSecret || !accountId) {
      return res.status(400).json({
        error: 'Missing Zoom S2S credentials (clientId, clientSecret, accountId). Provide in body or environment.',
      });
    }

    // Fetch access token using account credentials grant
    const accountMask = accountId ? `${accountId.substring(0, 4)}***` : 'unknown';
    console.info('S2S: requesting token for account', accountMask);
    const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(
      accountId
    )}`;

    const tokenResp = await axios.post(
      tokenUrl,
      null,
      {
        headers: {
          Authorization: buildBasicAuthHeader(clientId, clientSecret),
        },
      }
    );

    const accessToken = tokenResp.data.access_token;
    console.info('S2S: token acquired');

    // Create meeting
    console.info('S2S: creating meeting', { topic, duration, timezone: timezone || 'default' });
    const createResp = await axios.post(
      'https://api.zoom.us/v2/users/me/meetings',
      {
        topic,
        type: 2, // scheduled meeting
        duration,
        start_time,
        timezone,
        settings: {
          join_before_host: false,
          waiting_room: true,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { start_url, join_url, id, password } = createResp.data;
    console.info('S2S: meeting created', { id, join_url });
    res.json({
      method: 's2s',
      meeting_id: id,
      password,
      host_link: start_url,
      join_link: join_url,
    });
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('S2S: error creating meeting', { status, data: data || err.message });
    res.status(status || 500).json({ error: 'Failed to create meeting via S2S', details: data || err.message });
  }
});

// =========================
// OAuth App (user-level)
// =========================
// Kick off OAuth login. Allows passing config via query (stored in session) or env vars.
app.get('/auth/login', (req, res) => {
  const query = req.query || {};

  const clientId = (query.client_id || process.env.ZOOM_OAUTH_CLIENT_ID || '').toString();
  const clientSecret = (query.client_secret || process.env.ZOOM_OAUTH_CLIENT_SECRET || '').toString();
  const redirectUri = (query.redirect_uri || process.env.ZOOM_OAUTH_REDIRECT_URI || '').toString();
  const scope = (query.scope || process.env.ZOOM_OAUTH_SCOPE || 'meeting:write').toString();

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(400).json({ error: 'Missing OAuth config (client_id, client_secret, redirect_uri).' });
  }

  req.session.oauthConfig = { clientId, clientSecret, redirectUri, scope };

  const authorizeUrl = new URL('https://zoom.us/oauth/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', scope);
  console.info('OAuth: redirecting to authorize', { clientId: `${clientId.substring(0,4)}***`, redirectUri });
  res.redirect(authorizeUrl.toString());
});

// OAuth callback: exchange code for access token and store in session
app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const oauthConfig = req.session.oauthConfig;
    if (!oauthConfig || !code) {
      return res.status(400).send('Missing session config or code');
    }

    const tokenUrl = 'https://zoom.us/oauth/token';
    console.info('OAuth: exchanging code for token');
    const tokenResp = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code.toString(),
        redirect_uri: oauthConfig.redirectUri,
      }),
      {
        headers: {
          Authorization: buildBasicAuthHeader(oauthConfig.clientId, oauthConfig.clientSecret),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    req.session.oauthTokens = tokenResp.data; // contains access_token, refresh_token, expires_in
    console.info('OAuth: token acquired; redirecting back to app');

    // Redirect back to app
    res.redirect('/?oauth=success');
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('OAuth: callback error', { status, data: data || err.message });
    res.status(status || 500).send(`OAuth callback error: ${JSON.stringify(data || err.message)}`);
  }
});

// Create meeting using OAuth session tokens
app.post('/api/oauth/meetings', async (req, res) => {
  try {
    const tokens = req.session.oauthTokens;
    if (!tokens?.access_token) {
      return res.status(401).json({ error: 'Not authenticated. Start with /auth/login' });
    }

    const { topic = 'Test Meeting', duration = 30, start_time, timezone } = req.body || {};
    console.info('OAuth: creating meeting', { topic, duration, timezone: timezone || 'default' });
    const createResp = await axios.post(
      'https://api.zoom.us/v2/users/me/meetings',
      {
        topic,
        type: 2,
        duration,
        start_time,
        timezone,
        settings: { join_before_host: false, waiting_room: true },
      },
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    const { start_url, join_url, id, password } = createResp.data;
    console.info('OAuth: meeting created', { id, join_url });
    res.json({ method: 'oauth', meeting_id: id, password, host_link: start_url, join_link: join_url });
  } catch (err) {
    const status = err.response?.status;
    const data = err.response?.data;
    console.error('OAuth: error creating meeting', { status, data: data || err.message });
    res.status(status || 500).json({ error: 'Failed to create meeting via OAuth', details: data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


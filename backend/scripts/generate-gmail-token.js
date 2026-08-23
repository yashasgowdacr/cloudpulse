/**
 * Local-only OAuth 2.0 Refresh Token Generator for Gmail API
 * Scope: https://www.googleapis.com/auth/gmail.send
 * Redirect URI: http://localhost:3000/oauth2callback
 * 
 * Usage:
 *   1. Fill GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env
 *   2. Run: node scripts/generate-gmail-token.js
 *   3. Click or open the generated authorization link in your browser.
 *   4. Log in with cloudpulse.project@gmail.com and approve access.
 *   5. Copy the generated refresh_token into GOOGLE_REFRESH_TOKEN in your environment.
 */

const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["'\s]/g, '');
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["'\s]/g, '');
const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback';
const PORT = 3000;

if (!clientId || !clientSecret) {
  console.error('❌ ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in backend/.env');
  console.log('Please configure your credentials in backend/.env and re-run this script.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send']
});

console.log('================================================================');
console.log('🔑 CLOUDPULSE GMAIL API OAUTH 2.0 TOKEN GENERATOR');
console.log('================================================================');
console.log('Please open the following authorization URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for OAuth callback at http://localhost:3000/oauth2callback ...\n');

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname === '/oauth2callback') {
      const code = reqUrl.query.code;

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization Code Missing</h1>');
        return;
      }

      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <div style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h1 style="color: #16a34a;">✅ Gmail API Authorization Successful!</h1>
          <p>You can close this browser tab and check your terminal window for your Refresh Token.</p>
        </div>
      `);

      console.log('================================================================');
      console.log('🎉 OAUTH AUTHORIZATION SUCCESSFUL!');
      console.log('================================================================');
      if (tokens.refresh_token) {
        console.log('Your GOOGLE_REFRESH_TOKEN is:\n');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        console.log('Copy the value above and add it to your Render Environment and local .env!');
      } else {
        console.log('⚠️ WARNING: No refresh token returned. (If you previously authorized this app, revoke access at https://myaccount.google.com/permissions and re-run with prompt=consent).');
        if (tokens.access_token) {
          console.log('Access Token:', tokens.access_token);
        }
      }
      console.log('================================================================\n');

      server.close();
      process.exit(0);
    }
  } catch (err) {
    console.error('❌ Error exchanging authorization code for tokens:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Token Exchange Failed</h1><p>${err.message}</p>`);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Local OAuth listener running on port ${PORT}...`);
});

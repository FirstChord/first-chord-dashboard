#!/usr/bin/env node
/**
 * Mint a Drive `drive.file` refresh token for First Chord newsletter media.
 *
 * Run locally (it needs an interactive Google sign-in as the owning account):
 *
 *   node scripts/mint-drive-token.mjs
 *
 * It will ask for the OAuth client ID + secret (use a "Desktop app" client in the
 * same Google Cloud project as the Internal consent screen), print a consent URL,
 * and — after you approve as musiclessons@firstchord.co.uk — print the
 * DRIVE_REFRESH_TOKEN to paste into Railway.
 *
 * `drive.file` is deliberately the narrowest useful scope: it grants access ONLY
 * to files this application itself creates. The resulting token cannot read the
 * rest of First Chord's Drive, which is why this must not reuse the Sheets or
 * Gmail credential even though both already exist.
 *
 * Uploaded media lands in "First Chord Newsletter / <YYYY-MM>" in the My Drive of
 * whichever account approves here. Share that folder with Fenella afterwards.
 *
 * Nothing is written to disk and no existing env vars are read or changed.
 */
import http from 'node:http';
import readline from 'node:readline';
import { URL } from 'node:url';
import { google } from 'googleapis';

const PORT = 4568;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

function ask(question, { mask = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (mask) {
      // Hide the secret as it is typed.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(char.toString())) {
          process.stdin.removeListener('data', onData);
        } else {
          process.stdout.write('[2K[200D' + question + '*'.repeat(rl.line.length));
        }
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\nFirst Chord — Drive refresh-token minter (newsletter media)\n');
  console.log('Use the OAuth client from the SAME project as your Internal consent screen.');
  console.log('A "Desktop app" client is recommended (no redirect-URI setup needed).\n');

  const clientId = process.env.DRIVE_OAUTH_CLIENT_ID || await ask('OAuth client ID: ');
  const clientSecret = process.env.DRIVE_OAUTH_CLIENT_SECRET || await ask('OAuth client secret: ', { mask: true });

  if (!clientId || !clientSecret) {
    console.error('\nBoth client ID and client secret are required.');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even if previously approved
    scope: [SCOPE],
  });

  console.log('\n1. Open this URL in a browser:\n');
  console.log(`   ${authUrl}\n`);
  console.log('2. Sign in as the OWNING account (musiclessons@firstchord.co.uk) and approve.\n');
  console.log('   The newsletter folder will be created in THAT account\u2019s My Drive.\n');
  console.log(`   (Waiting for the redirect to ${REDIRECT_URI} …)\n`);

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/oauth2callback')) {
      res.writeHead(404).end();
      return;
    }
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<p>Authorization failed: ${error}. You can close this tab.</p>`);
      console.error(`\nAuthorization failed: ${error}`);
      server.close();
      process.exit(1);
    }

    try {
      const { tokens } = await oauth2.getToken(code);
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>Done. You can close this tab and return to the terminal.</p>');
      server.close();

      if (!tokens.refresh_token) {
        console.error('\nNo refresh token was returned. Remove the app under the account\'s "Third-party access" and run again (the script forces prompt=consent, so this is rare).');
        process.exit(1);
      }

      console.log('\n✅ Success. Set this in Railway as DRIVE_REFRESH_TOKEN:\n');
      console.log(`   ${tokens.refresh_token}\n`);
      console.log('Also set DRIVE_CLIENT_ID and DRIVE_CLIENT_SECRET to the client you used here,');
      console.log('so the running app redeems the token with the same client.\n');
      console.log('Set all three on the CANONICAL admin service only. Newsletter media upload');
      console.log('also requires TUTOR_DASHBOARD_AUTH_MODE=required; without it the upload route');
      console.log('refuses every request, which is the intended fail-closed behaviour.\n');
      process.exit(0);
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>Token exchange failed. Check the terminal.</p>');
      console.error('\nToken exchange failed:', err.message || err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * One-time setup: authorizes this app against YOUR Google Drive
 * account and writes the resulting refresh token to .env.local.
 *
 * Before running this, in https://console.cloud.google.com/:
 *   1. Create (or pick) a project, then enable the "Google Drive API"
 *      under APIs & Services > Library.
 *   2. Under APIs & Services > OAuth consent screen: choose "External",
 *      fill in the required fields, and add your own Google account's
 *      email under "Test users" (this keeps the app in unverified
 *      "Testing" mode, which is fine for personal use — no Google
 *      review needed).
 *   3. Under APIs & Services > Credentials > Create Credentials >
 *      OAuth client ID: Application type "Web application", and add
 *      http://localhost:53682/oauth2callback as an authorized
 *      redirect URI.
 *   4. Copy the Client ID and Client Secret it gives you into
 *      .env.local as GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET
 *      (or export them in your shell before running this script).
 *
 * Then run:  node scripts/drive-auth.mjs
 *
 * It opens a local server, prints a consent URL for you to visit,
 * and once you approve it, writes GOOGLE_DRIVE_REFRESH_TOKEN and
 * STORAGE_BACKEND=drive into .env.local for you.
 */
import http from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { URL } from "node:url";
import { google } from "googleapis";

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const ENV_FILE = ".env.local";

function loadEnvLocal() {
  if (!existsSync(ENV_FILE)) return {};
  const vars = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function upsertEnvLocal(updates) {
  const existingLines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const seen = new Set();
  const nextLines = existingLines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
      seen.add(match[1]);
      return `${match[1]}=${updates[match[1]]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) nextLines.push(`${key}=${value}`);
  }
  writeFileSync(ENV_FILE, nextLines.join("\n").replace(/\n+$/, "\n"));
}

const envLocal = loadEnvLocal();
const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || envLocal.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET || envLocal.GOOGLE_DRIVE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET.\n" +
      "Set them in .env.local (or export them in your shell) first — see the setup steps at the top of this script."
  );
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  // Forces Google to hand back a refresh_token even if this account
  // already granted access before — without it, a re-run can silently
  // return no refresh_token at all.
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

console.log("\nOpen this URL and sign in with the Google account whose Drive you want to use:\n");
console.log(authUrl);
console.log(`\nWaiting for the consent screen to complete (listening on ${REDIRECT_URI})...\n`);

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, REDIRECT_URI);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing authorization code.");
    return;
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body><h2>Done — you can close this tab and go back to the terminal.</h2></body></html>");
    server.close();

    if (!tokens.refresh_token) {
      console.error(
        "\nGoogle didn't return a refresh token. This usually means this account already authorized the app " +
          "before. Revoke access at https://myaccount.google.com/permissions and run this script again."
      );
      process.exit(1);
    }

    upsertEnvLocal({
      GOOGLE_DRIVE_CLIENT_ID: clientId,
      GOOGLE_DRIVE_CLIENT_SECRET: clientSecret,
      GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
      STORAGE_BACKEND: "drive",
    });
    console.log(`\nSuccess — wrote GOOGLE_DRIVE_REFRESH_TOKEN and STORAGE_BACKEND=drive to ${ENV_FILE}.`);
    console.log("Restart the dev server for the change to take effect.\n");
    process.exit(0);
  } catch (err) {
    console.error("\nFailed to exchange the authorization code:", err.message);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Something went wrong — check the terminal.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);

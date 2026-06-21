import { IS_PRODUCTION, SSL_CERT_PATH, SSL_KEY_PATH } from "../config.js";
import https from "node:https";
import fs from "node:fs";

export function listen(app) {
  if (!IS_PRODUCTION) {
    // Simple case; no HTTPS, the default Express port of 3000
    app.listen(3000, () => {
      console.log(`Listening on port 3000`);
    });
    return;
  }

  // If we get here, we're in prod, and need to serve over HTTPS.
  // Code for this based on:
  // * https://stackoverflow.com/a/11805909/1709587
  // * https://stackoverflow.com/a/74076392/1709587
  const server = https.createServer(readCertsSync(), app).listen(443, () => {
    console.log("Listening on port 443");
  });

  // Re-read certs every 24 hours. Should be ample to catch renewals before old cert expires.
  setInterval(
    () => {
      server.setSecureContext(readCertsSync());
    },
    1000 * 60 * 60 * 24,
  );
}

function readCertsSync() {
  return {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  };
}

import { env } from "process";

export const PRODUCTION_DOMAIN = "sourcevsnpm.com";
export const IS_PRODUCTION = !!env.PRODUCTION;

// Only used in prod
export const SSL_KEY_PATH = "/etc/letsencrypt/live/sourcevsnpm.com/privkey.pem";
export const SSL_CERT_PATH =
  "/etc/letsencrypt/live/sourcevsnpm.com/fullchain.pem";

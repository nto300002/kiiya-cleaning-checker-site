declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_ENV?: string;
    APP_ORIGIN?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    APP_ADMIN_USER_ID?: string;
    APP_ADMIN_LEAD_NAME?: string;
    APP_STAFF_USER_IDS?: string;
  }
}

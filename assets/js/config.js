// Site configuration. Values here are public (they ship to every visitor); never put secrets in this file.

// Google OAuth "Web application" client ID used for "Sign in with Google".
// Create it in Google Cloud Console and add https://mrasoul10-sudo.github.io as an authorized JavaScript origin
// (see docs/DEPLOYMENT.md). Leave empty to hide the Google button.
export const GOOGLE_CLIENT_ID = '737310583952-dn13t7a3tpp9of4dsn5ug7ed7mah9bsk.apps.googleusercontent.com';

// Base URL of the free prompt service (worker/, a Cloudflare Worker holding the Gemini key), e.g.
// 'https://promptcreator-api.<your-subdomain>.workers.dev'. Leave empty to require the user's own Claude key.
export const FREE_API_URL = '';

// Where the app's pages find the Apps Script backend (the "Health check" web app deployment,
// updated in place with `clasp update-deployment` so this URL never changes).
const SMART_SCAN_API_URL = 'https://script.google.com/macros/s/AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ/exec';

// The store's name: on every page's header and at the top of the Theft Report.
const STORE_NAME = 'Route 66 Liquor';

// Which backend the pages use: 'sheets' (the Apps Script above) until the database move's cutover (Dec 1, 2026), then
// 'supabase'. Switching back to 'sheets' is the rollback.
const BACKEND = 'sheets';
// The production Supabase project (smart-scan-prod) and its public (anon) key, filled in 2026-11-10 for the side-by-side
// week (a phone switched with More → Try the Database uses them; see api.js). The key only lets
// the app call the API; every database function checks who is signed in and what they may do.
// Self sign-up (many stores, after the cutover): Create Account on Sign In, and a signed-in account without a store
// goes to the setup wizard (setup.html). Off until Supabase Auth's public sign-up is turned on with our own email
// domain; while off, nothing about signing in changes.
const SIGN_UP_OPEN = false;
const SUPABASE_URL = 'https://ulxiphcgningbjgrvdui.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVseGlwaGNnbmluZ2JqZ3J2ZHVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNjYzOTAsImV4cCI6MjEwOTk0MjM5MH0.8mKZH-wFeQqTZgjn64iOQyRY4y-osKYlLyALa1gAwCA';

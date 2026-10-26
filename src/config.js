// Where the app's pages find the Apps Script backend (the "Health check" web app deployment,
// updated in place with `clasp update-deployment` so this URL never changes).
const SMART_SCAN_API_URL = 'https://script.google.com/macros/s/AKfycbynoVRwuSj_n5VLMy4R3ZtfaPY4PMIzV0yrjCW-UU8hSlpfBmXhKu4Dy-SzcQ9pXtGJ/exec';

// The store's name: on every page's header and at the top of the Theft Report.
const STORE_NAME = 'Route 66 Liquor';

// Which backend the pages use: 'sheets' (the Apps Script above) until the database move's cutover (Dec 1, 2026), then
// 'supabase'. Switching back to 'sheets' is the rollback.
const BACKEND = 'sheets';
// The Supabase project and its public (anon) key, filled in at cutover with the production project's. The key only lets
// the app call the API; every database function checks who is signed in and what they may do.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

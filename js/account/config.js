// Supabase project connection.
//
// The publishable (anon) key is designed to live in front-end code — Supabase's
// own dashboard says "Publishable keys can be safely shared publicly." It only
// grants the anonymous role, and real data access is still gated by Row Level
// Security on the server. The *secret* key (sb_secret_… / service_role) must
// NEVER appear here or anywhere in the client.
//
// Leave both strings empty to run without a backend: the app falls back to the
// on-device account system in account/store.js, which is also what the offline
// verification harness uses.
export const SUPABASE_URL = 'https://xppjoqkasnuzbyvwuucu.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Hhq2KEHIlmo1VBmz938_Ug_4F_o2qSS';

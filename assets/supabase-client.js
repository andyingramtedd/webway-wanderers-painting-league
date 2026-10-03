// Fill these in with your Supabase project's values (Project Settings > API).
// The anon/public key is safe to expose in client-side code — it only grants
// the access allowed by the Row Level Security policies in sql/schema.sql.
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

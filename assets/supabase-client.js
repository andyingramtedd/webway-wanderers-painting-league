// Fill these in with your Supabase project's values (Project Settings > API).
// The anon/public key is safe to expose in client-side code — it only grants
// the access allowed by the Row Level Security policies in sql/schema.sql.
const SUPABASE_URL = 'https://sovanxwunavuijymphir.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DUKmEY-p_-ugH81dfqoq6A_aKqCx9C9';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

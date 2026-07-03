const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error('SUPABASE_URL is not set');

// Use service role if available, otherwise anon key (for dev/Bolt environments)
const adminKey = supabaseServiceKey || supabaseAnonKey;

const supabaseAdmin = createClient(supabaseUrl, adminKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Returns a client scoped to the user's Supabase JWT so RLS applies correctly
function getUserClient(supabaseToken) {
  if (!supabaseToken) return supabaseAdmin;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${supabaseToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

module.exports = { supabaseAdmin, getUserClient };

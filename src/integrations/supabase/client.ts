import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { getSupabaseConfig } from './config';

const { url, anonKey } = getSupabaseConfig(import.meta.env);

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(url, anonKey);

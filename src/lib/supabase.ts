import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && key && !url.includes("your-project"));
export const supabase = isSupabaseConfigured ? createClient<Database>(url!, key!) : null;

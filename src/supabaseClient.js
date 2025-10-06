// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

// Prefer environment variables for security, fallback to your project defaults
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://jpjtdwvluxtvqidrhiqa.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpwanRkd3ZsdXh0dnFpZHJoaXFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2MzQzOTgsImV4cCI6MjA3NTIxMDM5OH0.shgFZLK1LmxvwyvYsHq7cl9275-hSP3bs-hBBfnjSVQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

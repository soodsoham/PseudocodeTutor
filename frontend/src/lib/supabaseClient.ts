import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const supabaseUrl =
  rawUrl && rawUrl !== 'placeholder'
    ? rawUrl
    : 'https://placeholder.supabase.co'
const supabaseAnonKey = rawAnonKey && rawAnonKey !== 'placeholder'
  ? rawAnonKey
  : 'placeholder-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL

if (!authUrl || !dataApiUrl) {
  console.warn(
    'Neon is not configured. Set VITE_NEON_AUTH_URL and VITE_NEON_DATA_API_URL.',
  )
}

// Keep the existing Supabase-shaped API while using Neon Auth and the Neon Data API.
// allowAnonymous gives signed-out visitors a restricted token governed by Postgres RLS.
export const supabase = createClient({
  auth: {
    adapter: SupabaseAuthAdapter(),
    url: authUrl || 'https://auth.invalid',
    allowAnonymous: true,
  },
  dataApi: {
    url: dataApiUrl || 'https://data.invalid/rest/v1',
  },
})

type PasswordActionResult = {
  error?: { message?: string } | null
}

type BetterAuthPasswordClient = {
  resetPassword: (input: {
    newPassword: string
    token: string
  }) => Promise<PasswordActionResult>
  changePassword: (input: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }) => Promise<PasswordActionResult>
}

const passwordClient = () =>
  supabase.auth.getBetterAuthInstance() as unknown as BetterAuthPasswordClient

export const resetPasswordWithToken = (token: string, newPassword: string) =>
  passwordClient().resetPassword({ token, newPassword })

export const changePassword = (currentPassword: string, newPassword: string) =>
  passwordClient().changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  })

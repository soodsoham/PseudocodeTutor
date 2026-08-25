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

type BetterAuthClient = {
  resetPassword: (input: {
    newPassword: string
    token: string
  }) => Promise<PasswordActionResult>
  changePassword: (input: {
    currentPassword: string
    newPassword: string
    revokeOtherSessions?: boolean
  }) => Promise<PasswordActionResult>
  getToken: () => Promise<{
    data?: { token?: string } | null
    error?: { message?: string } | null
  }>
}

const betterAuthClient = () =>
  supabase.auth.getBetterAuthInstance() as unknown as BetterAuthClient

export const resetPasswordWithToken = (token: string, newPassword: string) =>
  betterAuthClient().resetPassword({ token, newPassword })

export const changePassword = (currentPassword: string, newPassword: string) =>
  betterAuthClient().changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  })

// Better Auth session tokens are opaque and cannot be verified with JWKS.
// Protected Pages Functions require the signed JWT returned by the JWT plugin.
export const getAuthJwt = async () => {
  try {
    const result = await betterAuthClient().getToken()
    return {
      token: result.data?.token ?? null,
      error: result.error ?? null,
    }
  } catch (error) {
    return {
      token: null,
      error: {
        message: error instanceof Error ? error.message : 'JWT exchange failed.',
      },
    }
  }
}

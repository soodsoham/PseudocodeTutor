import axios from 'axios'
import { getAuthJwt, supabase } from '../lib/supabaseClient'

export const fastapi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
})

fastapi.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const session = data.session as
    | ({ access_token?: string; token?: string } & Record<string, unknown>)
    | null
  if (session) {
    const opaqueSessionToken = session.access_token || session.token
    const jwtResult = await getAuthJwt()
    const token = jwtResult.token || opaqueSessionToken
    if (!token) {
      throw new Error(jwtResult.error?.message || 'Could not obtain an authentication token.')
    }
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

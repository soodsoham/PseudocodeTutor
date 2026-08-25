export interface AuthUser {
  id: string
  email?: string
  name?: string
}

export interface AuthSession {
  user: AuthUser
  access_token?: string
  token?: string
}

const SESSION_KEY = 'pseudocode_tutor_session'

export function saveSession(data: unknown) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(data))
}

export function loadSession() {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(SESSION_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export function getCookie(name: string) {
  if (typeof document === 'undefined') {
    return null
  }

  const target = `${encodeURIComponent(name)}=`
  const match = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(target))

  return match ? decodeURIComponent(match.slice(target.length)) : null
}

export function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`
}

export function deleteCookie(name: string) {
  if (typeof document === 'undefined') {
    return
  }

  document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; samesite=lax`
}

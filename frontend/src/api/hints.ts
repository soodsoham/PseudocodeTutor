import { fastapi } from './fastapi'

export async function getHint<TPayload>(payload: TPayload) {
  const response = await fastapi.post('/hints', payload)
  return response.data
}

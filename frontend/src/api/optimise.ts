import { fastapi } from './fastapi'

export async function optimiseCode<TPayload>(payload: TPayload) {
  const response = await fastapi.post('/optimise', payload)
  return response.data
}

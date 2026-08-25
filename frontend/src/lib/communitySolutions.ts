const COMMUNITY_SOLUTIONS_STORAGE_KEY = 'pseudo_wizard_community_solutions'

export interface LocalCommunitySolution {
  id: string
  problemId: string
  pseudocode: string
  authorId: string | null
  createdAt: string
}

export function loadLocalCommunitySolutions(): LocalCommunitySolution[] {
  try {
    const raw = window.localStorage.getItem(COMMUNITY_SOLUTIONS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item) => {
      return (
        item &&
        typeof item.id === 'string' &&
        typeof item.problemId === 'string' &&
        typeof item.pseudocode === 'string' &&
        (typeof item.authorId === 'string' || item.authorId === null) &&
        typeof item.createdAt === 'string'
      )
    }) as LocalCommunitySolution[]
  } catch {
    return []
  }
}

export function saveLocalCommunitySolution(input: {
  problemId: number | string
  pseudocode: string
  authorId: string | null
}) {
  const current = loadLocalCommunitySolutions()
  const nextItem: LocalCommunitySolution = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    problemId: String(input.problemId),
    pseudocode: input.pseudocode,
    authorId: input.authorId,
    createdAt: new Date().toISOString(),
  }
  window.localStorage.setItem(
    COMMUNITY_SOLUTIONS_STORAGE_KEY,
    JSON.stringify([nextItem, ...current]),
  )
  return nextItem
}

export function updateLocalCommunitySolution(
  solutionId: string,
  pseudocode: string,
) {
  const current = loadLocalCommunitySolutions()
  const next = current.map((item) =>
    item.id === solutionId
      ? {
          ...item,
          pseudocode,
          createdAt: new Date().toISOString(),
        }
      : item,
  )
  window.localStorage.setItem(COMMUNITY_SOLUTIONS_STORAGE_KEY, JSON.stringify(next))
}

export function deleteLocalCommunitySolution(solutionId: string) {
  const current = loadLocalCommunitySolutions()
  const next = current.filter((item) => item.id !== solutionId)
  window.localStorage.setItem(COMMUNITY_SOLUTIONS_STORAGE_KEY, JSON.stringify(next))
}

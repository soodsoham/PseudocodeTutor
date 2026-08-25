import { supabase } from '../api/supabase'
import { fastapi } from '../api/fastapi'
import type { AuthUser as User } from '../types/auth'

export const PROJECTS_STORAGE_KEY = 'pseudo_wizard_projects'

export interface ProjectDraft {
  name: string
  problem: string
  pseudocode: string
  language: string
  board: string
}

export interface ProjectItem extends ProjectDraft {
  id: number | string
  savedAt: string
}

type SaveProjectInput = {
  draft: ProjectDraft
  user: User | null
}

type UpdateProjectInput = SaveProjectInput & {
  projectId: number | string
}

type DeleteProjectInput = {
  projectId: number | string
  user: User | null
}

const isMissingColumnError = (message: string, column: string) => {
  const normalized = message.toLowerCase()
  return (
    normalized.includes(`could not find the '${column.toLowerCase()}' column`) ||
    normalized.includes(`column "${column.toLowerCase()}" does not exist`)
  )
}

const isRlsPolicyError = (message: string) =>
  message.toLowerCase().includes('row-level security policy')

const extractMissingColumn = (message: string) => {
  const quoted = message.match(/could not find the '([^']+)' column/i)
  if (quoted?.[1]) {
    return quoted[1]
  }
  const sqlStyle = message.match(/column "([^"]+)" does not exist/i)
  if (sqlStyle?.[1]) {
    return sqlStyle[1]
  }
  return null
}

const projectInsertVariants = (draft: ProjectDraft, userId: string) => [
  {
    name: draft.name,
    problem: draft.problem,
    pseudocode: draft.pseudocode,
    language: draft.language,
    board: draft.board,
    user_id: userId,
  },
  {
    title: draft.name,
    description: draft.problem,
    code: draft.pseudocode,
    language: draft.language,
    board: draft.board,
    user_id: userId,
  },
  {
    project_name: draft.name,
    problem_text: draft.problem,
    code: draft.pseudocode,
    lang: draft.language,
    exam_board: draft.board,
    user_id: userId,
  },
  {
    title: draft.name,
    prompt: draft.problem,
    solution: draft.pseudocode,
    language: draft.language,
    board: draft.board,
    created_by: userId,
  },
]

const projectUpdateVariants = (draft: ProjectDraft) => [
  {
    name: draft.name,
    problem: draft.problem,
    pseudocode: draft.pseudocode,
    language: draft.language,
    board: draft.board,
  },
  {
    title: draft.name,
    description: draft.problem,
    code: draft.pseudocode,
    language: draft.language,
    board: draft.board,
  },
  {
    project_name: draft.name,
    problem_text: draft.problem,
    code: draft.pseudocode,
    lang: draft.language,
    exam_board: draft.board,
  },
  {
    title: draft.name,
    prompt: draft.problem,
    solution: draft.pseudocode,
    language: draft.language,
    board: draft.board,
  },
]

const pickString = (
  row: Record<string, unknown>,
  keys: string[],
  fallback: string,
) => {
  for (const key of keys) {
    if (typeof row[key] === 'string' && row[key]!.toString().length > 0) {
      return row[key] as string
    }
  }
  return fallback
}

function getUserIdFromStore(user: User | null) {
  if (!user || typeof user.id !== 'string') {
    return null
  }
  return user.id
}

export function loadGuestProjects(): ProjectItem[] {
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed as ProjectItem[]
  } catch {
    return []
  }
}

function saveGuestProjects(projects: ProjectItem[]) {
  window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects))
}

export function saveGuestProject(draft: ProjectDraft) {
  const current = loadGuestProjects()
  const next: ProjectItem = {
    id: Date.now(),
    ...draft,
    savedAt: new Date().toISOString(),
  }
  saveGuestProjects([next, ...current])
  return next
}

function upsertGuestProjectById(projectId: number | string, draft: ProjectDraft) {
  const current = loadGuestProjects()
  let matched = false
  const next = current.map((project) => {
    if (String(project.id) !== String(projectId)) {
      return project
    }
    matched = true
    return {
      ...project,
      ...draft,
      savedAt: new Date().toISOString(),
    }
  })

  if (!matched) {
    next.unshift({
      id: projectId,
      ...draft,
      savedAt: new Date().toISOString(),
    })
  }

  saveGuestProjects(next)
}

function deleteGuestProjectById(projectId: number | string) {
  const current = loadGuestProjects()
  const next = current.filter((project) => String(project.id) !== String(projectId))
  saveGuestProjects(next)
}

export async function saveProject({ draft, user }: SaveProjectInput) {
  if (!user) {
    const project = saveGuestProject(draft)
    return { ok: true as const, source: 'local' as const, projectId: project.id }
  }

  const sessionResult = await supabase.auth.getSession()
  const sessionUserId = sessionResult.data.session?.user?.id ?? null
  const userId = sessionUserId ?? getUserIdFromStore(user)

  if (!userId) {
    return {
      ok: false as const,
      source: 'supabase' as const,
      error: 'No logged-in user found.',
    }
  }

  let backendError: string | null = null

  // Primary path: backend service route (bypasses client-side RLS constraints)
  try {
    const response = await fastapi.post<{
      ok?: boolean
      project_id?: string | number
      error?: string
    }>('/projects', {
      user_id: userId,
      title: draft.name,
      problem: draft.problem,
      pseudocode: draft.pseudocode,
      board: draft.board,
      language: draft.language,
    })

    if (response.data.ok === true) {
      const projectId = response.data.project_id
      return {
        ok: true as const,
        source: 'supabase' as const,
        projectId:
          typeof projectId === 'string' || typeof projectId === 'number'
            ? projectId
            : Date.now(),
      }
    }
    backendError = typeof response.data.error === 'string' ? response.data.error : null
  } catch {
    backendError = 'Backend not reachable'
  }

  let data: Record<string, unknown> | null = null
  let lastErrorMessage: string | null = null

  for (const variant of projectInsertVariants(draft, userId)) {
    const payload: Record<string, unknown> = { ...variant }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await supabase
        .from('projects')
        .insert(payload)
        .select('*')
        .single()

      if (!result.error) {
        data = (result.data as Record<string, unknown> | null) ?? null
        lastErrorMessage = null
        break
      }

      lastErrorMessage = result.error.message
      const missingColumn = extractMissingColumn(lastErrorMessage)
      if (missingColumn && missingColumn in payload) {
        delete payload[missingColumn]
        continue
      }
      break
    }

    if (data) {
      break
    }
  }

  if (lastErrorMessage) {
    if (isRlsPolicyError(lastErrorMessage) || (backendError && isRlsPolicyError(backendError))) {
      const localProject = saveGuestProject(draft)
      return { ok: true as const, source: 'local' as const, projectId: localProject.id }
    }
    return { ok: false as const, source: 'supabase' as const, error: lastErrorMessage }
  }

  return {
    ok: true as const,
    source: 'supabase' as const,
    projectId:
      typeof data?.id === 'string' || typeof data?.id === 'number'
        ? data.id
        : typeof data?.project_id === 'string' || typeof data?.project_id === 'number'
          ? data.project_id
        : Date.now(),
  }
}

export async function updateProject({
  draft,
  projectId,
  user,
}: UpdateProjectInput) {
  if (!user) {
    const current = loadGuestProjects()
    const next = current.map((project) =>
      String(project.id) === String(projectId)
        ? {
            ...project,
            ...draft,
            savedAt: new Date().toISOString(),
          }
        : project,
    )
    saveGuestProjects(next)
    return { ok: true as const, source: 'local' as const, projectId }
  }

  const sessionResult = await supabase.auth.getSession()
  const sessionUserId = sessionResult.data.session?.user?.id ?? null
  const userId = sessionUserId ?? getUserIdFromStore(user)

  if (!userId) {
    return {
      ok: false as const,
      source: 'supabase' as const,
      error: 'No logged-in user found.',
    }
  }

  let backendError: string | null = null

  // Primary path: backend service route (bypasses client-side RLS constraints)
  try {
    const response = await fastapi.put<{
      ok?: boolean
      error?: string
    }>(`/projects/${encodeURIComponent(String(projectId))}`, {
      project_id: String(projectId),
      user_id: userId,
      title: draft.name,
      problem: draft.problem,
      pseudocode: draft.pseudocode,
      board: draft.board,
      language: draft.language,
    })

    if (response.data.ok === true) {
      return { ok: true as const, source: 'supabase' as const, projectId }
    }
    backendError = typeof response.data.error === 'string' ? response.data.error : null
  } catch {
    backendError = 'Backend not reachable'
  }

  let lastErrorMessage: string | null = null

  const ownerColumns = ['user_id', 'created_by', 'owner_id', null] as const
  const idColumns = ['id', 'project_id'] as const

  for (const variant of projectUpdateVariants(draft)) {
    for (const idColumn of idColumns) {
      for (const ownerColumn of ownerColumns) {
        const payload: Record<string, unknown> = { ...variant }

        for (let attempt = 0; attempt < 12; attempt += 1) {
          let query = supabase
            .from('projects')
            .update(payload)
            .eq(idColumn, projectId)

          if (ownerColumn !== null) {
            query = query.eq(ownerColumn, userId)
          }

          const result = await query

          if (!result.error) {
            lastErrorMessage = null
            return { ok: true as const, source: 'supabase' as const, projectId }
          }

          lastErrorMessage = result.error.message
          const missingColumn = extractMissingColumn(lastErrorMessage)

          if (missingColumn && missingColumn in payload) {
            delete payload[missingColumn]
            continue
          }

          if (missingColumn && ownerColumn !== null && missingColumn === ownerColumn) {
            break
          }
          if (missingColumn && missingColumn === idColumn) {
            break
          }

          break
        }
      }
    }
  }

  if (lastErrorMessage) {
    if (isRlsPolicyError(lastErrorMessage) || (backendError && isRlsPolicyError(backendError))) {
      upsertGuestProjectById(projectId, draft)
      return { ok: true as const, source: 'local' as const, projectId }
    }
    return { ok: false as const, source: 'supabase' as const, error: lastErrorMessage }
  }

  return { ok: true as const, source: 'supabase' as const, projectId }
}

export async function deleteProject({ projectId, user }: DeleteProjectInput) {
  if (!user) {
    deleteGuestProjectById(projectId)
    return { ok: true as const, source: 'local' as const }
  }

  const sessionResult = await supabase.auth.getSession()
  const sessionUserId = sessionResult.data.session?.user?.id ?? null
  const userId = sessionUserId ?? getUserIdFromStore(user)

  if (!userId) {
    return {
      ok: false as const,
      source: 'supabase' as const,
      error: 'No logged-in user found.',
    }
  }

  let backendError: string | null = null

  try {
    const response = await fastapi.delete<{ ok?: boolean; error?: string }>(
      `/projects/${encodeURIComponent(String(projectId))}`,
      { params: { user_id: userId } },
    )

    if (response.data.ok === true) {
      deleteGuestProjectById(projectId)
      return { ok: true as const, source: 'supabase' as const }
    }

    backendError = typeof response.data.error === 'string' ? response.data.error : null
  } catch {
    backendError = 'Backend not reachable'
  }

  const ownerColumns = ['user_id', 'created_by', 'owner_id', null] as const
  const idColumns = ['id', 'project_id'] as const
  let lastErrorMessage: string | null = null

  for (const idColumn of idColumns) {
    for (const ownerColumn of ownerColumns) {
      let query = supabase.from('projects').delete().eq(idColumn, projectId)
      if (ownerColumn !== null) {
        query = query.eq(ownerColumn, userId)
      }
      const result = await query
      if (!result.error) {
        deleteGuestProjectById(projectId)
        return { ok: true as const, source: 'supabase' as const }
      }

      lastErrorMessage = result.error.message
      const missingColumn = extractMissingColumn(lastErrorMessage)
      if (missingColumn && missingColumn === idColumn) {
        break
      }
      if (missingColumn && ownerColumn !== null && missingColumn === ownerColumn) {
        continue
      }
      if (isRlsPolicyError(lastErrorMessage)) {
        deleteGuestProjectById(projectId)
        return { ok: true as const, source: 'local' as const }
      }
    }
  }

  if (backendError && isRlsPolicyError(backendError)) {
    deleteGuestProjectById(projectId)
    return { ok: true as const, source: 'local' as const }
  }

  return {
    ok: false as const,
    source: 'supabase' as const,
    error: lastErrorMessage ?? backendError ?? 'Could not delete project.',
  }
}

export async function loadProjects(user: User | null) {
  if (!user) {
    return loadGuestProjects()
  }

  const sessionResult = await supabase.auth.getSession()
  const sessionUserId = sessionResult.data.session?.user?.id ?? null
  const userId = sessionUserId ?? getUserIdFromStore(user)

  if (!userId) {
    return []
  }

  const localProjects = loadGuestProjects()

  // Primary path: backend service route (bypasses client-side RLS constraints)
  try {
    const response = await fastapi.get<{
      projects?: Array<Record<string, unknown>>
      error?: string
    }>('/projects', { params: { user_id: userId } })

    if (Array.isArray(response.data.projects)) {
      const remoteProjects = response.data.projects
        .map((project, index) => ({
          id:
            typeof project.id === 'number' || typeof project.id === 'string'
              ? project.id
              : `${Date.now()}-${index}`,
          name: pickString(project, ['title', 'name', 'project_name', 'project'], 'Untitled'),
          problem: pickString(project, ['problem', 'description', 'problem_text', 'prompt'], ''),
          pseudocode: pickString(project, ['pseudocode', 'code', 'solution', 'answer'], ''),
          language: pickString(project, ['language', 'lang'], 'python'),
          board: pickString(project, ['board', 'exam_board'], 'cie-igcse'),
          savedAt: pickString(project, ['updated_at', 'created_at', 'saved_at'], new Date().toISOString()),
        }))
      const merged = [...remoteProjects, ...localProjects]
      const seen = new Set<string>()
      const deduped = merged.filter((project) => {
        const key = `${String(project.id)}|${project.name}|${project.savedAt}`
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
      return deduped.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()) as ProjectItem[]
    }
  } catch {
    // fallback to direct supabase path below
  }

  const ownerColumns = ['user_id', 'created_by', 'owner_id', null] as const
  let data: Array<Record<string, unknown>> | null = null
  let lastErrorMessage: string | null = null

  for (const ownerColumn of ownerColumns) {
    let query = supabase.from('projects').select('*')
    if (ownerColumn !== null) {
      query = query.eq(ownerColumn, userId)
    }

    let result = await query.order('created_at', { ascending: false })

    if (result.error && isMissingColumnError(result.error.message, 'created_at')) {
      let noOrderQuery = supabase.from('projects').select('*')
      if (ownerColumn !== null) {
        noOrderQuery = noOrderQuery.eq(ownerColumn, userId)
      }
      result = await noOrderQuery
    }

    if (!result.error && Array.isArray(result.data)) {
      data = result.data as unknown as Array<Record<string, unknown>>
      lastErrorMessage = null
      break
    }

    if (result.error) {
      lastErrorMessage = result.error.message
      if (ownerColumn !== null && isMissingColumnError(lastErrorMessage, ownerColumn)) {
        continue
      }
    }

    break
  }

  if (lastErrorMessage || !data) {
    return localProjects
  }

  const remoteFallbackProjects = data
    .map((project, index) => ({
      id:
        typeof project.id === 'number' || typeof project.id === 'string'
          ? project.id
          : typeof project.project_id === 'number' || typeof project.project_id === 'string'
            ? project.project_id
            : `${Date.now()}-${index}`,
      name: pickString(project, ['name', 'title', 'project_name', 'project'], 'Untitled'),
      problem: pickString(project, ['problem', 'description', 'problem_text', 'prompt'], ''),
      pseudocode: pickString(project, ['pseudocode', 'code', 'solution', 'answer'], ''),
      language: pickString(project, ['language', 'lang'], 'python'),
      board: pickString(project, ['board', 'exam_board'], 'cie-igcse'),
      savedAt: pickString(project, ['created_at', 'saved_at', 'updated_at'], new Date().toISOString()),
    }))
  const merged = [...remoteFallbackProjects, ...localProjects]
  const seen = new Set<string>()
  const deduped = merged.filter((project) => {
    const key = `${String(project.id)}|${project.name}|${project.savedAt}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  return deduped.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()) as ProjectItem[]
}

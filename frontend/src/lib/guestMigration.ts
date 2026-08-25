import type { User } from '@supabase/supabase-js'
import { saveProject } from './projects'

export async function migrateGuestDataToSupabase(user: User) {
  const rawProjects = localStorage.getItem('pseudo_wizard_projects')
  if (!rawProjects) {
    return
  }

  try {
    const projects = JSON.parse(rawProjects) as Array<Record<string, unknown>>
    if (!Array.isArray(projects) || projects.length === 0) {
      return
    }

    let migratedCount = 0

    for (const project of projects) {
      const result = await saveProject({
        user,
        draft: {
          name: typeof project.name === 'string' ? project.name : 'Untitled',
          problem: typeof project.problem === 'string' ? project.problem : '',
          pseudocode:
            typeof project.pseudocode === 'string' ? project.pseudocode : '',
          language: typeof project.language === 'string' ? project.language : 'python',
          board: typeof project.board === 'string' ? project.board : 'cie-igcse',
        },
      })

      if (result.ok) {
        migratedCount += 1
      }
    }

    if (migratedCount > 0) {
      localStorage.removeItem('pseudo_wizard_projects')
    }
  } catch {
    // Migration failure should not break the app
  }
}

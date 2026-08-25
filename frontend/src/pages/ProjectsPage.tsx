import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadProjects, type ProjectItem } from '../lib/projects'
import { useAuthStore } from '../stores/authStore'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'

function ProjectsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const setBoard = useSettingsStore((state) => state.setBoard)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const setProblemCard = useEditorStore((state) => state.setProblemCard)
  const setPseudocode = useEditorStore((state) => state.setPseudocode)
  const setGeneratedCode = useEditorStore((state) => state.setGeneratedCode)
  const setOutput = useEditorStore((state) => state.setOutput)
  const setOutputStatus = useEditorStore((state) => state.setOutputStatus)
  const setIsProblemCardCollapsed = useEditorStore(
    (state) => state.setIsProblemCardCollapsed,
  )

  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    const fetchProjects = async () => {
      setIsLoading(true)
      const nextProjects = await loadProjects(user)
      if (!isMounted) {
        return
      }
      setProjects(nextProjects)
      setIsLoading(false)
    }

    void fetchProjects()

    return () => {
      isMounted = false
    }
  }, [user])

  const handleLoadProject = (project: ProjectItem) => {
    setProblemCard({
      description: project.problem,
      inputs: '',
      outputs: '',
      constraints: '',
    })
    setPseudocode(project.pseudocode)
    setGeneratedCode('')
    setOutput(null)
    setOutputStatus('empty')
    setIsProblemCardCollapsed(true)
    setLanguage(project.language)
    setBoard(project.board)
    navigate('/')
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: '8px',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="terminal-panel" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="terminal-label" style={{ marginBottom: '16px' }}>
          [ My Projects ]
        </div>

        {isLoading ? (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '16px' }}>Loading projects...</div>
        ) : projects.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '16px' }}>
            No saved projects yet.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '12px',
            }}
          >
            {projects.map((project) => (
              <button
                type="button"
                key={project.id}
                onClick={() => handleLoadProject(project)}
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: '2px solid #ababb6',
                  borderRadius: '8px',
                  color: '#ffffff',
                  padding: '14px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '20px', marginBottom: '8px' }}>{project.name}</div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
                  {project.language.toUpperCase()} · {project.board.toUpperCase()}
                </div>
                <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '10px' }}>
                  Saved {new Date(project.savedAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ProjectsPage

import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { fastapi } from '../../api/fastapi'
import { saveProject, updateProject } from '../../lib/projects'
import { useAuthStore } from '../../stores/authStore'
import { useEditorStore } from '../../stores/editorStore'
import { useHintStore } from '../../stores/hintStore'
import { useSettingsStore } from '../../stores/settingsStore'
import LoginModal from '../auth/LoginModal'
import ContextSwitcher from '../settings/ContextSwitcher'
import SettingsModal from '../settings/SettingsModal'
import SaveProjectModal from './SaveProjectModal'

const boardLabels: Record<string, string> = {
  'cie-igcse': 'CIE IGCSE',
  'cie-a-level': 'CIE A Level',
  'pearson-igcse': 'Pearson IGCSE',
  'pearson-a-level': 'Pearson A Level',
  'aqa-gcse': 'AQA GCSE',
  'aqa-a-level': 'AQA A Level',
}

const languageLabels: Record<string, string> = {
  python: 'Python',
  vb: 'Visual Basic',
  java: 'Java',
  cpp: 'C++',
  html: 'HTML',
  sql: 'SQL',
}

function TopBar() {
  const navigate = useNavigate()

  const board = useSettingsStore((state) => state.board)
  const language = useSettingsStore((state) => state.language)
  const theme = useSettingsStore((state) => state.theme)

  const user = useAuthStore((state) => state.user)

  const pseudocode = useEditorStore((state) => state.pseudocode)
  const problemCard = useEditorStore((state) => state.problemCard)
  const currentProjectId = useEditorStore((state) => state.currentProjectId)
  const currentProjectName = useEditorStore((state) => state.currentProjectName)
  const solutionTargetProblemId = useEditorStore(
    (state) => state.solutionTargetProblemId,
  )
  const solutionTargetProblemTitle = useEditorStore(
    (state) => state.solutionTargetProblemTitle,
  )
  const setPseudocode = useEditorStore((state) => state.setPseudocode)
  const setProblemCard = useEditorStore((state) => state.setProblemCard)
  const setProblemAttachmentText = useEditorStore(
    (state) => state.setProblemAttachmentText,
  )
  const setProblemAttachmentPreviewUrl = useEditorStore(
    (state) => state.setProblemAttachmentPreviewUrl,
  )
  const setCurrentProject = useEditorStore((state) => state.setCurrentProject)
  const setGeneratedCode = useEditorStore((state) => state.setGeneratedCode)
  const setOutput = useEditorStore((state) => state.setOutput)
  const setOutputStatus = useEditorStore((state) => state.setOutputStatus)
  const setLineMapping = useEditorStore((state) => state.setLineMapping)
  const setActivePseudoLine = useEditorStore((state) => state.setActivePseudoLine)
  const setActiveCodeLine = useEditorStore((state) => state.setActiveCodeLine)
  const setIsProblemCardCollapsed = useEditorStore(
    (state) => state.setIsProblemCardCollapsed,
  )
  const setSolutionTargetProblem = useEditorStore(
    (state) => state.setSolutionTargetProblem,
  )
  const setCurrentHint = useHintStore((state) => state.setCurrentHint)
  const setHintLevel = useHintStore((state) => state.setHintLevel)
  const setAttemptsByBlock = useHintStore((state) => state.setAttemptsByBlock)
  const setShowInlineTraceTable = useHintStore(
    (state) => state.setShowInlineTraceTable,
  )
  const setTraceTableColumns = useHintStore((state) => state.setTraceTableColumns)
  const setHintIsLoading = useHintStore((state) => state.setIsLoading)

  const [showSettings, setShowSettings] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [showContextSwitcher, setShowContextSwitcher] = useState(false)
  const [showSaveChoiceModal, setShowSaveChoiceModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [isSavingProject, setIsSavingProject] = useState(false)
  const [isSubmittingSolution, setIsSubmittingSolution] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [saveToastMessage, setSaveToastMessage] = useState<string | null>(null)
  const [saveToastMs, setSaveToastMs] = useState(2000)
  const [saveToastError, setSaveToastError] = useState(false)
  const [gearHovered, setGearHovered] = useState(false)
  const [profileHovered, setProfileHovered] = useState(false)
  const [hoveredProfileOption, setHoveredProfileOption] = useState<
    'submissions' | 'projects' | 'login' | 'logout' | null
  >(null)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)

  const boardLabel = boardLabels[board] ?? board
  const languageLabel = languageLabels[language] ?? language

  useEffect(() => {
    if (!saveToastMessage) {
      return
    }

    const timeout = window.setTimeout(() => {
      setSaveToastMessage(null)
    }, saveToastMs)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [saveToastMessage, saveToastMs])

  useEffect(() => {
    if (!showProfileMenu) {
      return
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        profileMenuRef.current &&
        event.target instanceof Node &&
        !profileMenuRef.current.contains(event.target)
      ) {
        setShowProfileMenu(false)
      }
    }

    document.addEventListener('click', handleDocumentClick)

    return () => {
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [showProfileMenu])

  const handleResetEditor = () => {
    window.dispatchEvent(new CustomEvent('pw-editor-reset'))
    navigate('/', { replace: true })
    setPseudocode('')
    setProblemCard(null)
    setProblemAttachmentText('')
    setProblemAttachmentPreviewUrl(null)
    setCurrentProject(null)
    setGeneratedCode('')
    setOutput(null)
    setOutputStatus('empty')
    setLineMapping({})
    setActivePseudoLine(null)
    setActiveCodeLine(null)
    setIsProblemCardCollapsed(false)
    setSolutionTargetProblem(null)
    setCurrentHint(null)
    setHintLevel(null)
    setAttemptsByBlock({})
    setShowInlineTraceTable(false)
    setTraceTableColumns([])
    setHintIsLoading(false)
    window.localStorage.removeItem('pseudocode_tutor_session')
    setShowContextSwitcher(false)
    setShowSettings(false)
    setShowLogin(false)
    setShowSaveChoiceModal(false)
    setShowSaveModal(false)
    setShowProfileMenu(false)
    window.setTimeout(() => {
      if (window.location.pathname !== '/') {
        window.location.assign('/')
      }
    }, 0)
  }

  const handleSaveNewProject = async (projectName: string) => {
    setIsSavingProject(true)

    const result = await saveProject({
      draft: {
        name: projectName,
        problem: problemCard?.description ?? '',
        pseudocode,
        language,
        board,
      },
      user,
    })

    setIsSavingProject(false)

    if (!result.ok) {
      setSaveToastError(true)
      setSaveToastMs(6500)
      setSaveToastMessage(`Save failed: ${result.error ?? 'Unknown error'}`)
      return
    }

    setCurrentProject({ id: result.projectId, name: projectName })
    setShowSaveModal(false)
    setSaveToastError(false)
    setSaveToastMs(2000)
    setSaveToastMessage('✓ Project saved')
  }

  const handleSaveCurrentProject = async () => {
    if (currentProjectId === null) {
      setShowSaveChoiceModal(false)
      setShowSaveModal(true)
      return
    }

    setIsSavingProject(true)

    const projectName = currentProjectName ?? 'Untitled Project'
    const result = await updateProject({
      projectId: currentProjectId,
      draft: {
        name: projectName,
        problem: problemCard?.description ?? '',
        pseudocode,
        language,
        board,
      },
      user,
    })

    setIsSavingProject(false)
    setShowSaveChoiceModal(false)

    if (!result.ok) {
      setSaveToastError(true)
      setSaveToastMs(6500)
      setSaveToastMessage(`Save failed: ${result.error ?? 'Unknown error'}`)
      return
    }

    setSaveToastError(false)
    setSaveToastMs(2000)
    setSaveToastMessage('✓ Project updated')
  }

  const handleSubmitSolution = async () => {
    if (solutionTargetProblemId === null) {
      return
    }
    if (user === null) {
      setSaveToastError(true)
      setSaveToastMs(6500)
      setSaveToastMessage('Login required to submit solutions.')
      return
    }
    if (!pseudocode.trim()) {
      setSaveToastError(true)
      setSaveToastMs(6500)
      setSaveToastMessage('Write pseudocode before submitting.')
      return
    }

    setIsSubmittingSolution(true)

    try {
      const response = await fastapi.post<{
        ok?: boolean
        error?: string
      }>('/community/submit-solution', {
        problem_id: solutionTargetProblemId,
        pseudocode: pseudocode.trim(),
        author_id: user?.id ?? null,
        is_ai_generated: false,
      })

      if (response.data.ok !== true) {
        const rawError = String(response.data.error ?? '').toLowerCase()
        const rejectedByPolicy =
          rawError.includes('ai rejected') || rawError.includes('rejected')
        setSaveToastError(true)
        setSaveToastMs(6500)
        setSaveToastMessage(
          rejectedByPolicy
            ? 'This is not appropriate content for this platform. You cannot submit this.'
            : 'Could not submit solution right now. Please try again.',
        )
        setIsSubmittingSolution(false)
        return
      }

      setSaveToastError(false)
      setSaveToastMs(2000)
      setSaveToastMessage(
        `✓ Solution submitted${solutionTargetProblemTitle ? ` to ${solutionTargetProblemTitle}` : ''}`,
      )
      setSolutionTargetProblem(null)
    } catch {
      setSaveToastError(true)
      setSaveToastMs(6500)
      setSaveToastMessage('Submit failed: backend not reachable.')
    }

    setIsSubmittingSolution(false)
  }

  return (
    <>
      <header
        className="topbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '0 20px',
          height: '72px',
          background: '#43464f',
        }}
      >
        <button
          type="button"
          aria-label="Reset editor"
          onClick={handleResetEditor}
          className="topbar-logo-btn"
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <span className="logo-char" style={{ '--logo-color': '#ffc401', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>{'<'}</span>
          <span className="logo-char" style={{ '--logo-color': '#01aea0', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>{'/'}</span>
          <span className="logo-char" style={{ '--logo-color': '#ffc401', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>{'>'}</span>{' '}
          <span className="logo-char" style={{ '--logo-color': '#ff0021', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>P</span>
          <span className="logo-char" style={{ '--logo-color': '#ffc401', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>S</span>
          <span className="logo-char" style={{ '--logo-color': '#006eb8', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>E</span>
          <span className="logo-char" style={{ '--logo-color': '#01aea0', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>U</span>
          <span className="logo-char" style={{ '--logo-color': '#ff0021', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>D</span>
          <span className="logo-char" style={{ '--logo-color': '#ffc401', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>O</span>{' '}
          <span className="logo-char" style={{ '--logo-color': '#ff0021', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>W</span>
          <span className="logo-char" style={{ '--logo-color': '#006eb8', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>I</span>
          <span className="logo-char" style={{ '--logo-color': '#01aea0', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>Z</span>
          <span className="logo-char" style={{ '--logo-color': '#ffc401', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>A</span>
          <span className="logo-char" style={{ '--logo-color': '#ff0021', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>R</span>
          <span className="logo-char" style={{ '--logo-color': '#006eb8', color: 'var(--logo-color)', fontSize: '36px', lineHeight: 1 } as React.CSSProperties}>D</span>
        </button>

        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-evenly',
          }}
        >
          <div style={{ position: 'relative' }}>
            <button
              className="terminal-button topbar-btn"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setShowContextSwitcher((current) => !current)
              }}
              style={{
                fontSize: '23px',
                height: '52px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              [ {languageLabel} · {boardLabel} ▾ ]
            </button>
            <ContextSwitcher
              isOpen={showContextSwitcher}
              onClose={() => setShowContextSwitcher(false)}
            />
          </div>

          <button
            type="button"
            className="terminal-button topbar-btn"
            style={{ fontSize: '23px', height: '52px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => navigate('/community')}
          >
            [ Community ]
          </button>

          <button
            type="button"
            className="terminal-button topbar-btn"
            style={{ fontSize: '23px', height: '52px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => {
              if (solutionTargetProblemId !== null) {
                void handleSubmitSolution()
                return
              }
              if (currentProjectId !== null) {
                setShowSaveChoiceModal(true)
                return
              }
              setShowSaveModal(true)
            }}
            disabled={isSubmittingSolution}
          >
            {solutionTargetProblemId !== null
              ? isSubmittingSolution
                ? '[ Submitting... ]'
                : '[ Submit ]'
              : '[ Save ]'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <div
            className={gearHovered ? 'gear-icon-hovered' : undefined}
            onMouseEnter={() => setGearHovered(true)}
            onMouseLeave={() => setGearHovered(false)}
            onClick={() => setShowSettings(true)}
            style={{
              width: '52px',
              height: '52px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              borderRadius: '4px',
              marginTop: '-3.5px',
              backgroundColor: gearHovered
                ? (theme === 'light' ? '#43464f' : '#ffffff')
                : 'transparent',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <span style={{
              fontSize: '49px',
              color: gearHovered
                ? (theme === 'light' ? '#eaeaeb' : '#43464f')
                : (theme === 'light' ? '#43464f' : '#ffffff'),
              lineHeight: 1,
              display: 'block',
              transform: 'translateY(-4.25px)',
            }}>⚙</span>
          </div>

          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Profile"
              className={profileHovered ? 'profile-circle profile-circle-hovered' : 'profile-circle'}
              onClick={() => setShowProfileMenu((current) => !current)}
              onMouseEnter={() => setProfileHovered(true)}
              onMouseLeave={() => setProfileHovered(false)}
              style={{
                width: '46px',
                height: '46px',
                border: `2px solid ${theme === 'light' ? '#43464f' : '#ffffff'}`,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: profileHovered
                  ? (theme === 'light' ? '#43464f' : '#ffffff')
                  : 'transparent',
                color: profileHovered
                  ? (theme === 'light' ? '#eaeaeb' : '#43464f')
                  : (theme === 'light' ? '#43464f' : '#ffffff'),
                cursor: 'pointer',
                padding: 0,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {user?.email ? (
                <span className="profile-initial" style={{ fontSize: '18px', lineHeight: 1 }}>
                  {user.email.charAt(0).toUpperCase()}
                </span>
              ) : (
                <svg
                  width="23"
                  height="23"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              )}
            </button>

            {showProfileMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '220px',
                  background: theme === 'light' ? '#eaeaeb' : '#43464f',
                  border: `2px solid ${theme === 'light' ? '#8a8d96' : '#ababb6'}`,
                  borderRadius: '8px',
                  padding: '10px',
                  zIndex: 1000,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <button
                  type="button"
                  onMouseEnter={() => setHoveredProfileOption('submissions')}
                  onMouseLeave={() => setHoveredProfileOption(null)}
                  onClick={() => {
                    setShowProfileMenu(false)
                    navigate('/my-submissions')
                  }}
                  style={{
                    border: 'none',
                    background:
                      hoveredProfileOption === 'submissions'
                        ? theme === 'light'
                          ? '#43464f'
                          : '#ffffff'
                        : 'transparent',
                    color:
                      hoveredProfileOption === 'submissions'
                        ? theme === 'light'
                          ? '#eaeaeb'
                          : '#43464f'
                        : theme === 'light'
                          ? '#43464f'
                          : '#ffffff',
                    fontSize: '18px',
                    textAlign: 'left',
                    padding: '10px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  [ My Submissions ]
                </button>

                <button
                  type="button"
                  onMouseEnter={() => setHoveredProfileOption('projects')}
                  onMouseLeave={() => setHoveredProfileOption(null)}
                  onClick={() => {
                    setShowProfileMenu(false)
                    navigate('/projects')
                  }}
                  style={{
                    border: 'none',
                    background:
                      hoveredProfileOption === 'projects'
                        ? theme === 'light'
                          ? '#43464f'
                          : '#ffffff'
                        : 'transparent',
                    color:
                      hoveredProfileOption === 'projects'
                        ? theme === 'light'
                          ? '#eaeaeb'
                          : '#43464f'
                        : theme === 'light'
                          ? '#43464f'
                          : '#ffffff',
                    fontSize: '18px',
                    textAlign: 'left',
                    padding: '10px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  [ My Projects ]
                </button>

                {user === null ? (
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredProfileOption('login')}
                    onMouseLeave={() => setHoveredProfileOption(null)}
                    onClick={() => {
                      setShowProfileMenu(false)
                      setShowLogin(true)
                    }}
                    style={{
                      border: 'none',
                      background:
                        hoveredProfileOption === 'login'
                          ? theme === 'light'
                            ? '#43464f'
                            : '#ffffff'
                          : 'transparent',
                      color:
                        hoveredProfileOption === 'login'
                          ? theme === 'light'
                            ? '#eaeaeb'
                            : '#43464f'
                          : theme === 'light'
                            ? '#43464f'
                            : '#ffffff',
                      fontSize: '18px',
                      textAlign: 'left',
                      padding: '10px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    [ Login ]
                  </button>
                ) : (
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredProfileOption('logout')}
                    onMouseLeave={() => setHoveredProfileOption(null)}
                    onClick={() => {
                      void useAuthStore.getState().signOut()
                      setShowProfileMenu(false)
                    }}
                    style={{
                      border: 'none',
                      background:
                        hoveredProfileOption === 'logout'
                          ? theme === 'light'
                            ? '#43464f'
                            : '#ffffff'
                          : 'transparent',
                      color:
                        hoveredProfileOption === 'logout'
                          ? theme === 'light'
                            ? '#eaeaeb'
                            : '#43464f'
                          : theme === 'light'
                            ? '#43464f'
                            : '#ffffff',
                      fontSize: '18px',
                      textAlign: 'left',
                      padding: '10px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    [ Logout ]
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {showSaveModal && (
        <SaveProjectModal
          isSaving={isSavingProject}
          onClose={() => setShowSaveModal(false)}
          onSave={(projectName) => {
            void handleSaveNewProject(projectName)
          }}
        />
      )}

      {showSaveChoiceModal && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1000 }}
          onClick={() => setShowSaveChoiceModal(false)}
          role="presentation"
        >
          <div
            className="modal-box"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: '#43464f',
              border: '2px solid #ababb6',
              borderRadius: '8px',
              width: '420px',
              maxWidth: '90vw',
              padding: '24px',
            }}
          >
            <div style={{ color: '#ffffff', fontSize: '22px', marginBottom: '16px' }}>
              [ Save Project ]
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                className="terminal-button"
                onClick={() => {
                  setShowSaveChoiceModal(false)
                  setShowSaveModal(true)
                }}
              >
                [ Save As New Project ]
              </button>

              <button
                type="button"
                className="terminal-button"
                onClick={() => {
                  void handleSaveCurrentProject()
                }}
                disabled={isSavingProject}
              >
                {isSavingProject ? '[ Saving... ]' : '[ Save To Current Project ]'}
              </button>

              <button
                type="button"
                className="terminal-button"
                onClick={() => setShowSaveChoiceModal(false)}
              >
                [ Cancel ]
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenLogin={() => setShowLogin(true)}
      />

      <LoginModal
        isOpen={showLogin}
        onClose={() => setShowLogin(false)}
      />

      {saveToastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '82px',
            right: '16px',
            background: '#43464f',
            border: '2px solid #ababb6',
            borderRadius: '6px',
            padding: '10px 14px',
            color: saveToastError ? '#ff6b6b' : '#7ed957',
            fontSize: '16px',
            zIndex: 1200,
          }}
        >
          {saveToastMessage}
        </div>
      )}
    </>
  )
}

export default TopBar

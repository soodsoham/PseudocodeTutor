import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import EditorShell from './components/editor/EditorShell'
import FirstRunModal from './components/onboarding/FirstRunModal'
import TopBar from './components/shared/TopBar'
import { getCookie, setCookie } from './lib/cookies'
import { migrateGuestDataToSupabase } from './lib/guestMigration'
import { loadSession, saveSession } from './lib/localStorage'
import { supabase } from './lib/supabaseClient'
import CommunityPage from './pages/CommunityPage'
import ModerationPage from './pages/ModerationPage'
import MySubmissionsPage from './pages/MySubmissionsPage'
import ProjectsPage from './pages/ProjectsPage'
import { useAuthStore } from './stores/authStore'
import {
  useEditorStore,
  type ProblemCard,
  type SyntaxErrorItem,
  type WarningItem,
} from './stores/editorStore'
import { useSettingsStore } from './stores/settingsStore'

const PORT_MIGRATION_KEYS = [
  'pseudocode_tutor_session',
  'pseudo_wizard_projects',
  'pct_my_submissions',
  'pct_pdf_upload_counts',
  'pct_total_upload_counts',
  'pct_guest_account_id',
  'pct_first_run_done',
] as const

const PORT_MIGRATION_FLAG = 'pct_port_storage_migrated_once'

function App() {
  const setSession = useAuthStore((state) => state.setSession)
  const isFirstRun = useSettingsStore((state) => state.isFirstRun)
  const board = useSettingsStore((state) => state.board)
  const language = useSettingsStore((state) => state.language)
  const theme = useSettingsStore((state) => state.theme)
  const textSize = useSettingsStore((state) => state.textSize)
  const setBoard = useSettingsStore((state) => state.setBoard)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setTextSize = useSettingsStore((state) => state.setTextSize)
  const setIsFirstRun = useSettingsStore((state) => state.setIsFirstRun)

  const pseudocode = useEditorStore((state) => state.pseudocode)
  const generatedCode = useEditorStore((state) => state.generatedCode)
  const output = useEditorStore((state) => state.output)
  const outputStatus = useEditorStore((state) => state.outputStatus)
  const tier1Warnings = useEditorStore((state) => state.tier1Warnings)
  const tier2Errors = useEditorStore((state) => state.tier2Errors)
  const activePseudoLine = useEditorStore((state) => state.activePseudoLine)
  const activeCodeLine = useEditorStore((state) => state.activeCodeLine)
  const problemCard = useEditorStore((state) => state.problemCard)
  const problemAttachmentText = useEditorStore(
    (state) => state.problemAttachmentText,
  )
  const problemAttachmentPreviewUrl = useEditorStore(
    (state) => state.problemAttachmentPreviewUrl,
  )
  const currentProjectId = useEditorStore((state) => state.currentProjectId)
  const currentProjectName = useEditorStore((state) => state.currentProjectName)
  const isProblemCardCollapsed = useEditorStore(
    (state) => state.isProblemCardCollapsed,
  )
  const isDebriefUnlocked = useEditorStore((state) => state.isDebriefUnlocked)
  const isRunDisabled = useEditorStore((state) => state.isRunDisabled)
  const setPseudocode = useEditorStore((state) => state.setPseudocode)
  const setGeneratedCode = useEditorStore((state) => state.setGeneratedCode)
  const setOutput = useEditorStore((state) => state.setOutput)
  const setOutputStatus = useEditorStore((state) => state.setOutputStatus)
  const setTier1Warnings = useEditorStore((state) => state.setTier1Warnings)
  const setTier2Errors = useEditorStore((state) => state.setTier2Errors)
  const setActivePseudoLine = useEditorStore((state) => state.setActivePseudoLine)
  const setActiveCodeLine = useEditorStore((state) => state.setActiveCodeLine)
  const setProblemCard = useEditorStore((state) => state.setProblemCard)
  const setProblemAttachmentText = useEditorStore(
    (state) => state.setProblemAttachmentText,
  )
  const setProblemAttachmentPreviewUrl = useEditorStore(
    (state) => state.setProblemAttachmentPreviewUrl,
  )
  const setCurrentProject = useEditorStore((state) => state.setCurrentProject)
  const setIsProblemCardCollapsed = useEditorStore(
    (state) => state.setIsProblemCardCollapsed,
  )
  const setIsDebriefUnlocked = useEditorStore(
    (state) => state.setIsDebriefUnlocked,
  )
  const setIsRunDisabled = useEditorStore((state) => state.setIsRunDisabled)

  const isOutputStatus = (
    value: unknown,
  ): value is 'empty' | 'running' | 'correct' | 'wrong' | 'error' =>
    value === 'empty' ||
    value === 'running' ||
    value === 'correct' ||
    value === 'wrong' ||
    value === 'error'

  const isWarningArray = (value: unknown): value is WarningItem[] =>
    Array.isArray(value)

  const isSyntaxErrorArray = (value: unknown): value is SyntaxErrorItem[] =>
    Array.isArray(value)

  const isProblemCard = (value: unknown): value is ProblemCard =>
    typeof value === 'object' &&
    value !== null &&
    'description' in value &&
    'inputs' in value &&
    'outputs' in value &&
    'constraints' in value

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (window.location.hostname !== 'localhost') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const isBridgeMode = params.get('pwBridge') === '1'

    const handleMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; requestId?: string }
        | undefined

      if (data?.type !== 'PW_STORAGE_EXPORT_REQUEST') {
        return
      }

      const payload: Record<string, string> = {}
      for (const key of PORT_MIGRATION_KEYS) {
        const value = window.localStorage.getItem(key)
        if (value !== null) {
          payload[key] = value
        }
      }

      if (event.source && 'postMessage' in event.source) {
        ;(event.source as WindowProxy).postMessage(
          {
            type: 'PW_STORAGE_EXPORT_RESPONSE',
            requestId: data.requestId,
            payload,
          },
          event.origin || '*',
        )
      }
    }

    window.addEventListener('message', handleMessage)

    if (isBridgeMode) {
      return () => {
        window.removeEventListener('message', handleMessage)
      }
    }

    const alreadyMigrated = window.sessionStorage.getItem(PORT_MIGRATION_FLAG) === '1'
    if (alreadyMigrated) {
      return () => {
        window.removeEventListener('message', handleMessage)
      }
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const currentPort = Number(window.location.port || '80')
    const portsToProbe = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180].filter(
      (port) => port !== currentPort,
    )

    const hasDataLocally = PORT_MIGRATION_KEYS.some((key) => {
      const value = window.localStorage.getItem(key)
      return typeof value === 'string' && value.length > 0
    })

    if (hasDataLocally) {
      window.sessionStorage.setItem(PORT_MIGRATION_FLAG, '1')
      return () => {
        window.removeEventListener('message', handleMessage)
      }
    }

    let imported = false
    const iframes: HTMLIFrameElement[] = []
    const cleanup = () => {
      for (const frame of iframes) {
        frame.remove()
      }
      window.removeEventListener('message', handleImportResponse)
    }

    const handleImportResponse = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; requestId?: string; payload?: Record<string, string> }
        | undefined

      if (data?.type !== 'PW_STORAGE_EXPORT_RESPONSE') {
        return
      }
      if (data.requestId !== requestId) {
        return
      }
      if (!data.payload || typeof data.payload !== 'object') {
        return
      }

      let wroteAny = false
      for (const key of PORT_MIGRATION_KEYS) {
        const currentValue = window.localStorage.getItem(key)
        const incomingValue = data.payload[key]
        if (
          (currentValue === null || currentValue.length === 0) &&
          typeof incomingValue === 'string' &&
          incomingValue.length > 0
        ) {
          window.localStorage.setItem(key, incomingValue)
          wroteAny = true
        }
      }

      if (wroteAny && !imported) {
        imported = true
        window.sessionStorage.setItem(PORT_MIGRATION_FLAG, '1')
        cleanup()
        window.location.reload()
      }
    }

    window.addEventListener('message', handleImportResponse)

    for (const port of portsToProbe) {
      const iframe = document.createElement('iframe')
      iframe.style.display = 'none'
      iframe.src = `http://localhost:${port}/?pwBridge=1`
      iframe.onload = () => {
        iframe.contentWindow?.postMessage(
          {
            type: 'PW_STORAGE_EXPORT_REQUEST',
            requestId,
          },
          `http://localhost:${port}`,
        )
      }
      iframes.push(iframe)
      document.body.appendChild(iframe)
    }

    const timeout = window.setTimeout(() => {
      if (!imported) {
        window.sessionStorage.setItem(PORT_MIGRATION_FLAG, '1')
      }
      cleanup()
    }, 1800)

    return () => {
      window.clearTimeout(timeout)
      cleanup()
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_IN' && session?.user) {
        void migrateGuestDataToSupabase(session.user)
      }
    })
    return () => subscription.unsubscribe()
  }, [setSession])

  useEffect(() => {
    const firstRunDone = window.localStorage.getItem('pct_first_run_done')
    const cookieBoard = getCookie('pct_board')
    const cookieLanguage = getCookie('pct_language')
    const cookieTheme = getCookie('pct_theme')
    const cookieTextSize = getCookie('pct_textsize')

    if (cookieBoard) {
      setBoard(cookieBoard)
    }
    if (cookieLanguage) {
      setLanguage(cookieLanguage)
    }
    if (cookieTheme === 'light' || cookieTheme === 'dark') {
      setTheme(cookieTheme)
    }
    if (
      cookieTextSize === 'small' ||
      cookieTextSize === 'medium' ||
      cookieTextSize === 'large'
    ) {
      setTextSize(cookieTextSize)
    }

    if (firstRunDone) {
      setIsFirstRun(false)
    } else if (cookieBoard && cookieLanguage) {
      setIsFirstRun(false)
    }

    const session = loadSession()
    if (!session) {
      return
    }

    setPseudocode(typeof session.pseudocode === 'string' ? session.pseudocode : '')
    setGeneratedCode(
      typeof session.generatedCode === 'string' ? session.generatedCode : '',
    )
    setOutput(
      typeof session.output === 'string' || session.output === null
        ? session.output
        : null,
    )
    setOutputStatus(
      isOutputStatus(session.outputStatus) ? session.outputStatus : 'empty',
    )
    setTier1Warnings(isWarningArray(session.tier1Warnings) ? session.tier1Warnings : [])
    setTier2Errors(
      isSyntaxErrorArray(session.tier2Errors) ? session.tier2Errors : [],
    )
    setActivePseudoLine(
      typeof session.activePseudoLine === 'number'
        ? session.activePseudoLine
        : null,
    )
    setActiveCodeLine(
      typeof session.activeCodeLine === 'number' ? session.activeCodeLine : null,
    )
    setProblemCard(isProblemCard(session.problemCard) ? session.problemCard : null)
    setProblemAttachmentText(
      typeof session.problemAttachmentText === 'string'
        ? session.problemAttachmentText
        : '',
    )
    setProblemAttachmentPreviewUrl(
      typeof session.problemAttachmentPreviewUrl === 'string'
        ? session.problemAttachmentPreviewUrl
        : null,
    )
    setCurrentProject(
      typeof session.currentProjectName === 'string' &&
        (typeof session.currentProjectId === 'string' ||
          typeof session.currentProjectId === 'number')
        ? { id: session.currentProjectId, name: session.currentProjectName }
        : null,
    )
    setIsProblemCardCollapsed(
      typeof session.isProblemCardCollapsed === 'boolean'
        ? session.isProblemCardCollapsed
        : false,
    )
    setIsDebriefUnlocked(
      typeof session.isDebriefUnlocked === 'boolean'
        ? session.isDebriefUnlocked
        : false,
    )
    setIsRunDisabled(
      typeof session.isRunDisabled === 'boolean' ? session.isRunDisabled : false,
    )
  }, [
    setActiveCodeLine,
    setActivePseudoLine,
    setBoard,
    setGeneratedCode,
    setIsDebriefUnlocked,
    setIsFirstRun,
    setIsProblemCardCollapsed,
    setIsRunDisabled,
    setLanguage,
    setOutput,
    setOutputStatus,
    setProblemCard,
    setProblemAttachmentText,
    setProblemAttachmentPreviewUrl,
    setCurrentProject,
    setPseudocode,
    setTextSize,
    setTheme,
    setTier1Warnings,
    setTier2Errors,
  ])

  useEffect(() => {
    if (isFirstRun) {
      return
    }

    setCookie('pct_board', board)
    setCookie('pct_language', language)
    setCookie('pct_theme', theme)
    setCookie('pct_textsize', textSize)
  }, [board, isFirstRun, language, textSize, theme])

  useEffect(() => {
    saveSession({
      pseudocode,
      generatedCode,
      output,
      outputStatus,
      tier1Warnings,
      tier2Errors,
      activePseudoLine,
      activeCodeLine,
      problemCard,
      problemAttachmentText,
      problemAttachmentPreviewUrl,
      currentProjectId,
      currentProjectName,
      isProblemCardCollapsed,
      isDebriefUnlocked,
      isRunDisabled,
    })
  }, [
    activeCodeLine,
    activePseudoLine,
    generatedCode,
    isDebriefUnlocked,
    isProblemCardCollapsed,
    isRunDisabled,
    output,
    outputStatus,
    problemCard,
    problemAttachmentText,
    problemAttachmentPreviewUrl,
    currentProjectId,
    currentProjectName,
    pseudocode,
    tier1Warnings,
    tier2Errors,
  ])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.classList.toggle('light-mode', theme === 'light')
  }, [theme])

  if (isFirstRun) {
    return <FirstRunModal />
  }

  return (
    <div className="app-shell">
      <TopBar />
      <div style={{ flex: 1, minHeight: 0, width: '100%', minWidth: 0 }}>
        <Routes>
          <Route path="/" element={<EditorShell />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/my-submissions" element={<MySubmissionsPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/problem/:problemId" element={<CommunityPage />} />
          <Route path="/moderate" element={<ModerationPage />} />
        </Routes>
      </div>
    </div>
  )
}

export default App

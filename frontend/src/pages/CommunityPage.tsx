import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { fastapi } from '../api/fastapi'
import { fetchCommunityProblemPdfContext } from '../lib/communityAttachments'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from '../stores/authStore'
import { useEditorStore } from '../stores/editorStore'
import { useSettingsStore } from '../stores/settingsStore'

GlobalWorkerOptions.workerSrc = pdfWorker

type Difficulty = 'easy' | 'medium' | 'hard'

interface CommunityProblem {
  id: number | string
  title: string
  description: string
  difficulty: Difficulty
  board: string
  language: string
  created_at?: string
  solutionCount: number
  upvoteCount: number
  downvoteCount: number
  moderationStatus?: 'approved' | 'pending' | 'rejected'
}

interface CommunitySolution {
  id: number | string
  pseudocode: string
  author_id: string | null
  created_at: string
}

interface AISolutionPayload {
  solution?: string
  pseudocode?: string
  cached?: boolean
  error?: string
}

interface ProblemAttachment {
  id: string
  file_name: string
  file_type: string
  url: string
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value
  }
  if (ArrayBuffer.isView(value)) {
    const view = value
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    return bytes.slice().buffer
  }
  return null
}

const boardLabels: Record<string, string> = {
  'cie-igcse': 'CIE IGCSE',
  'cie-a-level': 'CIE A Level',
  'pearson-igcse': 'Pearson IGCSE',
  'pearson-a-level': 'Pearson A Level',
  'aqa-gcse': 'AQA GCSE',
  'aqa-a-level': 'AQA A Level',
}

const boardOptions = [
  { label: 'CIE IGCSE', value: 'cie-igcse' },
  { label: 'CIE A Level', value: 'cie-a-level' },
  { label: 'Pearson IGCSE', value: 'pearson-igcse' },
  { label: 'Pearson A Level', value: 'pearson-a-level' },
  { label: 'AQA GCSE', value: 'aqa-gcse' },
  { label: 'AQA A Level', value: 'aqa-a-level' },
]

const DAILY_TOTAL_LIMIT = 10
const DAILY_PDF_LIMIT = 3
const MAX_PDF_BYTES = 10 * 1024 * 1024
const PDF_LIMIT_STORAGE_KEY = 'pct_pdf_upload_counts'
const TOTAL_LIMIT_STORAGE_KEY = 'pct_total_upload_counts'
const getOrCreateGuestAccountId = () => {
  const existing = window.localStorage.getItem('pct_guest_account_id')
  if (existing) {
    return existing
  }
  const created = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  window.localStorage.setItem('pct_guest_account_id', created)
  return created
}

const getTodayKey = () => new Date().toISOString().slice(0, 10)

const getPdfDailyCount = (accountKey: string, dateKey: string) => {
  const raw = window.localStorage.getItem(PDF_LIMIT_STORAGE_KEY)
  if (!raw) {
    return 0
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed[`${accountKey}:${dateKey}`] ?? 0
  } catch {
    return 0
  }
}

const incrementPdfDailyCount = (accountKey: string, dateKey: string) => {
  const raw = window.localStorage.getItem(PDF_LIMIT_STORAGE_KEY)
  let parsed: Record<string, number> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, number>
    } catch {
      parsed = {}
    }
  }
  const key = `${accountKey}:${dateKey}`
  parsed[key] = (parsed[key] ?? 0) + 1
  window.localStorage.setItem(PDF_LIMIT_STORAGE_KEY, JSON.stringify(parsed))
}

const getTotalDailyCount = (accountKey: string, dateKey: string) => {
  const raw = window.localStorage.getItem(TOTAL_LIMIT_STORAGE_KEY)
  if (!raw) {
    return 0
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    return parsed[`${accountKey}:${dateKey}`] ?? 0
  } catch {
    return 0
  }
}

const incrementTotalDailyCount = (accountKey: string, dateKey: string) => {
  const raw = window.localStorage.getItem(TOTAL_LIMIT_STORAGE_KEY)
  let parsed: Record<string, number> = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, number>
    } catch {
      parsed = {}
    }
  }
  const key = `${accountKey}:${dateKey}`
  parsed[key] = (parsed[key] ?? 0) + 1
  window.localStorage.setItem(TOTAL_LIMIT_STORAGE_KEY, JSON.stringify(parsed))
}

async function extractPdfModerationData(file: File) {
  const data = await file.arrayBuffer()
  const pdf = await getDocument({ data: new Uint8Array(data) }).promise

  let combinedText = ''
  const imageSamples: string[] = []
  const pageCount = Math.min(pdf.numPages, 3)

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const items = textContent.items as Array<TextItem | TextMarkedContent>
    const pageText = items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (pageText.length > 0) {
      combinedText += `\n[Page ${pageNumber}] ${pageText}`
    }

    const viewport = page.getViewport({ scale: 1 })
    const maxWidth = 480
    const widthScale = viewport.width > maxWidth ? maxWidth / viewport.width : 1
    const renderViewport = page.getViewport({ scale: widthScale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(renderViewport.width))
    canvas.height = Math.max(1, Math.floor(renderViewport.height))
    const context = canvas.getContext('2d')
    if (context) {
      await page.render({ canvasContext: context, viewport: renderViewport, canvas }).promise
      imageSamples.push(canvas.toDataURL('image/jpeg', 0.5))
    }
  }

  return {
    pdfText: combinedText.trim().slice(0, 25000),
    imageSamples: imageSamples.slice(0, 3),
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',')[1] : result
      if (!base64) {
        reject(new Error('Could not read file.'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => {
      reject(new Error('Could not read file.'))
    }
    reader.readAsDataURL(file)
  })
}

function CommunityPage() {
  const navigate = useNavigate()
  const { problemId: sharedProblemId } = useParams<{ problemId?: string }>()
  const user = useAuthStore((state) => state.user)
  const activeBoard = useSettingsStore((state) => state.board)
  const setProblemCard = useEditorStore((state) => state.setProblemCard)
  const setIsProblemCardCollapsed = useEditorStore(
    (state) => state.setIsProblemCardCollapsed,
  )
  const setPseudocode = useEditorStore((state) => state.setPseudocode)
  const setGeneratedCode = useEditorStore((state) => state.setGeneratedCode)
  const setOutput = useEditorStore((state) => state.setOutput)
  const setOutputStatus = useEditorStore((state) => state.setOutputStatus)
  const setLineMapping = useEditorStore((state) => state.setLineMapping)
  const setActivePseudoLine = useEditorStore((state) => state.setActivePseudoLine)
  const setActiveCodeLine = useEditorStore((state) => state.setActiveCodeLine)
  const setProblemAttachmentText = useEditorStore(
    (state) => state.setProblemAttachmentText,
  )
  const setProblemAttachmentPreviewUrl = useEditorStore(
    (state) => state.setProblemAttachmentPreviewUrl,
  )
  const setCurrentProject = useEditorStore((state) => state.setCurrentProject)
  const setSolutionTargetProblem = useEditorStore(
    (state) => state.setSolutionTargetProblem,
  )
  const [problems, setProblems] = useState<CommunityProblem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(
    null,
  )
  const [selectedProblem, setSelectedProblem] = useState<CommunityProblem | null>(
    null,
  )
  const [solutions, setSolutions] = useState<CommunitySolution[]>([])
  const [isLoadingUserSolutions, setIsLoadingUserSolutions] = useState(false)
  const [isLoadingAiSolution, setIsLoadingAiSolution] = useState(false)
  const [aiSolution, setAiSolution] = useState<string | null>(null)
  const [expandedAiSolution, setExpandedAiSolution] = useState(false)
  const [expandedUserSolutions, setExpandedUserSolutions] = useState<
    Record<string, boolean>
  >({})
  const [editingSolutionId, setEditingSolutionId] = useState<string | null>(null)
  const [editingSolutionText, setEditingSolutionText] = useState('')
  const [pendingDeleteSolutionId, setPendingDeleteSolutionId] = useState<
    string | null
  >(null)
  const [showNewProblemForm, setShowNewProblemForm] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [isReporting, setIsReporting] = useState(false)
  const [myVote, setMyVote] = useState<'up' | 'down' | null>(null)
  const [isVoting, setIsVoting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newDifficulty, setNewDifficulty] = useState<Difficulty | null>(null)
  const [newBoard, setNewBoard] = useState(activeBoard)
  const [pdfFilename, setPdfFilename] = useState('')
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null)
  const [problemAttachments, setProblemAttachments] = useState<ProblemAttachment[]>([])
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false)
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null)
  const [expandedAttachmentPreview, setExpandedAttachmentPreview] = useState(false)
  const [attachmentPreviewZoom, setAttachmentPreviewZoom] = useState(1)
  const [attachmentPreviewPages, setAttachmentPreviewPages] = useState<
    Array<{ src: string; width: number }>
  >([])
  const [isRenderingAttachmentPreview, setIsRenderingAttachmentPreview] = useState(false)
  const [attachmentPreviewError, setAttachmentPreviewError] = useState<string | null>(
    null,
  )
  const [attachmentPreviewHeight, setAttachmentPreviewHeight] = useState(520)
  const attachmentPreviewViewportRef = useRef<HTMLDivElement | null>(null)
  const attachmentBufferCacheRef = useRef<Map<string, ArrayBuffer>>(new Map())
  const accountKey = user?.id ?? getOrCreateGuestAccountId()

  const fetchProblems = async () => {
    setIsLoading(true)
    try {
      // Use backend API (service key) — works for all users including anonymous
      const response = await fastapi.get<{ problems: Record<string, unknown>[]; total: number }>(
        '/community/problems',
        { params: { board: activeBoard, limit: 100 } },
      )
      console.log('community fetch result:', response.data, null)

      const data = response.data.problems ?? []

      const ids = data
        .map((item) =>
          typeof item.id === 'number' || typeof item.id === 'string' ? item.id : null,
        )
        .filter((value): value is number | string => value !== null)

      const solutionCountByProblem = new Map<string, number>()
      if (ids.length > 0) {
        const { data: solutionsData } = await supabase
          .from('community_solutions')
          .select('problem_id')
          .in('problem_id', ids)

        for (const solution of solutionsData ?? []) {
          const key = String(solution.problem_id)
          solutionCountByProblem.set(key, (solutionCountByProblem.get(key) ?? 0) + 1)
        }
      }

      const mapped = data.map((problem) => {
        const problemId =
          typeof problem.id === 'string' || typeof problem.id === 'number'
            ? problem.id
            : Date.now()
        const difficulty =
          problem.difficulty === 'easy' ||
          problem.difficulty === 'medium' ||
          problem.difficulty === 'hard'
            ? (problem.difficulty as Difficulty)
            : 'easy'

        const moderationStatusRaw =
          typeof problem.moderation_status === 'string'
            ? problem.moderation_status
            : typeof problem.status === 'string'
              ? problem.status
              : 'approved'
        const moderationStatus =
          moderationStatusRaw === 'approved' ||
          moderationStatusRaw === 'pending' ||
          moderationStatusRaw === 'rejected'
            ? moderationStatusRaw
            : 'approved'

        return {
          id: problemId,
          title: typeof problem.title === 'string' ? problem.title : 'Untitled',
          description: typeof problem.description === 'string' ? problem.description : '',
          difficulty,
          board: typeof problem.board === 'string' ? problem.board : '',
          language: typeof problem.language === 'string' ? problem.language : 'python',
          created_at: typeof problem.created_at === 'string' ? problem.created_at : undefined,
          solutionCount: solutionCountByProblem.get(String(problemId)) ?? 0,
          upvoteCount: Number(problem.upvote_count) || 0,
          downvoteCount: Number(problem.downvote_count) || 0,
          moderationStatus,
        }
      }).filter((problem) => problem.moderationStatus !== 'rejected') as CommunityProblem[]

      setProblems(mapped)
    } catch (err) {
      console.log('community fetch result:', null, err)
      setProblems([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!showNewProblemForm) {
      setPdfFilename('')
      setSelectedPdfFile(null)
      return
    }
    setNewBoard(activeBoard)
  }, [activeBoard, showNewProblemForm])

  useEffect(() => {
    void fetchProblems()
  }, [accountKey, activeBoard])

  useEffect(() => {
    if (!sharedProblemId || selectedProblem) return
    const match = problems.find((problem) => String(problem.id) === sharedProblemId)
    if (match) {
      setSelectedProblem(match)
      return
    }
    // Shared links must work even when the visitor's selected board differs
    // from the problem's board, so fetch the problem directly as a fallback.
    void fastapi.get<{ problem?: Record<string, unknown> }>(`/community/problems/${encodeURIComponent(sharedProblemId)}`)
      .then((response) => {
        const problem = response.data.problem
        if (!problem) return
        setSelectedProblem({
          id: String(problem.id ?? sharedProblemId),
          title: typeof problem.title === 'string' ? problem.title : 'Untitled',
          description: typeof problem.description === 'string' ? problem.description : '',
          difficulty: problem.difficulty === 'medium' || problem.difficulty === 'hard' ? problem.difficulty : 'easy',
          board: typeof problem.board === 'string' ? problem.board : '',
          language: typeof problem.language === 'string' ? problem.language : 'python',
          created_at: typeof problem.created_at === 'string' ? problem.created_at : undefined,
          solutionCount: 0,
          upvoteCount: Number(problem.upvote_count) || 0,
          downvoteCount: Number(problem.downvote_count) || 0,
        })
      })
      .catch(() => undefined)
  }, [problems, selectedProblem, sharedProblemId])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void fetchProblems()
    }
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [accountKey, activeBoard])

  useEffect(() => {
    if (!selectedProblem) {
      return
    }

    const fetchSolutions = async () => {
      setIsLoadingUserSolutions(true)
      setIsLoadingAiSolution(true)
      setExpandedAiSolution(false)
      setExpandedUserSolutions({})
      setEditingSolutionId(null)
      setEditingSolutionText('')
      setPendingDeleteSolutionId(null)
      setAiSolution(null)
      setSolutions([])
      setMyVote(null)

      const userSolutionsPromise = (async () => {
        const fetchQueueSolutions = async () => {
          let queueQuery = await supabase
            .from('moderation_queue')
            .select('*')
            .eq('content_type', 'solution')
            .eq('content_id', selectedProblem.id)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })

          let queueData = queueQuery.data ?? []

          if (queueQuery.error) {
            queueQuery = await supabase
              .from('moderation_queue')
              .select('*')
              .eq('content_type', 'solution')
              .eq('content_id', selectedProblem.id)
              .order('created_at', { ascending: false })
            queueData = queueQuery.data ?? []
          }

          if (
            queueData.length === 0 &&
            (typeof selectedProblem.id === 'string' || typeof selectedProblem.id === 'number')
          ) {
            let fallbackQueueQuery = await supabase
              .from('moderation_queue')
              .select('*')
              .eq('content_type', 'solution')
              .eq('content_id', String(selectedProblem.id))
              .eq('status', 'approved')
              .order('created_at', { ascending: false })
            queueData = fallbackQueueQuery.data ?? queueData

            if (fallbackQueueQuery.error) {
              fallbackQueueQuery = await supabase
                .from('moderation_queue')
                .select('*')
                .eq('content_type', 'solution')
                .eq('content_id', String(selectedProblem.id))
                .order('created_at', { ascending: false })
              queueData = fallbackQueueQuery.data ?? queueData
            }
          }

          const queueMapped: CommunitySolution[] = []
          for (const row of queueData) {
            const solutionText =
              typeof row.reason === 'string'
                ? row.reason
                : typeof row.pseudocode === 'string'
                  ? row.pseudocode
                  : ''
            if (!solutionText.trim()) {
              continue
            }

            const rawId =
              typeof row.id === 'string' || typeof row.id === 'number'
                ? row.id
                : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            queueMapped.push({
              id: `mq:${rawId}`,
              pseudocode: solutionText,
              author_id:
                typeof row.reporter_id === 'string'
                  ? row.reporter_id
                  : typeof row.author_id === 'string'
                    ? row.author_id
                    : null,
              created_at:
                typeof row.created_at === 'string'
                  ? row.created_at
                  : new Date().toISOString(),
            })
          }

          return queueMapped
        }

        const { data, error } = await supabase
          .from('community_solutions')
          .select('*')
          .eq('problem_id', selectedProblem.id)
          .order('created_at', { ascending: false })

        if (error) {
          const queueMapped = await fetchQueueSolutions()
          setSolutions(queueMapped)
          setIsLoadingUserSolutions(false)
          return
        }

        const mapped = (data ?? []).map((solution) => ({
          id:
            typeof solution.id === 'string' || typeof solution.id === 'number'
              ? solution.id
              : Date.now(),
          pseudocode:
            typeof solution.pseudocode === 'string' ? solution.pseudocode : '',
          author_id:
            typeof solution.author_id === 'string' ? solution.author_id : null,
          created_at:
            typeof solution.created_at === 'string'
              ? solution.created_at
              : new Date().toISOString(),
        })) as CommunitySolution[]

        const queueMapped = await fetchQueueSolutions()
        const dedup = new Map<string, CommunitySolution>()
        for (const solution of [...mapped, ...queueMapped]) {
          dedup.set(String(solution.id), solution)
        }

        const combined = Array.from(dedup.values()).sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )

        setSolutions(combined)
        setIsLoadingUserSolutions(false)
      })()

      const aiSolutionPromise = (async () => {
        const problemIdStr = String(selectedProblem.id)
        const AI_CACHE_KEY = 'pseudo_wizard_ai_solutions'

        // Every browser uses the same server-side cache keyed by problem_id.
        // The first successful request generates and stores the answer in Neon;
        // later requests only read that saved answer.
        try {
          const attachmentContext = await fetchCommunityProblemPdfContext(selectedProblem.id)
          const response = await fastapi.post<AISolutionPayload>('/community/ai-solution', {
            problem_id: problemIdStr,
            title: selectedProblem.title,
            description: selectedProblem.description,
            board: selectedProblem.board || boardLabels[activeBoard] || 'CIE IGCSE',
            inputs: '',
            outputs: '',
            constraints: '',
            pdf_text: attachmentContext.text,
          })
          const returnedSolution = response.data.solution ?? response.data.pseudocode
          const solutionText =
            typeof returnedSolution === 'string' && returnedSolution.trim()
              ? returnedSolution
              : '// Could not generate solution'
          setAiSolution(solutionText)
          try {
            const raw = localStorage.getItem(AI_CACHE_KEY)
            const cache = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
            cache[problemIdStr] = { pseudocode: solutionText, generatedAt: new Date().toISOString() }
            localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache))
          } catch { /* ignore */ }
          } catch {
            // A previously cached local answer is still useful during a short API outage.
            try {
              const raw = localStorage.getItem(AI_CACHE_KEY)
              const cache = (raw ? JSON.parse(raw) : {}) as Record<string, { pseudocode: string }>
              setAiSolution(cache[problemIdStr]?.pseudocode ?? '// AI solution is temporarily unavailable. Gemini did not return an answer; please try again later.')
            } catch {
              setAiSolution('// AI solution is temporarily unavailable. Gemini did not return an answer; please try again later.')
            }
        }
        setIsLoadingAiSolution(false)
      })()

      await Promise.all([userSolutionsPromise, aiSolutionPromise])
    }

    void fetchSolutions()
  }, [activeBoard, selectedProblem?.id])

  useEffect(() => {
    setExpandedAttachmentPreview(false)
    setAttachmentPreviewZoom(1)
    setAttachmentPreviewPages([])
    setAttachmentPreviewError(null)
    setIsRenderingAttachmentPreview(false)
    setProblemAttachments([])
    setAttachmentsError(null)
    setIsLoadingAttachments(false)

    if (selectedProblem) {
      void fetchProblemAttachments(selectedProblem.id)
    }
  }, [selectedProblem?.id])

  const filteredProblems = useMemo(() => {
    if (selectedDifficulty === null) {
      return problems
    }
    return problems.filter((problem) => problem.difficulty === selectedDifficulty)
  }, [problems, selectedDifficulty])

  const attachmentPdfUrl = useMemo(() => {
    const pdfAttachment = problemAttachments.find((attachment) => {
      const type = attachment.file_type.toLowerCase()
      const name = attachment.file_name.toLowerCase()
      const url = attachment.url.toLowerCase()
      return type.includes('pdf') || name.endsWith('.pdf') || url.endsWith('.pdf')
    })
    return pdfAttachment?.url ?? null
  }, [problemAttachments])

  useEffect(() => {
    setAttachmentPreviewZoom(1)
  }, [attachmentPdfUrl])

  useEffect(() => {
    if (!expandedAttachmentPreview) {
      return
    }

    const recalcHeight = () => {
      const element = attachmentPreviewViewportRef.current
      if (!element) {
        return
      }
      const rect = element.getBoundingClientRect()
      const available = window.innerHeight - rect.top - 12
      const nextHeight = Math.max(340, Math.min(available, 760))
      setAttachmentPreviewHeight(nextHeight)
    }

    recalcHeight()
    window.addEventListener('resize', recalcHeight)

    return () => {
      window.removeEventListener('resize', recalcHeight)
    }
  }, [expandedAttachmentPreview])

  useEffect(() => {
    let cancelled = false

    const renderAttachmentPreview = async () => {
      if (!expandedAttachmentPreview || !attachmentPdfUrl) {
        setAttachmentPreviewPages([])
        setAttachmentPreviewError(null)
        setIsRenderingAttachmentPreview(false)
        return
      }

      setIsRenderingAttachmentPreview(true)
      setAttachmentPreviewError(null)
      setAttachmentPreviewPages([])

      try {
        const cacheKey = attachmentPdfUrl
        let buffer = attachmentBufferCacheRef.current.get(cacheKey) ?? null
        if (!buffer) {
          const response = await fastapi.get<ArrayBuffer>(attachmentPdfUrl, {
            responseType: 'arraybuffer',
          })
          buffer = toArrayBuffer(response.data)
          if (buffer) {
            attachmentBufferCacheRef.current.set(cacheKey, buffer)
          }
        }
        if (!buffer) {
          throw new Error('Could not read PDF data.')
        }

        const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
        const maxPages = Math.min(pdf.numPages, 6)
        const pageImages: Array<{ src: string; width: number }> = []
        const containerWidth = Math.max(
          360,
          (attachmentPreviewViewportRef.current?.clientWidth ?? 600) - 24,
        )
        const containerHeight = Math.max(
          300,
          (attachmentPreviewViewportRef.current?.clientHeight ?? attachmentPreviewHeight) - 24,
        )

        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          try {
            const page = await pdf.getPage(pageNumber)
            const baseViewport = page.getViewport({ scale: 1 })
            const fitWidthScale = containerWidth / baseViewport.width
            const fitHeightScale = containerHeight / baseViewport.height
            const finalScale = Math.max(0.2, Math.min(fitWidthScale, fitHeightScale))
            const viewport = page.getViewport({ scale: finalScale })
            const devicePixelRatio =
              typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
            const renderScale = Math.min(1.75, Math.max(1, devicePixelRatio * 1.1))

            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.floor(viewport.width * renderScale))
            canvas.height = Math.max(1, Math.floor(viewport.height * renderScale))
            const context = canvas.getContext('2d')
            if (!context) {
              continue
            }
            context.setTransform(renderScale, 0, 0, renderScale, 0, 0)
            await page.render({ canvasContext: context, viewport, canvas }).promise
            pageImages.push({
              src: canvas.toDataURL('image/png'),
              width: Math.max(1, Math.floor(viewport.width)),
            })
          } catch {
            // Skip failed pages and keep preview usable.
          }
        }

        if (pageImages.length === 0) {
          throw new Error('No pages rendered.')
        }

        if (cancelled) {
          return
        }
        setAttachmentPreviewPages(pageImages)
      } catch {
        if (cancelled) {
          return
        }
        setAttachmentPreviewError('Could not render attached file preview.')
      } finally {
        if (!cancelled) {
          setIsRenderingAttachmentPreview(false)
        }
      }
    }

    void renderAttachmentPreview()

    return () => {
      cancelled = true
    }
  }, [attachmentPdfUrl, attachmentPreviewHeight, expandedAttachmentPreview])

  const toAttachmentUrl = (url: string) => {
    const trimmed = url.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed
    }
    const base = (fastapi.defaults.baseURL ?? '').replace(/\/$/, '')
    return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`
  }

  const fetchProblemAttachments = async (problemId: number | string) => {
    setIsLoadingAttachments(true)
    setAttachmentsError(null)
    try {
      const response = await fastapi.get<{
        attachments?: Array<Record<string, unknown>>
        error?: string
      }>(`/community/problems/${encodeURIComponent(String(problemId))}/attachments`)

      const mapped = (response.data.attachments ?? [])
        .map((item) => {
          const rawUrl =
            typeof item.url === 'string'
              ? item.url
              : typeof item.file_url === 'string'
                ? item.file_url
                : null
          if (!rawUrl) {
            return null
          }
          return {
            id:
              typeof item.id === 'string' || typeof item.id === 'number'
                ? String(item.id)
                : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            file_name:
              typeof item.file_name === 'string'
                ? item.file_name
                : typeof item.name === 'string'
                  ? item.name
                  : 'Attached file',
            file_type:
              typeof item.file_type === 'string'
                ? item.file_type
                : typeof item.mime_type === 'string'
                  ? item.mime_type
                  : 'application/pdf',
            url: toAttachmentUrl(rawUrl),
          } satisfies ProblemAttachment
        })
        .filter((item): item is ProblemAttachment => item !== null)

      setProblemAttachments(mapped)
    } catch {
      setProblemAttachments([])
      setAttachmentsError('Could not load attached files.')
    } finally {
      setIsLoadingAttachments(false)
    }
  }

  const handleSubmitProblem = async () => {
    if (isSubmitting) {
      return
    }
    if (user === null) {
      setSubmitMessage('Login required to submit community problems.')
      return
    }

    if (!newTitle.trim() || !newDescription.trim() || !newDifficulty) {
      setSubmitMessage('Please fill title, description, and difficulty.')
      return
    }

    setIsSubmitting(true)
    // This deployment currently has one authenticated account. Treat the
    // signed-in owner as admin so provider-specific email fields cannot lock
    // the owner out of the unlimited upload allowance.
    const isAdmin = Boolean(user)
    const todayKey = getTodayKey()

    if (!isAdmin) {
      const totalToday = getTotalDailyCount(user.id, todayKey)
      if (totalToday >= DAILY_TOTAL_LIMIT) {
        setSubmitMessage('Daily upload limit reached (10 problems per day).')
        setIsSubmitting(false)
        return
      }

      if (pdfFilename.trim().length > 0) {
        const pdfCountToday = getPdfDailyCount(user.id, todayKey)
        if (pdfCountToday >= DAILY_PDF_LIMIT) {
          setSubmitMessage('Daily PDF upload limit reached (3 per day).')
          setIsSubmitting(false)
          return
        }
      }
    }

    const moderationStatus = isAdmin ? 'approved' : 'pending'

    let submittedProblemId: string | null = null
    let backendModerationStatus: 'approved' | 'pending' | 'rejected' | null = null
    let backendReviewReason = ''

    let extractedPdfText = ''
    let attachmentImageSamples: string[] = []
    if (selectedPdfFile) {
      try {
        const extracted = await extractPdfModerationData(selectedPdfFile)
        extractedPdfText = extracted.pdfText
        attachmentImageSamples = extracted.imageSamples
      } catch {
        extractedPdfText = ''
        attachmentImageSamples = []
      }
    }

    try {
      const response = await fastapi.post<{
        ok?: boolean
        problem_id?: string
        error?: string
        moderation_status?: 'approved' | 'pending' | 'rejected'
        review_reason?: string
      }>(
        '/community/submit',
        {
          title: newTitle.trim(),
          description: newDescription.trim(),
          difficulty: newDifficulty,
          board: newBoard,
          moderation_status: moderationStatus,
          pdf_text: extractedPdfText,
          attachment_text: selectedPdfFile?.name ?? pdfFilename.trim(),
          attachment_image_samples: attachmentImageSamples,
          created_by: user.id,
        },
        // Moderation calls Gemini before the database insert. Allow for a
        // cold start or a slower model response instead of treating it as a
        // network outage after ten seconds.
        { timeout: 45000 },
      )

      if (response.data.ok !== true) {
        if (response.data.moderation_status === 'rejected') {
          const rejectedMessage = `Problem contains inappropriate content and was not published.${response.data.review_reason ? ` ${response.data.review_reason}` : ''}`
          setSubmitMessage(
            rejectedMessage,
          )
        } else {
          setSubmitMessage(
            `Could not submit problem.${response.data.error ? ` ${response.data.error}` : ''}`,
          )
        }
        setIsSubmitting(false)
        return
      }

      submittedProblemId =
        typeof response.data.problem_id === 'string'
          ? response.data.problem_id
          : null
      backendModerationStatus =
        response.data.moderation_status === 'approved' ||
        response.data.moderation_status === 'pending' ||
        response.data.moderation_status === 'rejected'
          ? response.data.moderation_status
          : null
      backendReviewReason =
        typeof response.data.review_reason === 'string'
          ? response.data.review_reason
          : ''

    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const responseData = error.response.data as
          | {
              error?: string
              moderation_status?: string
              review_reason?: string
            }
          | undefined
        const detail = responseData?.error || responseData?.review_reason

        if (error.response.status === 401) {
          setSubmitMessage(
            'Your login session could not be verified. Sign out, sign in again, and retry.',
          )
        } else if (responseData?.moderation_status === 'rejected') {
          setSubmitMessage(
            `Problem was not published.${detail ? ` ${detail}` : ''}`,
          )
        } else {
          setSubmitMessage(
            `Could not submit problem.${detail ? ` ${detail}` : ''}`,
          )
        }
      } else if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        setSubmitMessage(
          'Content moderation took too long. Please retry in a moment.',
        )
      } else {
        setSubmitMessage(
          'Could not submit problem because the network or authentication service did not respond.',
        )
      }
      setIsSubmitting(false)
      return
    }

    if (submittedProblemId && selectedPdfFile) {
      try {
        const contentBase64 = await fileToBase64(selectedPdfFile)
        const attachmentUploadResponse = await fastapi.post<{
          ok?: boolean
          error?: string
          moderation_status?: 'approved' | 'pending' | 'rejected'
          review_reason?: string
        }>(
          `/community/problems/${encodeURIComponent(submittedProblemId)}/attachments`,
          {
            file_name: selectedPdfFile.name,
            file_type: selectedPdfFile.type || 'application/pdf',
            content_base64: contentBase64,
          },
        )
        if (attachmentUploadResponse.data.ok !== true) {
          const rejectReason =
            typeof attachmentUploadResponse.data.review_reason === 'string'
              ? attachmentUploadResponse.data.review_reason
              : ''
          const backendError =
            typeof attachmentUploadResponse.data.error === 'string'
              ? attachmentUploadResponse.data.error
              : ''
          const rejectMessage = backendError
            ? `${backendError}${rejectReason ? ` ${rejectReason}` : ''}`
            : rejectReason
              ? `Problem contains inappropriate content in attached PDF and was not published. ${rejectReason}`
              : 'Problem contains inappropriate content in attached PDF and was not published.'
          backendModerationStatus = 'rejected'
          backendReviewReason = rejectReason
          setSubmitMessage(rejectMessage)
          setShowNewProblemForm(false)
          setNewTitle('')
          setNewDescription('')
          setNewDifficulty(null)
          setPdfFilename('')
          setSelectedPdfFile(null)
          void fetchProblems()
          setIsSubmitting(false)
          return
        }
      } catch {
        setSubmitMessage('Problem submitted, but attachment upload failed.')
        setIsSubmitting(false)
        return
      }
    }

    if (!isAdmin) {
      incrementTotalDailyCount(user.id, todayKey)
      if (pdfFilename.trim().length > 0) {
        incrementPdfDailyCount(user.id, todayKey)
      }
    }

    if (isAdmin) {
      setSubmitMessage('Problem published (admin unlimited mode).')
    } else if (backendModerationStatus === 'pending') {
      setSubmitMessage(
        backendReviewReason
          ? `Problem submitted. Pending moderation. ${backendReviewReason}`
          : 'Problem submitted. Pending moderation.',
      )
    } else if (backendModerationStatus === 'approved') {
      setSubmitMessage('Problem approved and published.')
    } else {
      setSubmitMessage(
        backendReviewReason
          ? `Problem submitted. ${backendReviewReason}`
          : 'Problem submitted.',
      )
    }
    setShowNewProblemForm(false)
    setNewTitle('')
    setNewDescription('')
    setNewDifficulty(null)
    setPdfFilename('')
    setSelectedPdfFile(null)
    void fetchProblems()
    setIsSubmitting(false)
  }

  const handleAddSolution = (problem: CommunityProblem) => {
    if (user === null) {
      setSubmitMessage('Login required to add a solution.')
      return
    }

    setProblemCard({
      description: problem.description,
      inputs: '',
      outputs: '',
      constraints: '',
    })
    setProblemAttachmentText('')
    setProblemAttachmentPreviewUrl(null)
    setIsProblemCardCollapsed(false)
    setPseudocode('')
    setGeneratedCode('')
    setOutput(null)
    setOutputStatus('empty')
    setLineMapping({})
    setActivePseudoLine(null)
    setActiveCodeLine(null)
    setCurrentProject(null)
    setSolutionTargetProblem({ id: problem.id, title: problem.title })
    void (async () => {
      const attachmentContext = await fetchCommunityProblemPdfContext(problem.id)
      if (attachmentContext.text.trim()) {
        setProblemAttachmentText(attachmentContext.text)
      }
      if (attachmentContext.previewUrl) {
        setProblemAttachmentPreviewUrl(attachmentContext.previewUrl)
      }
    })()
    navigate('/')
  }

  const canManageSolution = (solution: CommunitySolution) =>
    user !== null && solution.author_id === user.id

  const handleVote = async (vote: 'up' | 'down') => {
    if (!selectedProblem) return
    if (isVoting) return
    if (!user) {
      setSubmitMessage('Login required to vote on problems.')
      return
    }
    const previousVote = myVote
    const nextVote = previousVote === vote ? null : vote
    const upvoteDelta = nextVote === 'up' ? 1 : previousVote === 'up' ? -1 : 0
    const downvoteDelta = nextVote === 'down' ? 1 : previousVote === 'down' ? -1 : 0
    const optimistic = {
      ...selectedProblem,
      upvoteCount: Math.max(0, selectedProblem.upvoteCount + upvoteDelta),
      downvoteCount: Math.max(0, selectedProblem.downvoteCount + downvoteDelta),
    }
    setMyVote(nextVote)
    setSelectedProblem(optimistic)
    setProblems((current) => current.map((problem) => String(problem.id) === String(optimistic.id) ? optimistic : problem))
    setIsVoting(true)
    try {
      const response = await fastapi.post<{ upvotes: number; downvotes: number }>(
        `/community/problems/${encodeURIComponent(String(selectedProblem.id))}/vote`,
        { vote },
      )
      const next = {
        ...optimistic,
        upvoteCount: Number(response.data.upvotes) || 0,
        downvoteCount: Number(response.data.downvotes) || 0,
      }
      setMyVote(nextVote)
      setSelectedProblem(next)
      setProblems((current) => current.map((problem) => String(problem.id) === String(next.id) ? next : problem))
    } catch {
      setMyVote(previousVote)
      setSelectedProblem(selectedProblem)
      setProblems((current) => current.map((problem) => String(problem.id) === String(selectedProblem.id) ? selectedProblem : problem))
      setSubmitMessage('Could not record your vote right now.')
    } finally {
      setIsVoting(false)
    }
  }

  const handleReport = async () => {
    if (!selectedProblem || !reportReason.trim()) return
    setIsReporting(true)
    try {
      await fastapi.post('/community/report', {
        problem_id: String(selectedProblem.id),
        reason: reportReason.trim(),
      })
      setReportReason('')
      setSubmitMessage('Report submitted for review.')
    } catch {
      setSubmitMessage('Could not submit the report right now.')
    } finally {
      setIsReporting(false)
    }
  }

  const handleCopyProblemLink = async () => {
    if (!selectedProblem) return
    const link = `${window.location.origin}/problem/${selectedProblem.id}`
    try {
      await navigator.clipboard.writeText(link)
      setSubmitMessage('Problem link copied.')
    } catch {
      setSubmitMessage(link)
    }
  }

  const handleStartEditSolution = (solution: CommunitySolution) => {
    if (!canManageSolution(solution)) {
      return
    }
    setEditingSolutionId(String(solution.id))
    setEditingSolutionText(solution.pseudocode)
    setExpandedUserSolutions((current) => ({
      ...current,
      [String(solution.id)]: true,
    }))
  }

  const handleSaveEditedSolution = async () => {
    if (!editingSolutionId) {
      return
    }
    if (!editingSolutionText.trim()) {
      return
    }

    try {
      const response = await fastapi.post<{ ok?: boolean; error?: string }>(
        '/community/update-solution',
        {
          solution_id: editingSolutionId,
          pseudocode: editingSolutionText.trim(),
          author_id: user?.id ?? null,
        },
      )

      if (response.data.ok !== true) {
        setSubmitMessage(
          `Could not update solution.${response.data.error ? ` ${response.data.error}` : ''}`,
        )
        return
      }

      setSolutions((current) =>
        current.map((solution) =>
          String(solution.id) === editingSolutionId
            ? {
                ...solution,
                pseudocode: editingSolutionText.trim(),
                created_at: new Date().toISOString(),
              }
            : solution,
        ),
      )
      setEditingSolutionId(null)
      setEditingSolutionText('')
    } catch {
      setSubmitMessage('Could not update solution. Backend not reachable.')
    }
  }

  const handleDeleteSolution = async (solutionId: string) => {
    try {
      const response = await fastapi.post<{ ok?: boolean; error?: string }>(
        '/community/delete-solution',
        {
          solution_id: solutionId,
          author_id: user?.id ?? null,
        },
      )

      if (response.data.ok !== true) {
        setSubmitMessage(
          `Could not delete solution.${response.data.error ? ` ${response.data.error}` : ''}`,
        )
        return
      }

      setSolutions((current) =>
        current.filter((solution) => String(solution.id) !== solutionId),
      )
      setPendingDeleteSolutionId(null)
      if (editingSolutionId === solutionId) {
        setEditingSolutionId(null)
        setEditingSolutionText('')
      }
    } catch {
      setSubmitMessage('Could not delete solution. Backend not reachable.')
    }
  }

  return (
    <div
      style={{
        height: 'calc(100vh - 72px)',
        width: '100%',
        minWidth: 0,
        padding: '8px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        color: '#ffffff',
      }}
    >
      <div className="terminal-panel panel" style={{ flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div className="terminal-label">[ Community ]</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="terminal-button"
              onClick={() => navigate('/my-submissions')}
            >
              [ My Submissions ]
            </button>
            <button
              type="button"
              className="terminal-button"
              disabled={user === null}
              title={user === null ? 'Login required' : undefined}
              style={user === null ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
              onClick={() => {
                if (user === null) {
                  setSubmitMessage('Login required to submit community problems.')
                  return
                }
                setSubmitMessage(null)
                setShowNewProblemForm(true)
              }}
            >
              [ + New Problem ]
            </button>
          </div>
        </div>

        {submitMessage && !showNewProblemForm && (
          <div
            style={{
              color:
                submitMessage.toLowerCase().includes('failed') ||
                submitMessage.toLowerCase().includes('limit') ||
                submitMessage.toLowerCase().includes('rejected') ||
                submitMessage.toLowerCase().includes('could not')
                  ? '#ff6b6b'
                  : '#7ed957',
              fontSize: '14px',
              marginBottom: '10px',
            }}
          >
            {submitMessage}
          </div>
        )}

        {selectedProblem ? (
          <div
            className="panel-scroll panel-content"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              overflowY: 'auto',
              flex: 1,
              minHeight: 0,
            }}
          >
            <button
              type="button"
              className="terminal-button"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setSelectedProblem(null)
                navigate('/community')
                setSolutions([])
                setAiSolution(null)
                setExpandedAiSolution(false)
                setExpandedUserSolutions({})
                setEditingSolutionId(null)
                setEditingSolutionText('')
                setPendingDeleteSolutionId(null)
              }}
            >
              [ ← Back ]
            </button>
            {user ? (
              <button
                type="button"
                className="terminal-button"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => handleAddSolution(selectedProblem)}
              >
                [ Add Solution ]
              </button>
            ) : (
              <button
                type="button"
                className="terminal-button"
                style={{ alignSelf: 'flex-start', opacity: 0.6, cursor: 'not-allowed' }}
                disabled
                title="Login required"
              >
                [ Login Required To Add Solution ]
              </button>
            )}

            <div style={{ fontSize: '22px', color: '#ffffff' }}>{selectedProblem.title}</div>
            <div
              className={`difficulty-badge difficulty-${selectedProblem.difficulty}`}
              style={{ fontSize: '13px' }}
            >
              {selectedProblem.difficulty.toUpperCase()}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="terminal-button" disabled={isVoting} onClick={() => void handleVote('up')}>
                <span style={{ color: myVote === 'up' ? '#7ed957' : undefined }}>[ ▲ {selectedProblem.upvoteCount} ]</span>
              </button>
              <button type="button" className="terminal-button" disabled={isVoting} onClick={() => void handleVote('down')}>
                <span style={{ color: myVote === 'down' ? '#ff6b6b' : undefined }}>[ ▼ {selectedProblem.downvoteCount} ]</span>
              </button>
              <button type="button" className="terminal-button" onClick={() => void handleCopyProblemLink()}>
                [ Copy Link ]
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
                placeholder="Report reason..."
                aria-label="Report reason"
                style={{ flex: '1 1 260px', minWidth: 0, height: '44px', boxSizing: 'border-box', padding: '8px 10px', font: 'inherit', color: '#ffffff', background: '#43464f', border: '2px solid #ababb6', borderRadius: '4px' }}
              />
              <button type="button" className="terminal-button" disabled={isReporting || !reportReason.trim()} style={{ height: '44px', boxSizing: 'border-box' }} onClick={() => void handleReport()}>
                {isReporting ? '[ Reporting... ]' : '[ Report ]'}
              </button>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', color: '#ffffff', fontSize: '14px' }}>
              {selectedProblem.description}
            </div>

            {(isLoadingAttachments || attachmentPdfUrl || attachmentsError) && (
              <div
                className="interactive-hover-card"
                style={{
                  marginTop: '12px',
                  border: '2px solid #ababb6',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: '#ffffff',
                }}
              >
                <button
                  type="button"
                  style={{
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    color: '#ffffff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onClick={() => {
                    setExpandedAttachmentPreview((current) => !current)
                  }}
                >
                  <div style={{ fontSize: '14px' }}>📎 File Attached</div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                    {expandedAttachmentPreview ? 'Collapse ▲' : 'Expand ▼'}
                  </div>
                </button>

                {expandedAttachmentPreview && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', padding: '10px' }}>
                    {isLoadingAttachments && (
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
                        Loading attached file...
                      </div>
                    )}
                    {!isLoadingAttachments && attachmentsError && (
                      <div style={{ color: '#ff6b6b', fontSize: '13px' }}>
                        {attachmentsError}
                      </div>
                    )}
                    {!isLoadingAttachments && !attachmentsError && !attachmentPdfUrl && (
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
                        No attached PDF.
                      </div>
                    )}
                    {!isLoadingAttachments && !attachmentsError && attachmentPdfUrl && (
                      <div
                        style={{
                          border: '2px solid #ababb6',
                          borderRadius: '8px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            padding: '8px 10px',
                            borderBottom: '1px solid rgba(255,255,255,0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            flexWrap: 'nowrap',
                          }}
                        >
                          <span style={{ color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap', lineHeight: 1 }}>
                            [ Attached File ]
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '11px', minWidth: '52px', textAlign: 'right' }}>
                              {Math.round(attachmentPreviewZoom * 100)}%
                            </span>
                            <button
                              type="button"
                              className="terminal-button"
                              style={{ padding: '4px 8px', fontSize: '12px', minWidth: '44px', whiteSpace: 'nowrap', lineHeight: 1 }}
                              onClick={() =>
                                setAttachmentPreviewZoom((current) => Math.max(0.5, current - 0.15))
                              }
                            >
                              [ - ]
                            </button>
                            <button
                              type="button"
                              className="terminal-button"
                              style={{ padding: '4px 8px', fontSize: '12px', minWidth: '44px', whiteSpace: 'nowrap', lineHeight: 1 }}
                              onClick={() =>
                                setAttachmentPreviewZoom((current) => Math.min(2.5, current + 0.15))
                              }
                            >
                              [ + ]
                            </button>
                            <button
                              type="button"
                              className="terminal-button"
                              style={{ padding: '4px 8px', fontSize: '12px', whiteSpace: 'nowrap', lineHeight: 1 }}
                              onClick={() => {
                                window.open(attachmentPdfUrl, '_blank', 'noopener,noreferrer')
                              }}
                            >
                              [ Maximize ]
                            </button>
                          </div>
                        </div>
                        <div
                          ref={attachmentPreviewViewportRef}
                          className="panel-scroll"
                          style={{
                            width: '100%',
                            height: `${attachmentPreviewHeight}px`,
                            background: '#ffffff',
                            overflowY: 'auto',
                            overflowX: 'auto',
                            padding: '8px',
                          }}
                        >
                          {isRenderingAttachmentPreview ? (
                            <div style={{ color: '#43464f', fontSize: '13px' }}>
                              Rendering preview...
                            </div>
                          ) : attachmentPreviewError ? (
                            <iframe
                              src={attachmentPdfUrl}
                              title="Attached PDF preview"
                              style={{ width: '100%', height: '100%', minHeight: '320px', border: 0, background: '#ffffff' }}
                            />
                          ) : attachmentPreviewPages.length === 0 ? (
                            <div style={{ color: '#43464f', fontSize: '13px' }}>
                              No preview available.
                            </div>
                          ) : (
                            attachmentPreviewPages.map((page, index) => (
                              <img
                                key={`community-attachment-page-${index + 1}`}
                                src={page.src}
                                alt={`Attached file page ${index + 1}`}
                                style={{
                                  display: 'block',
                                  width: `${Math.max(1, Math.floor(page.width * attachmentPreviewZoom))}px`,
                                  maxWidth: 'none',
                                  height: 'auto',
                                  margin: '0 auto 8px',
                                  border: '1px solid #d3d3d3',
                                  imageRendering: 'auto',
                                }}
                              />
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: '10px', fontSize: '18px', color: '#ffffff' }}>
              Solutions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                className="interactive-hover-card ai-solution-row"
                onClick={() => setExpandedAiSolution((current) => !current)}
                style={{
                  border: '2px solid #ababb6',
                  borderRadius: '8px',
                  padding: '10px',
                  display: 'block',
                  width: '100%',
                  overflow: 'visible',
                  background: 'transparent',
                  color: '#ffffff',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <div className="ai-label accent-green" style={{ color: '#7ed957', fontSize: '14px' }}>
                    ✦ AI Solution
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                    {isLoadingAiSolution ? 'Loading...' : expandedAiSolution ? 'Collapse ▲' : 'Expand ▼'}
                  </div>
                </div>
                {expandedAiSolution && (
                  <pre
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    style={{
                      margin: '10px 0 0',
                      // Keep long generated answers inside the card while allowing
                      // the reader to scroll through the complete solution.
                      maxHeight: '50vh',
                      overflowY: 'auto',
                      overflowX: 'auto',
                      minHeight: 0,
                      overscrollBehavior: 'contain',
                      padding: '2px 8px 8px 0',
                      whiteSpace: 'pre-wrap',
                      color: '#ffffff',
                      fontSize: '13px',
                      userSelect: 'text',
                      WebkitUserSelect: 'text',
                      cursor: 'text',
                    }}
                  >
                    {isLoadingAiSolution ? 'Loading AI solution...' : (aiSolution ?? '// Could not generate solution')}
                  </pre>
                )}
              </button>

              {isLoadingUserSolutions ? (
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                  Loading user solutions...
                </div>
              ) : solutions.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                  No user solutions yet.
                </div>
              ) : (
                solutions.map((solution) => {
                  const key = String(solution.id)
                  const isExpanded = expandedUserSolutions[key] === true
                  const isEditing = editingSolutionId === key
                  const canManage = canManageSolution(solution)
                  const wantsDeleteConfirm = pendingDeleteSolutionId === key
                  return (
                    <div
                      key={solution.id}
                      className="interactive-hover-card user-solution-row"
                      style={{
                        border: '2px solid #ababb6',
                        borderRadius: '8px',
                        padding: '10px',
                        background: 'transparent',
                        color: '#ffffff',
                        textAlign: 'left',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: '8px',
                          alignItems: 'center',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedUserSolutions((current) => ({
                              ...current,
                              [key]: !isExpanded,
                            }))
                          }
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#ffffff',
                            fontSize: '14px',
                            cursor: 'pointer',
                            padding: 0,
                            textAlign: 'left',
                          }}
                        >
                          👤 User Solution
                        </button>
                        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                          {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
                        </div>
                      </div>
                      <div style={{ marginTop: '4px', color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                        {solution.author_id ?? 'User'} · {new Date(solution.created_at).toLocaleString()}
                      </div>
                      {canManage && (
                        <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="terminal-button"
                            style={{ fontSize: '13px', padding: '6px 10px' }}
                            onClick={() => {
                              if (isEditing) {
                                setEditingSolutionId(null)
                                setEditingSolutionText('')
                                return
                              }
                              handleStartEditSolution(solution)
                            }}
                          >
                            {isEditing ? '[ Cancel Edit ]' : '[ Edit ]'}
                          </button>
                          {!wantsDeleteConfirm ? (
                            <button
                              type="button"
                              className="terminal-button"
                              style={{ fontSize: '13px', padding: '6px 10px' }}
                              onClick={() => setPendingDeleteSolutionId(key)}
                            >
                              [ Delete ]
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="terminal-button"
                                style={{ fontSize: '13px', padding: '6px 10px', borderColor: '#ff6b6b', color: '#ff6b6b' }}
                                onClick={() => {
                                  void handleDeleteSolution(key)
                                }}
                              >
                                [ Confirm Delete ]
                              </button>
                              <button
                                type="button"
                                className="terminal-button"
                                style={{ fontSize: '13px', padding: '6px 10px' }}
                                onClick={() => setPendingDeleteSolutionId(null)}
                              >
                                [ Cancel ]
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {isEditing && (
                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <textarea
                            value={editingSolutionText}
                            onChange={(event) => setEditingSolutionText(event.target.value)}
                            rows={6}
                            style={{
                              width: '100%',
                              background: 'transparent',
                              border: '1px solid rgba(255,255,255,0.35)',
                              borderRadius: '4px',
                              color: '#ffffff',
                              padding: '8px',
                              resize: 'vertical',
                              outline: 'none',
                              fontSize: '13px',
                            }}
                          />
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="terminal-button"
                              style={{ fontSize: '13px', padding: '6px 10px' }}
                              onClick={() => {
                                void handleSaveEditedSolution()
                              }}
                            >
                              [ Save ]
                            </button>
                            <button
                              type="button"
                              className="terminal-button"
                              style={{ fontSize: '13px', padding: '6px 10px' }}
                              onClick={() => {
                                setEditingSolutionId(null)
                                setEditingSolutionText('')
                              }}
                            >
                              [ Cancel ]
                            </button>
                          </div>
                        </div>
                      )}
                      {isExpanded && (
                        <pre
                          style={{
                            margin: '10px 0 0',
                            whiteSpace: 'pre-wrap',
                            color: '#ffffff',
                            fontSize: '13px',
                          }}
                        >
                          {solution.pseudocode}
                        </pre>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((difficulty) => {
                const isActive = selectedDifficulty === difficulty
                return (
                  <button
                    key={difficulty}
                    type="button"
                    className="terminal-button"
                    onClick={() => {
                      setSelectedDifficulty((current) =>
                        current === difficulty ? null : difficulty,
                      )
                    }}
                    style={{
                      background: isActive ? '#ffffff' : 'transparent',
                      color: isActive ? '#43464f' : '#ffffff',
                    }}
                  >
                    [ {difficulty[0].toUpperCase() + difficulty.slice(1)} ]
                  </button>
                )
              })}
            </div>

            <div className="panel-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {isLoading ? (
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                  Loading community problems...
                </div>
              ) : filteredProblems.length === 0 ? (
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                  No public problems found.
                </div>
              ) : (
                <div
                  className="panel-content"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: '12px',
                    paddingRight: '4px',
                  }}
                >
                  {filteredProblems.map((problem) => (
                    <button
                      className="interactive-hover-card community-problem-card"
                      key={problem.id}
                      type="button"
                      onClick={() => {
                        setSelectedProblem(problem)
                        navigate(`/problem/${problem.id}`)
                      }}
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
                      <div style={{ fontSize: '20px', marginBottom: '8px' }}>
                        {problem.title}
                      </div>
                      <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
                        {problem.board}
                      </div>
                      <div
                        className={`difficulty-badge difficulty-${problem.difficulty}`}
                        style={{ fontSize: '13px', marginTop: '10px' }}
                      >
                        {problem.difficulty.toUpperCase()}
                      </div>
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '8px' }}>
                        Solutions: {problem.solutionCount}
                      </div>
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginTop: '6px' }}>
                        ▲ {problem.upvoteCount} · ▼ {problem.downvoteCount}
                      </div>
                      {problem.moderationStatus && problem.moderationStatus !== 'approved' && (
                        <div
                          className={`status-badge status-${problem.moderationStatus}`}
                          style={{
                            fontSize: '12px',
                            marginTop: '8px',
                          }}
                        >
                          {problem.moderationStatus === 'pending'
                            ? 'Pending Review (only visible to you)'
                            : 'Rejected (only visible to you)'}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showNewProblemForm && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1200 }}
          onClick={() => setShowNewProblemForm(false)}
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
              width: '640px',
              maxWidth: '92vw',
              padding: '24px',
            }}
          >
            <div style={{ color: '#ffffff', fontSize: '22px', marginBottom: '12px' }}>
              [ New Problem ]
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Title"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '2px solid #ffffff',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  color: '#ffffff',
                  fontSize: '16px',
                }}
              />
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                rows={6}
                placeholder="Description"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '2px solid #ffffff',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  color: '#ffffff',
                  fontSize: '16px',
                  resize: 'none',
                }}
              />

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(['easy', 'medium', 'hard'] as Difficulty[]).map((difficulty) => {
                  const isActive = newDifficulty === difficulty
                  return (
                    <button
                      key={difficulty}
                      type="button"
                      className="terminal-button"
                      onClick={() => setNewDifficulty(difficulty)}
                      style={{
                        background: isActive ? '#ffffff' : 'transparent',
                        color: isActive ? '#43464f' : '#ffffff',
                      }}
                    >
                      [ {difficulty[0].toUpperCase() + difficulty.slice(1)} ]
                    </button>
                  )
                })}
              </div>

              <select
                value={newBoard}
                onChange={(event) => setNewBoard(event.target.value)}
                style={{
                  background: 'transparent',
                  border: '2px solid #ffffff',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  color: '#ffffff',
                  fontSize: '16px',
                }}
              >
                {boardOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label className="terminal-button" style={{ cursor: 'pointer' }}>
                  [ Upload PDF ]
                  <input
                    type="file"
                    accept=".pdf"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file && file.size > MAX_PDF_BYTES) {
                        setSubmitMessage('PDF must be 10 MB or smaller.')
                        setPdfFilename('')
                        setSelectedPdfFile(null)
                        event.currentTarget.value = ''
                        return
                      }
                      if (file && file.type && file.type !== 'application/pdf') {
                        setSubmitMessage('Only PDF files are supported.')
                        setPdfFilename('')
                        setSelectedPdfFile(null)
                        event.currentTarget.value = ''
                        return
                      }
                      setSubmitMessage(null)
                      setPdfFilename(file?.name ?? '')
                      setSelectedPdfFile(file ?? null)
                    }}
                  />
                </label>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '13px' }}>
                  (optional)
                </div>
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
                  {pdfFilename || 'No file selected'}
                </div>
              </div>

              {submitMessage && (
                <div
                  style={{
                    color:
                      submitMessage.toLowerCase().includes('failed') ||
                      submitMessage.toLowerCase().includes('limit') ||
                      submitMessage.toLowerCase().includes('rejected') ||
                      submitMessage.toLowerCase().includes('could not')
                        ? '#ff6b6b'
                        : '#7ed957',
                    fontSize: '13px',
                  }}
                >
                  {submitMessage}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="terminal-button"
                  disabled={isSubmitting}
                  onClick={() => setShowNewProblemForm(false)}
                >
                  [ Cancel ]
                </button>
                <button
                  type="button"
                  className="terminal-button"
                  disabled={isSubmitting}
                  onClick={() => {
                    void handleSubmitProblem()
                  }}
                >
                  {isSubmitting ? '[ Submitting... ]' : '[ Submit ]'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CommunityPage

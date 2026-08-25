import { useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { fastapi } from '../../api/fastapi'
import { fetchCommunityProblemPdfContext } from '../../lib/communityAttachments'
import { useEditorStore, type ProblemCard } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

type Difficulty = 'easy' | 'medium' | 'hard'
type PanelMode = 'default' | 'type' | 'browse-list' | 'browse-detail'

interface CommunityProblemItem {
  id: number | string
  title: string
  description: string
  difficulty: Difficulty
  board: string
  language: string
}


const emptyForm: ProblemCard = {
  description: '',
  inputs: '',
  outputs: '',
  constraints: '',
}

GlobalWorkerOptions.workerSrc = pdfWorker

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

function ProblemPanel() {
  const problemCard = useEditorStore((state) => state.problemCard)
  const setProblemCard = useEditorStore((state) => state.setProblemCard)
  const setIsProblemCardCollapsed = useEditorStore(
    (state) => state.setIsProblemCardCollapsed,
  )
  const setProblemAttachmentText = useEditorStore(
    (state) => state.setProblemAttachmentText,
  )
  const problemAttachmentPreviewUrl = useEditorStore(
    (state) => state.problemAttachmentPreviewUrl,
  )
  const setProblemAttachmentPreviewUrl = useEditorStore(
    (state) => state.setProblemAttachmentPreviewUrl,
  )
  const board = useSettingsStore((state) => state.board)

  const [mode, setMode] = useState<PanelMode>('default')
  const [form, setForm] = useState<ProblemCard>(emptyForm)
  const [focusedField, setFocusedField] = useState<string | null>(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(
    null,
  )
  const [communityProblems, setCommunityProblems] = useState<CommunityProblemItem[]>(
    [],
  )
  const [selectedProblem, setSelectedProblem] = useState<CommunityProblemItem | null>(
    null,
  )
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(false)
  const [communityError, setCommunityError] = useState<string | null>(null)
  const [pdfPreviewZoom, setPdfPreviewZoom] = useState(1)
  const [renderedPdfPages, setRenderedPdfPages] = useState<
    Array<{ src: string; width: number }>
  >([])
  const [isRenderingPdfPreview, setIsRenderingPdfPreview] = useState(false)
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null)
  const previewViewportRef = useRef<HTMLDivElement | null>(null)

  const isComplete = useMemo(
    () => form.description.trim().length >= 10,
    [form.description],
  )

  useEffect(() => {
    if (!problemCard) {
      return
    }
    if (mode !== 'default') {
      return
    }

    setForm({
      description: problemCard.description,
      inputs: problemCard.inputs,
      outputs: problemCard.outputs,
      constraints: problemCard.constraints,
    })
    setMode('type')
  }, [mode, problemCard])

  useEffect(() => {
    const handleEditorReset = () => {
      setMode('default')
      setForm(emptyForm)
      setFocusedField(null)
      setSelectedDifficulty(null)
      setCommunityProblems([])
      setSelectedProblem(null)
      setIsLoadingCommunity(false)
      setCommunityError(null)
    }

    window.addEventListener('pw-editor-reset', handleEditorReset)

    return () => {
      window.removeEventListener('pw-editor-reset', handleEditorReset)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'type' || !isComplete) {
      return
    }

    const debounceTimer = window.setTimeout(() => {
      setProblemCard({
        description: form.description.trim(),
        inputs: '',
        outputs: '',
        constraints: '',
      })
      setProblemAttachmentText('')
      setIsProblemCardCollapsed(false)
    }, 500)

    return () => {
      window.clearTimeout(debounceTimer)
    }
  }, [
    form.description,
    isComplete,
    mode,
    setIsProblemCardCollapsed,
    setProblemAttachmentText,
    setProblemCard,
  ])

  useEffect(() => {
    if (mode !== 'type' || !isComplete || focusedField) {
      return
    }

    const collapseTimer = window.setTimeout(() => {
      setIsProblemCardCollapsed(true)
    }, 2000)

    return () => {
      window.clearTimeout(collapseTimer)
    }
  }, [focusedField, isComplete, mode, setIsProblemCardCollapsed])

  useEffect(() => {
    setPdfPreviewZoom(1)
  }, [problemAttachmentPreviewUrl])

  const filteredCommunityProblems = useMemo(() => {
    if (selectedDifficulty === null) {
      return communityProblems
    }
    return communityProblems.filter(
      (problem) => problem.difficulty === selectedDifficulty,
    )
  }, [communityProblems, selectedDifficulty])

  useEffect(() => {
    let cancelled = false

    const renderPreview = async () => {
      if (!problemAttachmentPreviewUrl) {
        setRenderedPdfPages([])
        setPdfPreviewError(null)
        setIsRenderingPdfPreview(false)
        return
      }

      setIsRenderingPdfPreview(true)
      setPdfPreviewError(null)
      setRenderedPdfPages([])

      try {
        const requestPath = problemAttachmentPreviewUrl.replace(/^\/api(?=\/)/, '')
        const fileResponse = await fastapi.get<ArrayBuffer>(requestPath, {
          responseType: 'arraybuffer',
        })
        const buffer = toArrayBuffer(fileResponse.data)
        if (!buffer) {
          throw new Error('Could not read PDF data.')
        }

        const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise
        const maxPages = Math.min(pdf.numPages, 20)
        const pageImages: Array<{ src: string; width: number }> = []
        const containerWidth = Math.max(
          360,
          (previewViewportRef.current?.clientWidth ?? 600) - 24,
        )

        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          const page = await pdf.getPage(pageNumber)
          const baseViewport = page.getViewport({ scale: 1 })
          const fitWidthScale = containerWidth / baseViewport.width
          const finalScale = Math.max(0.35, fitWidthScale)
          const viewport = page.getViewport({ scale: finalScale })
          const devicePixelRatio =
            typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
          const renderScale = Math.min(3, Math.max(1, devicePixelRatio * 1.5))

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
        }

        if (cancelled) {
          return
        }

        setRenderedPdfPages(pageImages)
      } catch {
        if (cancelled) {
          return
        }
        setPdfPreviewError('Could not render attached file preview.')
      } finally {
        if (!cancelled) {
          setIsRenderingPdfPreview(false)
        }
      }
    }

    void renderPreview()

    return () => {
      cancelled = true
    }
  }, [problemAttachmentPreviewUrl])

  const fetchCommunityProblems = async () => {
    setIsLoadingCommunity(true)
    setCommunityError(null)
    try {
      // Use backend API (service key) — works for all users including anonymous
      const response = await fastapi.get<{ problems: Record<string, unknown>[] }>(
        '/community/problems',
        { params: { board, limit: 100 } },
      )
      console.log('community fetch result:', response.data, null)

      const rawProblems = (response.data.problems ?? []).filter((problem) => {
        const moderationStatusRaw =
          typeof problem.moderation_status === 'string'
            ? problem.moderation_status
            : typeof problem.status === 'string'
              ? problem.status
              : 'approved'
        return moderationStatusRaw.toLowerCase() !== 'rejected'
      })

      const mapped = rawProblems.map((problem) => ({
        id:
          typeof problem.id === 'string' || typeof problem.id === 'number'
            ? problem.id
            : Date.now(),
        title: typeof problem.title === 'string' ? problem.title : 'Untitled',
        description: typeof problem.description === 'string' ? problem.description : '',
        difficulty:
          problem.difficulty === 'easy' ||
          problem.difficulty === 'medium' ||
          problem.difficulty === 'hard'
            ? (problem.difficulty as Difficulty)
            : 'easy',
        board: typeof problem.board === 'string' ? problem.board : '',
        language: typeof problem.language === 'string' ? problem.language : '',
      })) as CommunityProblemItem[]

      setCommunityProblems(mapped)
    } catch (err) {
      console.log('community fetch result:', null, err)
      setCommunityError('Could not load community problems.')
    } finally {
      setIsLoadingCommunity(false)
    }
  }

  const handleLoadCommunityProblem = async (problem: CommunityProblemItem) => {
    setProblemCard({
      description: problem.description,
      inputs: '',
      outputs: '',
      constraints: '',
    })
    setProblemAttachmentText('')
    setProblemAttachmentPreviewUrl(null)
    setIsProblemCardCollapsed(false)
    setMode('default')
    setSelectedProblem(null)

    const attachmentContext = await fetchCommunityProblemPdfContext(problem.id)
    if (attachmentContext.text.trim()) {
      setProblemAttachmentText(attachmentContext.text)
    }
    if (attachmentContext.previewUrl) {
      setProblemAttachmentPreviewUrl(attachmentContext.previewUrl)
    }
  }

  return (
    <section
      className="terminal-panel panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div className="terminal-label">[ Problem ]</div>
      <div className="terminal-cursor" style={{ marginTop: '8px', marginBottom: '16px' }}>
        {'>'}
      </div>

      {mode === 'default' && (
        <div className="problem-empty">
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm)
              setProblemAttachmentPreviewUrl(null)
              setMode('type')
            }}
            className="terminal-button"
          >
            [ TYPE IN A PROBLEM ]
          </button>
          <button
            type="button"
            className="terminal-button"
            onClick={() => {
              setSelectedDifficulty(null)
              setSelectedProblem(null)
              setMode('browse-list')
              void fetchCommunityProblems()
            }}
          >
            [ BROWSE COMMUNITY PROBLEMS → ]
          </button>
        </div>
      )}

      {mode === 'type' && (
        <div
          className={`panel-content ${problemAttachmentPreviewUrl ? '' : 'panel-scroll'}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            flex: 1,
            minHeight: 0,
            overflowY: problemAttachmentPreviewUrl ? 'hidden' : 'auto',
          }}
        >
          <button
            type="button"
            className="terminal-button"
            style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
            onClick={() => {
              setForm(emptyForm)
              setProblemCard(null)
              setProblemAttachmentText('')
              setProblemAttachmentPreviewUrl(null)
              setIsProblemCardCollapsed(false)
              setMode('default')
            }}
          >
            [ ← Back ]
          </button>

          <textarea
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
                inputs: '',
                outputs: '',
                constraints: '',
              }))
            }
            rows={6}
            placeholder="Describe your problem here... e.g. Write a program that asks for a number and outputs whether it is odd or even"
            onFocus={() => {
              setFocusedField('description')
            }}
            onBlur={() => {
              setFocusedField(null)
            }}
            className="problem-input"
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(255,255,255,0.3)',
              color: '#ffffff',
              fontSize: '16px',
              resize: 'none',
              outline: 'none',
              width: '100%',
              flex: 1,
              minHeight: problemAttachmentPreviewUrl ? '140px' : '240px',
            }}
          />
          <div style={{ marginTop: 'auto' }}>
            {problemAttachmentPreviewUrl && (
              <div
                style={{
                  marginBottom: '10px',
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
                      {Math.round(pdfPreviewZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      className="terminal-button"
                      style={{ padding: '4px 8px', fontSize: '12px', minWidth: '44px', whiteSpace: 'nowrap', lineHeight: 1 }}
                      onClick={() =>
                        setPdfPreviewZoom((current) => Math.max(0.5, current - 0.15))
                      }
                    >
                      [ - ]
                    </button>
                    <button
                      type="button"
                      className="terminal-button"
                      style={{ padding: '4px 8px', fontSize: '12px', minWidth: '44px', whiteSpace: 'nowrap', lineHeight: 1 }}
                      onClick={() =>
                        setPdfPreviewZoom((current) => Math.min(2.5, current + 0.15))
                      }
                    >
                      [ + ]
                    </button>
                    <button
                      type="button"
                      className="terminal-button"
                      style={{ padding: '4px 8px', fontSize: '12px', whiteSpace: 'nowrap', lineHeight: 1 }}
                      onClick={() => {
                        window.open(problemAttachmentPreviewUrl, '_blank', 'noopener,noreferrer')
                      }}
                    >
                      [ Maximize ]
                    </button>
                  </div>
                </div>
                <div
                  ref={previewViewportRef}
                  className="panel-scroll"
                  style={{
                    width: '100%',
                    height: '240px',
                    border: 'none',
                    background: '#ffffff',
                    overflowY: 'auto',
                    overflowX: 'auto',
                    padding: '8px',
                  }}
                >
                  {isRenderingPdfPreview ? (
                    <div style={{ color: '#43464f', fontSize: '13px' }}>
                      Rendering preview...
                    </div>
                  ) : pdfPreviewError ? (
                    <iframe
                      src={problemAttachmentPreviewUrl}
                      title="Attached PDF preview"
                      style={{ width: '100%', height: '100%', minHeight: '220px', border: 0, background: '#ffffff' }}
                    />
                  ) : renderedPdfPages.length === 0 ? (
                    <div style={{ color: '#43464f', fontSize: '13px' }}>
                      No preview available.
                    </div>
                  ) : (
                    renderedPdfPages.map((page, index) => (
                      <img
                        key={`preview-page-${index + 1}`}
                        src={page.src}
                        alt={`Attached file page ${index + 1}`}
                        style={{
                          display: 'block',
                          width: `${Math.max(1, Math.floor(page.width * pdfPreviewZoom))}px`,
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
            {isComplete && (
              <>
                <div
                  className="problem-divider problem-set-line"
                  style={{
                    width: '100%',
                    borderBottom: '1px solid rgba(255,255,255,0.3)',
                  }}
                />
                <div className="accent-green" style={{ color: '#7ed957', fontSize: '13px', marginTop: '8px' }}>✓ Problem set</div>
              </>
            )}
          </div>
        </div>
      )}

      {mode === 'browse-list' && (
        <div
          className="panel-content"
          style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0 }}
        >
          <button
            type="button"
            className="terminal-button"
            style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap' }}
            onClick={() => {
              setSelectedProblem(null)
              setMode('default')
            }}
          >
            [ ← Back ]
          </button>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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

          {isLoadingCommunity ? (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
              Loading community problems...
            </div>
          ) : communityError ? (
            <div style={{ color: '#ff6b6b', fontSize: '14px' }}>{communityError}</div>
          ) : filteredCommunityProblems.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
              No community problems yet.
            </div>
          ) : (
            <div
              className="panel-scroll"
              style={{
                overflowY: 'auto',
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '8px',
                paddingRight: '4px',
                alignContent: 'start',
              }}
            >
              {filteredCommunityProblems.map((problem) => (
                <button
                  className="interactive-hover-card"
                  key={problem.id}
                  type="button"
                  onClick={() => {
                    setSelectedProblem(problem)
                    setMode('browse-detail')
                  }}
                  style={{
                    textAlign: 'left',
                    background: 'transparent',
                    border: '2px solid #ababb6',
                    borderRadius: '8px',
                    color: '#ffffff',
                    padding: '10px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      fontSize: '15px',
                      marginBottom: '6px',
                      lineHeight: 1.2,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {problem.title}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.7)',
                      lineHeight: 1.2,
                    }}
                  >
                    {problem.board}
                  </div>
                  <div
                    className={`difficulty-badge difficulty-${problem.difficulty}`}
                    style={{
                      fontSize: '11px',
                      marginTop: '8px',
                    }}
                  >
                    {problem.difficulty.toUpperCase()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'browse-detail' && selectedProblem && (
        <div className="panel-scroll panel-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <button
              type="button"
              className="terminal-button"
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                setMode('browse-list')
              }}
            >
              [ ← Back ]
            </button>
            <button
              type="button"
              className="terminal-button"
              style={{ whiteSpace: 'nowrap' }}
            onClick={() => {
                void handleLoadCommunityProblem(selectedProblem)
              }}
            >
              [ Load Problem ]
            </button>
          </div>

          <div style={{ fontSize: '20px', color: '#ffffff' }}>
            {selectedProblem.title}
          </div>
          <div
            className={`difficulty-badge difficulty-${selectedProblem.difficulty}`}
            style={{ fontSize: '13px' }}
          >
            {selectedProblem.difficulty.toUpperCase()}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px' }}>
            {selectedProblem.board}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px', color: '#ffffff' }}>
            {selectedProblem.description}
          </div>
        </div>
      )}
    </section>
  )
}

export default ProblemPanel

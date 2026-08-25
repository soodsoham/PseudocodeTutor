import { getHint } from '../../api/hints'
import { useEffect, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useHintStore } from '../../stores/hintStore'
import { useSettingsStore } from '../../stores/settingsStore'

function HintsBar() {
  const problemCard = useEditorStore((state) => state.problemCard)
  const problemAttachmentText = useEditorStore((state) => state.problemAttachmentText)
  const pseudocode = useEditorStore((state) => state.pseudocode)
  const generatedCode = useEditorStore((state) => state.generatedCode)
  const activePseudoLine = useEditorStore((state) => state.activePseudoLine)
  const language = useSettingsStore((state) => state.language)
  const board = useSettingsStore((state) => state.board)
  const currentHint = useHintStore((state) => state.currentHint)
  const isLoading = useHintStore((state) => state.isLoading)
  const setCurrentHint = useHintStore((state) => state.setCurrentHint)
  const setIsLoading = useHintStore((state) => state.setIsLoading)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'student' | 'tutor'; text: string }>>([])

  useEffect(() => {
    setMessages([])
    setQuestion('')
  }, [problemCard?.description, problemCard?.inputs, problemCard?.outputs, problemCard?.constraints])

  const handleGetHint = async (followUp = '') => {
    setIsLoading(true)
    const trimmedQuestion = followUp.trim()
    if (trimmedQuestion) {
      setMessages((previous) => [...previous, { role: 'student', text: trimmedQuestion }])
    }

    try {
      const response = await getHint({
        problem: problemCard?.description ?? '',
        attachment_text: problemCard ? problemAttachmentText : '',
        pseudocode,
        generated_code: generatedCode,
        active_line: activePseudoLine,
        language,
        board,
        question: trimmedQuestion,
        attempt_count: messages.filter((message) => message.role === 'student').length + 1,
        hint_history: messages,
      })

      const hint =
        typeof response?.hint === 'string' && response.hint.trim().length > 0
          ? response.hint
          : 'No hint available yet.'

      setCurrentHint(hint)
      setMessages((previous) => [...previous, { role: 'tutor', text: hint }])
    } catch {
      if (/^\s*INPUT\s+["'][A-Za-z_]\w*["']/im.test(pseudocode)) {
        setCurrentHint('INPUT should name the variable without quotation marks, for example INPUT Num1. Quotation marks are for text displayed by OUTPUT.')
      } else {
        setCurrentHint('Could not get hint. Check the problem and pseudocode, then try again.')
      }
      setMessages((previous) => [...previous, { role: 'tutor', text: currentHint ?? 'Trace the algorithm one line at a time and check the first value that differs from the expected result.' }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section
      className="terminal-panel hint-panel hints-bar"
      style={{ minHeight: '150px', height: 'clamp(150px, 22vh, 240px)' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: '16px',
          alignItems: 'start',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div className="terminal-label" style={{ fontSize: '18px', whiteSpace: 'nowrap' }}>
          [ Hint Bar ]
        </div>
        <div
          className="hint-content panel-content hint-bar-content"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            paddingRight: '4px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div
            className="panel-scroll"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              flex: '1 1 auto',
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              paddingRight: '6px',
            }}
          >
            {messages.length === 0 && currentHint && (
              <div style={{ whiteSpace: 'pre-wrap' }}>{currentHint}</div>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                style={{
                  alignSelf: message.role === 'student' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  padding: '7px 10px',
                  border: '1px solid var(--terminal-border, rgba(255,255,255,0.2))',
                  background: message.role === 'student' ? 'rgba(100,150,255,0.12)' : 'rgba(255,255,255,0.04)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {message.text}
              </div>
            ))}
            {isLoading && <div>Getting a more specific hint...</div>}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const nextQuestion = question.trim()
              if ((!nextQuestion && messages.length > 0) || isLoading) return
              setQuestion('')
              void handleGetHint(nextQuestion)
            }}
            style={{
              display: 'flex',
              gap: '8px',
              marginTop: '10px',
              flex: '0 0 auto',
              position: 'relative',
              zIndex: 2,
              paddingTop: '8px',
              background: '#43464f',
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask what you're stuck on…"
              aria-label="Ask for a hint"
              style={{ flex: 1, minWidth: 0, padding: '8px 10px', font: 'inherit', color: 'inherit', background: '#43464f', border: '1px solid currentColor' }}
            />
            <button type="submit" className="terminal-button" disabled={isLoading} style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>
              {messages.length === 0 ? '[ Get Hint ]' : '[ Ask ]'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

export default HintsBar

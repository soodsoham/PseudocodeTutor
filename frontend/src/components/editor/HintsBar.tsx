import { getHint } from '../../api/hints'
import { useEditorStore } from '../../stores/editorStore'
import { useHintStore } from '../../stores/hintStore'
import { useSettingsStore } from '../../stores/settingsStore'

function HintsBar() {
  const problemCard = useEditorStore((state) => state.problemCard)
  const problemAttachmentText = useEditorStore((state) => state.problemAttachmentText)
  const pseudocode = useEditorStore((state) => state.pseudocode)
  const generatedCode = useEditorStore((state) => state.generatedCode)
  const language = useSettingsStore((state) => state.language)
  const board = useSettingsStore((state) => state.board)
  const currentHint = useHintStore((state) => state.currentHint)
  const isLoading = useHintStore((state) => state.isLoading)
  const setCurrentHint = useHintStore((state) => state.setCurrentHint)
  const setIsLoading = useHintStore((state) => state.setIsLoading)

  const handleGetHint = async () => {
    setIsLoading(true)

    try {
      const response = await getHint({
        problem: problemCard?.description ?? '',
        attachment_text: problemCard ? problemAttachmentText : '',
        pseudocode,
        generated_code: generatedCode,
        language,
        board,
      })

      const hint =
        typeof response?.hint === 'string' && response.hint.trim().length > 0
          ? response.hint
          : 'No hint available yet.'

      setCurrentHint(hint)
    } catch {
      setCurrentHint('Could not get hint. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section
      className="terminal-panel hint-panel hints-bar"
      style={{ height: '80px', minHeight: '80px', maxHeight: '80px' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto minmax(0, 1fr)',
          gap: '16px',
          alignItems: 'center',
          height: '100%',
          minHeight: 0,
        }}
      >
        <div className="terminal-label" style={{ fontSize: '18px', whiteSpace: 'nowrap' }}>
          [ Hint Bar ]
        </div>
        <button
          type="button"
          className="terminal-button"
          onClick={() => {
            void handleGetHint()
          }}
          disabled={isLoading}
          style={{ padding: '8px 14px', fontSize: '16px', height: '44px', whiteSpace: 'nowrap' }}
        >
          [ Get Hint ]
        </button>
        <div
          className="hint-content panel-content hint-bar-content"
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowY: 'auto',
            overflowX: 'hidden',
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            paddingRight: '4px',
          }}
        >
          {isLoading ? 'Getting hint...' : currentHint ?? '—'}
        </div>
      </div>
    </section>
  )
}

export default HintsBar

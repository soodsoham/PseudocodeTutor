import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

function CodePanel() {
  const generatedCode = useEditorStore((state) => state.generatedCode)
  const tier2Errors = useEditorStore((state) => state.tier2Errors)
  const lineMapping = useEditorStore((state) => state.lineMapping)
  const activePseudoLine = useEditorStore((state) => state.activePseudoLine)
  const activeCodeLine = useEditorStore((state) => state.activeCodeLine)
  const setActivePseudoLine = useEditorStore((state) => state.setActivePseudoLine)
  const setActiveCodeLine = useEditorStore((state) => state.setActiveCodeLine)
  const theme = useSettingsStore((state) => state.theme)

  const content =
    tier2Errors.length > 0
      ? '⚠ Translation paused — fix errors above'
      : generatedCode || 'Live translation appears here'

  const codeLines = content.split('\n')
  const highlightedCodeLines = new Set<number>()

  if (activePseudoLine !== null) {
    for (const codeLine of lineMapping[activePseudoLine] ?? []) {
      highlightedCodeLines.add(codeLine)
    }
  }

  if (activeCodeLine !== null) {
    highlightedCodeLines.add(activeCodeLine)
  }

  const getPseudoLineForCodeLine = (codeLineNumber: number) => {
    for (const [pseudoLine, mappedCodeLines] of Object.entries(lineMapping)) {
      if (mappedCodeLines.includes(codeLineNumber)) {
        return Number(pseudoLine)
      }
    }

    return null
  }

  return (
    <section className="terminal-panel panel" style={{ minHeight: '100%' }}>
      <div className="terminal-label">[ Program Code ]</div>
      <div
        className="panel-scroll panel-content"
        style={{ marginTop: '24px', overflowX: 'auto', overflowY: 'auto' }}
      >
        {codeLines.map((line, index) => {
          const lineNumber = index + 1
          const isPending = line.trim() === '⋯'
          const isHighlighted = highlightedCodeLines.has(lineNumber)

          return (
            <div
              className="panel-content code-content"
              key={`${lineNumber}-${line}`}
              onClick={() => {
                setActiveCodeLine(lineNumber)
                setActivePseudoLine(getPseudoLineForCodeLine(lineNumber))
              }}
              style={{
                background: isHighlighted ? (theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,100,0.1)') : 'transparent',
                color:
                  !generatedCode && tier2Errors.length === 0
                    ? theme === 'light'
                      ? '#8a8d96'
                      : 'rgba(255,255,255,0.35)'
                    : isPending
                      ? 'rgba(255,255,255,0.35)'
                      : theme === 'light'
                        ? '#43464f'
                        : '#ffffff',
                cursor: 'pointer',
                fontSize: 'inherit',
                lineHeight: '1.6',
                whiteSpace: 'pre',
                width: 'max-content',
                minWidth: '100%',
              }}
            >
              {line}
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default CodePanel

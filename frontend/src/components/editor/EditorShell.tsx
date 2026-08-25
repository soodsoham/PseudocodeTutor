import CodePanel from './CodePanel'
import HintsBar from './HintsBar'
import OutputPanel from './OutputPanel'
import ProblemPanel from './ProblemPanel'
import PseudocodePanel from './PseudocodePanel'
import { useSettingsStore } from '../../stores/settingsStore'

function EditorShell() {
  const textSize = useSettingsStore((state) => state.textSize)

  return (
    <main className="editor-shell" data-textsize={textSize}>
      <div className="mobile-message">
        <div className="terminal-panel" style={{ justifyContent: 'center', textAlign: 'center' }}>
          Please use a larger screen or tablet.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
        <div className="editor-grid">
          <ProblemPanel />
          <PseudocodePanel />
          <CodePanel />
          <OutputPanel />
        </div>
        <HintsBar />
      </div>
    </main>
  )
}

export default EditorShell

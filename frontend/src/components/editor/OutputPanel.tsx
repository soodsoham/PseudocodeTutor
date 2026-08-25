import { useEffect, useMemo, useRef, useState } from 'react'
import { executeCode } from '../../api/execute'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

type TerminalLine = {
  text: string
  kind: 'stdout' | 'input' | 'error' | 'info'
}

function toStdoutLines(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.trim()) {
    return [] as TerminalLine[]
  }

  return normalized
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => ({ text: line, kind: 'stdout' as const }))
}

function extractInputTargetFromCodeLine(language: string, codeLine: string) {
  const trimmed = codeLine.trim()
  const normalizedLanguage = language.toLowerCase()

  if (normalizedLanguage === 'python') {
    if (!trimmed.includes('input(')) {
      return null
    }
    const match = trimmed.match(/^([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*=\s*.+$/)
    return match ? match[1] : null
  }

  if (normalizedLanguage === 'java') {
    const match = trimmed.match(
      /^(?:\w+\s+)?([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*=\s*.+scanner\.nextLine\(\).*\s*;/,
    )
    return match ? match[1] : null
  }

  if (normalizedLanguage === 'cpp') {
    const match = trimmed.match(/cin\s*>>\s*([A-Za-z_]\w*(?:\[[^\]]+\])?)/)
    return match ? match[1] : null
  }

  if (normalizedLanguage === 'vb') {
    const match = trimmed.match(
      /^(?:Dim\s+)?([A-Za-z_]\w*(?:\[[^\]]+\]|\([^)]+\))?)\b.*=\s*.*(?:Console\.ReadLine|ReadRequired)\(\s*(?:"[^"]*")?\s*\).*\s*$/i,
    )
    return match ? match[1] : null
  }

  return null
}

function inferPromptTarget(
  language: string,
  stderr: string,
  generatedCode: string,
  inputTargets: string[],
  inputCount: number,
) {
  const normalizedLanguage = language.toLowerCase()
  const codeLines = generatedCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const explicitTargetMatch = stderr.match(/EOFError\|([A-Za-z_]\w*(?:\([^)]+\)|\[[^\]]+\])?)/)
  if (explicitTargetMatch) {
    return explicitTargetMatch[1].replace(/\(([^)]+)\)/g, '[$1]')
  }

  if (normalizedLanguage === 'python') {
    const lineMatch = stderr.match(/line\s+(\d+)/i)
    if (lineMatch) {
      const lineNumber = Number(lineMatch[1])
      if (Number.isFinite(lineNumber) && lineNumber >= 1 && lineNumber <= codeLines.length) {
        const target = extractInputTargetFromCodeLine(language, codeLines[lineNumber - 1])
        if (target) {
          return target
        }
      }
    }
  }

  if (normalizedLanguage === 'java') {
    // Java is wrapped into a Main class before execution; current wrapper puts generated
    // main-body code after 7 lines of boilerplate.
    const lineMatch = stderr.match(/Main\.java:(\d+)/i)
    if (lineMatch) {
      const wrappedLineNumber = Number(lineMatch[1])
      const generatedLineNumber = wrappedLineNumber - 7
      if (
        Number.isFinite(generatedLineNumber) &&
        generatedLineNumber >= 1 &&
        generatedLineNumber <= codeLines.length
      ) {
        const target = extractInputTargetFromCodeLine(
          language,
          codeLines[generatedLineNumber - 1],
        )
        if (target) {
          return target
        }
      }
    }
  }

  if (normalizedLanguage === 'vb') {
    const lineMatch = stderr.match(/Main\.vb\s*\((\d+),\s*\d+\)/i)
    if (lineMatch) {
      const wrappedLineNumber = Number(lineMatch[1])
      const generatedLineNumber = wrappedLineNumber - 14
      if (
        Number.isFinite(generatedLineNumber) &&
        generatedLineNumber >= 1 &&
        generatedLineNumber <= codeLines.length
      ) {
        const target = extractInputTargetFromCodeLine(
          language,
          codeLines[generatedLineNumber - 1],
        )
        if (target) {
          return target.replace(/\(([^)]+)\)/g, '[$1]')
        }
      }
    }
  }

  if (inputTargets.length > 0) {
    return inputTargets[inputCount % inputTargets.length]
  }

  return null
}

function isInputExhaustedError(language: string, stderr: string) {
  const normalizedLanguage = language.toLowerCase()

  if (normalizedLanguage === 'python') {
    return stderr.includes('EOFError')
  }

  if (normalizedLanguage === 'java') {
    return (
      stderr.includes('NoSuchElementException') ||
      stderr.includes('No line found')
    )
  }

  if (normalizedLanguage === 'vb') {
    return stderr.includes('EOFError')
  }

  return stderr.includes('EOFError')
}

const DEFAULT_OUTPUT_PLACEHOLDER = 'Run your generated code to see the output here.'

function OutputPanel() {
  const language = useSettingsStore((state) => state.language)
  const theme = useSettingsStore((state) => state.theme)
  const pseudocode = useEditorStore((state) => state.pseudocode)
  const generatedCode = useEditorStore((state) => state.generatedCode)
  const problemCard = useEditorStore((state) => state.problemCard)
  const outputStatus = useEditorStore((state) => state.outputStatus)
  const tier1Warnings = useEditorStore((state) => state.tier1Warnings)
  const isRunDisabled = useEditorStore((state) => state.isRunDisabled)
  const setOutput = useEditorStore((state) => state.setOutput)
  const setOutputStatus = useEditorStore((state) => state.setOutputStatus)
  const setIsDebriefUnlocked = useEditorStore(
    (state) => state.setIsDebriefUnlocked,
  )
  const [requestError, setRequestError] = useState<string | null>(null)
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { text: DEFAULT_OUTPUT_PLACEHOLDER, kind: 'info' },
  ])
  const [htmlPreview, setHtmlPreview] = useState<string | null>(null)
  const [collectedInputs, setCollectedInputs] = useState<string[]>([])
  const [promptValue, setPromptValue] = useState('')
  const [currentPromptTarget, setCurrentPromptTarget] = useState<string | null>(null)
  const [isAwaitingInput, setIsAwaitingInput] = useState(false)
  const stdoutLineCountRef = useRef(0)

  const inputTargets = useMemo(() => {
    const targets: string[] = []

    pseudocode.split('\n').forEach((line) => {
      const match = line.trim().match(/^INPUT\s+(.+?)(?:\s+AS\s+[A-Za-z_]\w*)?$/i)
      if (match) {
        targets.push(match[1].trim())
      }
    })

    return targets
  }, [pseudocode])

  useEffect(() => {
    stdoutLineCountRef.current = 0
    /* eslint-disable react-hooks/set-state-in-effect -- source changes intentionally reset the interactive terminal session */
    setCollectedInputs([])
    setPromptValue('')
    setIsAwaitingInput(false)
    setCurrentPromptTarget(null)
    setHtmlPreview(null)
    setTerminalLines([
      { text: DEFAULT_OUTPUT_PLACEHOLDER, kind: 'info' },
    ])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [pseudocode, generatedCode])

  const runCode = async (stdin: string, inputs: string[]) => {
    setRequestError(null)
    setOutput(null)
    setOutputStatus('running')
    setIsAwaitingInput(false)
    setHtmlPreview(null)

    try {
      const response = await executeCode({
        language,
        code: generatedCode,
        stdin,
      })

      const stdout = typeof response.stdout === 'string' ? response.stdout : ''
      const stderr = typeof response.stderr === 'string' ? response.stderr : ''
      const nextHtmlPreview =
        typeof response.htmlPreview === 'string' ? response.htmlPreview : null
      const trimmedStdout = stdout.trim()
      const stdoutLines = toStdoutLines(trimmedStdout)
      const previousStdoutCount = stdoutLineCountRef.current
      const nextStdoutCount = stdoutLines.length
      const stdoutDeltaStart =
        nextStdoutCount < previousStdoutCount ? 0 : previousStdoutCount
      const stdoutDelta = stdoutLines.slice(stdoutDeltaStart)
      stdoutLineCountRef.current = nextStdoutCount

      if (nextHtmlPreview) {
        setHtmlPreview(nextHtmlPreview)
      }

      if (stdoutDelta.length > 0) {
        setTerminalLines((current) => [...current, ...stdoutDelta])
      }

      if (isInputExhaustedError(language, stderr)) {
        const nextTarget = inferPromptTarget(
          language,
          stderr,
          generatedCode,
          inputTargets,
          inputs.length,
        )
        setCollectedInputs(inputs)
        setPromptValue('')
        setOutput(trimmedStdout || null)
        setOutputStatus('empty')
        setIsDebriefUnlocked(false)
        setCurrentPromptTarget(nextTarget)
        setIsAwaitingInput(true)
        return
      }

      if (stderr.trim()) {
        setTerminalLines((current) => [
          ...current,
          ...stderr
            .trim()
            .split('\n')
            .filter((line: string) => line.length > 0)
            .map((line: string) => ({ text: line, kind: 'error' as const })),
        ])
        setOutput(stderr.trim())
        setOutputStatus('error')
        setIsDebriefUnlocked(false)
        return
      }

      const expectedOutput = problemCard?.outputs.trim()

      if (nextStdoutCount === 0) {
        setTerminalLines((current) => [...current, { text: '(no output)', kind: 'stdout' }])
      }
      setOutput(trimmedStdout || '(no output)')

      if (expectedOutput && trimmedStdout === expectedOutput) {
        setOutputStatus('correct')
        setIsDebriefUnlocked(true)
      } else {
        setOutputStatus('wrong')
        setIsDebriefUnlocked(false)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to run code right now.'
      setRequestError(message)
      setTerminalLines([{ text: message, kind: 'error' }])
      setOutput(message)
      setOutputStatus('error')
      setIsDebriefUnlocked(false)
    }
  }

  const handleRun = async () => {
    if (!generatedCode.trim() || isRunDisabled) {
      return
    }

    setCollectedInputs([])
    setPromptValue('')
    setRequestError(null)
    setCurrentPromptTarget(null)
    stdoutLineCountRef.current = 0

    if (inputTargets.length > 0) {
      setIsAwaitingInput(false)
      setCurrentPromptTarget(null)
      setOutput(null)
      setOutputStatus('empty')
      setTerminalLines([{ text: '> Running...', kind: 'info' }])
      await runCode('', [])
      return
    }

    setTerminalLines([{ text: '> Running...', kind: 'info' }])
    await runCode('', [])
  }

  const handlePromptSubmit = async () => {
    const submittedValues = promptValue
      .replace(/\r/g, '')
      .split('\n')
      .map((value) => value)
      .filter((value) => value.length > 0)

    if (submittedValues.length === 0) {
      return
    }

    const nextInputs = [...collectedInputs, ...submittedValues]
    setCollectedInputs(nextInputs)
    setPromptValue('')
    setTerminalLines((current) => [
      ...current,
      ...submittedValues.map((value) => ({ text: `> ${value}`, kind: 'input' as const })),
    ])

    await runCode(nextInputs.join('\n'), nextInputs)
  }

  return (
    <section className="terminal-panel panel" style={{ minHeight: '100%' }}>
      <div
        style={{
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div className="terminal-label">[ Output ]</div>
        <button
          type="button"
          disabled={isRunDisabled || outputStatus === 'running'}
          onClick={handleRun}
          className="terminal-button"
        >
          {outputStatus === 'running' ? '[ Running… ]' : '[ Run ▶ ]'}
        </button>
      </div>

      <div className="panel-scroll panel-content" style={{ display: 'flex', flexDirection: 'column' }}>
        {outputStatus === 'correct' && (
          <div className="accent-green" style={{ marginBottom: '12px', fontSize: '16px', color: '#7ed957' }}>
            ✓ Correct output
          </div>
        )}
        {outputStatus === 'running' && (
          <div style={{ marginBottom: '12px', fontSize: '16px', color: 'rgba(255, 255, 255, 0.5)' }}>
            Running your code…
          </div>
        )}
        {requestError && (
          <div style={{ marginBottom: '12px', fontSize: '16px', color: '#ffffff' }}>
            {requestError}
          </div>
        )}
        <div
          className="output-content"
          style={{
            display: 'flex',
            minHeight: '320px',
            flex: 1,
            flexDirection: 'column',
          }}
        >
          <div
            className="panel-content"
            style={{
              flex: 1,
              overflowX: 'auto',
              overflowY: 'auto',
              padding: '12px 0',
            }}
          >
            {terminalLines.map((line, index) => (
              <div
                className={
                  line.text === DEFAULT_OUTPUT_PLACEHOLDER
                    ? 'output-placeholder'
                    : line.kind === 'input'
                      ? 'accent-green'
                      : undefined
                }
                key={`${line.kind}-${index}-${line.text}`}
                style={{
                  color:
                    line.text === DEFAULT_OUTPUT_PLACEHOLDER
                      ? theme === 'light'
                        ? '#8a8d96'
                        : 'rgba(255,255,255,0.4)'
                      : line.kind === 'input'
                      ? '#7ed957'
                      : line.kind === 'error'
                        ? '#ff6b6b'
                        : '#ffffff',
                  fontFamily: 'Anton, sans-serif',
                  fontSize: 'inherit',
                  whiteSpace: 'pre',
                  width: 'max-content',
                  minWidth: '100%',
                }}
              >
                {line.text}
              </div>
            ))}
          </div>
          {htmlPreview && (
            <div
              style={{
                marginTop: '12px',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '6px',
                overflow: 'hidden',
              }}
            >
              <iframe
                title="HTML preview"
                srcDoc={htmlPreview}
                sandbox="allow-same-origin"
                style={{
                  width: '100%',
                  minHeight: '220px',
                  border: 'none',
                  background: '#ffffff',
                }}
              />
            </div>
          )}
          {isAwaitingInput && inputTargets.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingTop: '10px',
              }}
            >
              <span
                className="accent-green"
                style={{
                  color: '#7ed957',
                  fontFamily: 'Anton, sans-serif',
                  fontSize: 'inherit',
                }}
              >
                {'> '}
              </span>
              <input
                className="terminal-prompt-input"
                type="text"
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handlePromptSubmit()
                  }
                }}
                placeholder={
                  currentPromptTarget
                    ? `type value for ${currentPromptTarget} and press Enter...`
                    : 'type here and press Enter...'
                }
                style={{
                  flexGrow: 1,
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.3)',
                  background: 'transparent',
                  color: '#7ed957',
                  outline: 'none',
                  fontFamily: 'Anton, sans-serif',
                  fontSize: 'inherit',
                }}
              />
            </div>
          )}
        </div>
        {tier1Warnings.length > 0 && outputStatus !== 'empty' && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '2px solid #ababb6' }}>
            <div style={{ marginBottom: '8px', fontSize: '16px', color: '#ffffff' }}>
              Warnings
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '16px', color: 'rgba(255, 255, 255, 0.5)' }}>
              {tier1Warnings.map((warning, index) => (
                <li key={`${warning.from}-${warning.to}-${index}`} style={{ marginBottom: '8px' }}>
                  ⚠ {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

export default OutputPanel

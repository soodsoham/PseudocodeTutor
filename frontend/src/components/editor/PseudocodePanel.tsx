import { useEffect, useMemo, useRef, useState } from 'react'
import { translatePseudocode } from '../../engines/translation'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

const INDENT_UNIT = '      '
const INDENT_SIZE = INDENT_UNIT.length
const DEDENT_KEYWORDS = [
  'NEXT',
  'ENDWHILE',
  'ENDIF',
  'ENDFOR',
  'UNTIL',
  'ENDPROCEDURE',
  'ENDFUNCTION',
]

function PseudocodePanel() {
  const pseudocode = useEditorStore((state) => state.pseudocode)
  const lineMapping = useEditorStore((state) => state.lineMapping)
  const activePseudoLine = useEditorStore((state) => state.activePseudoLine)
  const activeCodeLine = useEditorStore((state) => state.activeCodeLine)
  const setPseudocode = useEditorStore((state) => state.setPseudocode)
  const setGeneratedCode = useEditorStore((state) => state.setGeneratedCode)
  const setLineMapping = useEditorStore((state) => state.setLineMapping)
  const setActivePseudoLine = useEditorStore((state) => state.setActivePseudoLine)
  const setActiveCodeLine = useEditorStore((state) => state.setActiveCodeLine)
  const language = useSettingsStore((state) => state.language)
  const theme = useSettingsStore((state) => state.theme)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [cursorLine, setCursorLine] = useState(activePseudoLine ?? 1)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const translationResult = translatePseudocode(pseudocode, language)
    const initialMapping: Record<number, number[]> = {}
    const totalPseudoLines = Math.max(1, pseudocode.split('\n').length)

    for (let lineNumber = 1; lineNumber <= totalPseudoLines; lineNumber += 1) {
      initialMapping[lineNumber] = []
    }

    translationResult.lines.forEach((line, index) => {
      initialMapping[line.pseudoLine] ??= []
      initialMapping[line.pseudoLine].push(index + 1)
    })

    setGeneratedCode(translationResult.lines.map((line) => line.codeLine).join('\n'))
    setLineMapping(initialMapping)
  }, [language, pseudocode, setGeneratedCode, setLineMapping])

  useEffect(() => {
    if (!textareaRef.current || activePseudoLine === null || activeCodeLine === null) {
      return
    }

    const textarea = textareaRef.current
    if (document.activeElement === textarea) {
      return
    }

    const lines = textarea.value.split('\n')
    let start = 0

    for (let index = 0; index < activePseudoLine - 1; index += 1) {
      start += lines[index]?.length ?? 0
      start += 1
    }

    const lineLength = lines[activePseudoLine - 1]?.length ?? 0
    const lineEnd = start + lineLength
    textarea.setSelectionRange(lineEnd, lineEnd)
  }, [activeCodeLine, activePseudoLine])

  const activeLineBackground = useMemo(() => {
    if (activePseudoLine === null) {
      return undefined
    }

    const lineHeight = 25.6
    return {
      backgroundImage: theme === 'light'
        ? 'linear-gradient(rgba(0,0,0,0.06), rgba(0,0,0,0.06))'
        : 'linear-gradient(rgba(255,255,100,0.1), rgba(255,255,100,0.1))',
      backgroundRepeat: 'no-repeat',
      backgroundSize: `100% ${lineHeight}px`,
      backgroundPosition: `0 ${6 + (activePseudoLine - 1) * lineHeight}px`,
    }
  }, [activePseudoLine, theme])

  const syncActivePseudoLine = (selectionStart: number) => {
    const lineNumber = pseudocode.slice(0, selectionStart).split('\n').length
    setCursorLine(lineNumber)
    setActivePseudoLine(lineNumber)

    const mappedCodeLines = lineMapping[lineNumber] ?? []
    setActiveCodeLine(mappedCodeLines[0] ?? null)
  }

  const updatePseudocodeValue = (
    textarea: HTMLTextAreaElement,
    nextValue: string,
    nextCursorStart: number,
    nextCursorEnd: number = nextCursorStart,
  ) => {
    textarea.value = nextValue
    textarea.setSelectionRange(nextCursorStart, nextCursorEnd)
    setPseudocode(nextValue)
    requestAnimationFrame(() => {
      textarea.setSelectionRange(nextCursorStart, nextCursorEnd)
      syncActivePseudoLine(nextCursorEnd)
    })
  }

  function getIndentForNewLine(fullLineText: string, textBeforeCursor: string): string {
    const currentIndent = fullLineText.match(/^(\s*)/)?.[1] ?? ''
    const normalizedFull = fullLineText.trim().toUpperCase()
    const normalizedBeforeCursor = textBeforeCursor.trim().toUpperCase()
    const effectiveText = normalizedBeforeCursor.length > 0 ? normalizedBeforeCursor : normalizedFull

    if (DEDENT_KEYWORDS.some((keyword) => effectiveText.startsWith(`${keyword} `) || effectiveText === keyword)) {
      return currentIndent.slice(0, Math.max(0, currentIndent.length - INDENT_SIZE))
    }

    const opensBlock =
      /^FOR\b/.test(effectiveText) ||
      /^WHILE\b/.test(effectiveText) ||
      /^IF\b/.test(effectiveText) ||
      /^ELSE\b/.test(effectiveText) ||
      /^REPEAT\b/.test(effectiveText) ||
      /^PROCEDURE\b/.test(effectiveText) ||
      /^FUNCTION\b/.test(effectiveText) ||
      /\bTHEN$/.test(effectiveText) ||
      /\bDO$/.test(effectiveText)

    if (opensBlock) {
      return currentIndent + INDENT_UNIT
    }

    return currentIndent
  }

  return (
    <section className="terminal-panel panel" style={{ minHeight: '100%' }}>
      <div className="terminal-label">[ Pseudocode ]</div>
      <div className="terminal-cursor" style={{ marginTop: '8px', marginBottom: '16px' }}>
        {'>'}
      </div>
      <div style={{ position: 'relative', minHeight: 0, flex: 1 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            zIndex: 1,
            left: 0,
            top: '6px',
            transform: `translateY(-${scrollTop}px)`,
            width: '52px',
            textAlign: 'right',
            paddingRight: '4px',
            color: theme === 'light' ? 'rgba(67,70,79,0.42)' : 'rgba(255,255,255,0.38)',
            lineHeight: '25.6px',
            fontFamily: 'inherit',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {Array.from({ length: Math.max(1, pseudocode.split('\n').length) }, (_, index) => (
            <div
              key={index + 1}
              style={{
                height: '25.6px',
                color: index + 1 === cursorLine
                  ? (theme === 'light' ? '#43464f' : '#ffffff')
                  : undefined,
                fontWeight: index + 1 === cursorLine ? 600 : 400,
              }}
            >
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={pseudocode}
        wrap="off"
        onChange={(event) => {
          setPseudocode(event.target.value)
          syncActivePseudoLine(event.target.selectionStart)
        }}
        onClick={(event) => {
          syncActivePseudoLine(event.currentTarget.selectionStart)
        }}
        onKeyUp={(event) => {
          syncActivePseudoLine(event.currentTarget.selectionStart)
        }}
        onKeyDown={(event) => {
          const textarea = event.currentTarget
          const { selectionStart: ss, selectionEnd: se, value } = textarea

          if (event.key === 'Tab') {
            event.preventDefault()
            const lineStart = value.lastIndexOf('\n', Math.max(0, ss - 1)) + 1
            const lineEndSearchFrom = se > ss ? se : ss
            const lineEndIndex = value.indexOf('\n', lineEndSearchFrom)
            const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
            const selectedBlock = value.slice(lineStart, lineEnd)
            const lines = selectedBlock.split('\n')

            if (event.shiftKey) {
              const dedented = lines.map((line) => {
                if (line.startsWith(INDENT_UNIT)) {
                  return line.slice(INDENT_SIZE)
                }
                return line.replace(new RegExp(`^ {1,${INDENT_SIZE}}`), '')
              })

              const removedFromFirstLine = lines[0].length - dedented[0].length
              const totalRemoved = lines.reduce(
                (total, line, index) => total + (line.length - dedented[index].length),
                0,
              )

              const next = value.slice(0, lineStart) + dedented.join('\n') + value.slice(lineEnd)
              const nextStart = Math.max(lineStart, ss - removedFromFirstLine)
              const nextEnd = Math.max(nextStart, se - totalRemoved)
              updatePseudocodeValue(textarea, next, nextStart, nextEnd)
              return
            }

            if (ss === se) {
              const next = value.slice(0, ss) + INDENT_UNIT + value.slice(se)
              updatePseudocodeValue(textarea, next, ss + INDENT_SIZE)
              return
            }

            const indented = lines.map((line) => `${INDENT_UNIT}${line}`)
            const next = value.slice(0, lineStart) + indented.join('\n') + value.slice(lineEnd)
            const nextStart = ss + INDENT_SIZE
            const nextEnd = se + INDENT_SIZE * lines.length
            updatePseudocodeValue(textarea, next, nextStart, nextEnd)
            return
          }

          if (event.key === 'Backspace' && ss === se) {
            const lineStart = value.lastIndexOf('\n', Math.max(0, ss - 1)) + 1
            const beforeCursor = value.slice(lineStart, ss)

            if (beforeCursor === '' && ss > 0) {
              event.preventDefault()
              const next = value.slice(0, ss - 1) + value.slice(se)
              updatePseudocodeValue(textarea, next, ss - 1)
              return
            }

            if (/^ +$/.test(beforeCursor)) {
              event.preventDefault()
              const remainder = beforeCursor.length % INDENT_SIZE
              const deleteCount = remainder === 0 ? INDENT_SIZE : remainder
              const next = value.slice(0, ss - deleteCount) + value.slice(se)
              updatePseudocodeValue(textarea, next, ss - deleteCount)
              return
            }
          }

          if (event.key === 'Enter') {
            event.preventDefault()
            const currentLineStart = value.lastIndexOf('\n', Math.max(0, ss - 1)) + 1
            const currentLineEndSearch = value.indexOf('\n', ss)
            const currentLineEnd = currentLineEndSearch === -1 ? value.length : currentLineEndSearch
            const fullCurrentLineText = value.slice(currentLineStart, currentLineEnd)
            const textBeforeCursor = value.slice(currentLineStart, ss)
            const newIndent = getIndentForNewLine(fullCurrentLineText, textBeforeCursor)
            const next = value.slice(0, ss) + '\n' + newIndent + value.slice(se)
            const newCursorPos = ss + 1 + newIndent.length
            updatePseudocodeValue(textarea, next, newCursorPos)
          }
        }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        placeholder="Write your pseudocode here..."
        className="terminal-textarea panel-scroll pseudocode-textarea"
        spellCheck={false}
        style={{
          color: theme === 'light' ? '#43464f' : '#ffffff',
          lineHeight: '1.6',
          tabSize: 2,
          whiteSpace: 'pre',
          paddingLeft: '56px',
          overflowX: 'auto',
          overflowY: 'auto',
          ...activeLineBackground,
        }}
        />
      </div>
    </section>
  )
}

export default PseudocodePanel

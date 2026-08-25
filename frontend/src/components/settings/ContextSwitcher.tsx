import { useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

const languageOptions = [
  { label: 'Python', value: 'python' },
  { label: 'Visual Basic', value: 'vb' },
  { label: 'Java', value: 'java' },
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'SQL', value: 'sql' },
]

const boardOptions = [
  { label: 'CIE IGCSE', value: 'cie-igcse' },
  { label: 'CIE A Level', value: 'cie-a-level' },
  { label: 'Pearson IGCSE', value: 'pearson-igcse' },
  { label: 'Pearson A Level', value: 'pearson-a-level' },
  { label: 'AQA GCSE', value: 'aqa-gcse' },
  { label: 'AQA A Level', value: 'aqa-a-level' },
]

type ContextSwitcherProps = {
  isOpen: boolean
  onClose: () => void
}

function ContextSwitcher({ isOpen, onClose }: ContextSwitcherProps) {
  const board = useSettingsStore((state) => state.board)
  const language = useSettingsStore((state) => state.language)
  const theme = useSettingsStore((state) => state.theme)
  const setBoard = useSettingsStore((state) => state.setBoard)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hoveredOption, setHoveredOption] = useState<string | null>(null)
  const [hoveredBoard, setHoveredBoard] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        onClose()
      }
    }

    document.addEventListener('click', handleDocumentClick)

    return () => {
      document.removeEventListener('click', handleDocumentClick)
    }
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="context-switcher"
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        marginTop: '10px',
        background: '#43464f',
        border: '2px solid #ababb6',
        borderRadius: '8px',
        padding: '24px',
        width: '480px',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
        }}
      >
        <div style={{ paddingRight: '24px', borderRight: '1px solid #ababb6' }}>
          <div
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '10px',
            }}
          >
            Language
          </div>
          {languageOptions.map((option) => {
            const isSelected = language === option.value

            return (
              <button
                key={option.value}
                type="button"
                onMouseEnter={() => setHoveredOption(option.value)}
                onMouseLeave={() => setHoveredOption(null)}
                onClick={() => { setLanguage(option.value); onClose() }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 8px',
                  cursor: 'pointer',
                  background: hoveredOption === option.value ? (theme === 'light' ? '#43464f' : '#ffffff') : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  textAlign: 'left' as const,
                  fontFamily: 'Anton, sans-serif',
                  fontSize: '18px',
                  color: hoveredOption === option.value
                    ? (theme === 'light' ? '#eaeaeb' : '#43464f')
                    : isSelected
                      ? '#7ed957'
                      : theme === 'light' ? '#43464f' : '#ffffff',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div style={{ paddingLeft: '24px' }}>
          <div
            style={{
              fontSize: '14px',
              color: 'rgba(255,255,255,0.6)',
              marginBottom: '10px',
            }}
          >
            Exam Board
          </div>
          {boardOptions.map((option) => {
            const isSelected = board === option.value

            return (
              <button
                key={option.value}
                type="button"
                onMouseEnter={() => setHoveredBoard(option.value)}
                onMouseLeave={() => setHoveredBoard(null)}
                onClick={() => { setBoard(option.value); onClose() }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 8px',
                  cursor: 'pointer',
                  background: hoveredBoard === option.value ? (theme === 'light' ? '#43464f' : '#ffffff') : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  textAlign: 'left' as const,
                  fontFamily: 'Anton, sans-serif',
                  fontSize: '18px',
                  color: hoveredBoard === option.value
                    ? (theme === 'light' ? '#eaeaeb' : '#43464f')
                    : isSelected
                      ? '#7ed957'
                      : theme === 'light' ? '#43464f' : '#ffffff',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default ContextSwitcher

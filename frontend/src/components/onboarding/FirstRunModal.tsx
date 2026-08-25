import { useState } from 'react'
import { setCookie } from '../../lib/cookies'
import { useSettingsStore } from '../../stores/settingsStore'

const boardOptions = [
  { label: 'CIE IGCSE', value: 'cie-igcse' },
  { label: 'PEARSON IGCSE', value: 'pearson-igcse' },
  { label: 'AQA GCSE', value: 'aqa-gcse' },
  { label: 'CIE A LEVEL', value: 'cie-a-level' },
  { label: 'PEARSON A LEVEL', value: 'pearson-a-level' },
  { label: 'AQA A LEVEL', value: 'aqa-a-level' },
]

const languageOptions = [
  { label: 'Python', value: 'python' },
  { label: 'Visual Basic', value: 'vb' },
  { label: 'Java', value: 'java' },
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'SQL', value: 'sql' },
]

function FirstRunModal() {
  const setBoard = useSettingsStore((state) => state.setBoard)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const setIsFirstRun = useSettingsStore((state) => state.setIsFirstRun)

  const [step, setStep] = useState<1 | 2>(1)
  const [selectedBoard, setSelectedBoard] = useState<string>('')
  const [selectedLanguage, setSelectedLanguage] = useState<string>('')

  const handleComplete = () => {
    setBoard(selectedBoard)
    setLanguage(selectedLanguage)
    setIsFirstRun(false)
    setCookie('pct_board', selectedBoard)
    setCookie('pct_language', selectedLanguage)
    setCookie('pct_theme', 'dark')
    setCookie('pct_textsize', 'medium')
    window.localStorage.setItem('pct_first_run_done', 'true')
  }

  return (
    <div className="modal-overlay">
      <div
        className="modal-box"
        style={{
          width: '760px',
          maxWidth: '90vw',
          padding: '40px',
          background: '#43464f',
          border: '2px solid #ababb6',
          borderRadius: '8px',
        }}
      >
        <div className="modal-title-row">
          <div className="modal-title">[ Quick Setup ]</div>
          <div className="modal-step">({step}/2)</div>
        </div>

        {step === 1 ? (
          <div>
            <div className="modal-section-heading">Select your Exam Board:</div>
            <div
              className="option-grid"
              style={{ gap: '20px 40px' }}
            >
              {boardOptions.map((option) => (
                <label key={option.value} className="option-row">
                  <input
                    type="radio"
                    name="board"
                    value={option.value}
                    checked={selectedBoard === option.value}
                    onChange={(event) => setSelectedBoard(event.target.value)}
                    className="theme-radio"
                    style={{
                      width: '22px',
                      height: '22px',
                      border: '2px solid #ffffff',
                      borderRadius: '50%',
                      background:
                        selectedBoard === option.value ? '#7ed957' : 'transparent',
                    }}
                  />
                  <span className="option-label">{option.label}</span>
                </label>
              ))}
            </div>
            <div className="modal-actions-end">
              <button
                type="button"
                disabled={!selectedBoard}
                onClick={() => setStep(2)}
                className="terminal-button"
                style={{ fontSize: '18px', padding: '10px 24px' }}
              >
                [ Next ]
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="modal-section-heading">Select your Programming Language:</div>
            <div
              className="option-grid"
              style={{ gap: '20px 40px' }}
            >
              {languageOptions.map((option) => (
                <label key={option.value} className="option-row">
                  <input
                    type="radio"
                    name="language"
                    value={option.value}
                    checked={selectedLanguage === option.value}
                    onChange={(event) => setSelectedLanguage(event.target.value)}
                    className="theme-radio"
                    style={{
                      width: '22px',
                      height: '22px',
                      border: '2px solid #ffffff',
                      borderRadius: '50%',
                      background:
                        selectedLanguage === option.value ? '#7ed957' : 'transparent',
                    }}
                  />
                  <span className="option-label">{option.label}</span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="terminal-button"
                style={{ fontSize: '18px', padding: '10px 24px' }}
              >
                [ Back ]
              </button>
              <button
                type="button"
                disabled={!selectedLanguage}
                onClick={handleComplete}
                className="terminal-button"
                style={{ fontSize: '18px', padding: '10px 24px' }}
              >
                [ Start Writing → ]
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FirstRunModal

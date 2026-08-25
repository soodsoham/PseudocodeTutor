import { type MouseEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword, supabase } from '../../lib/supabaseClient'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'

const boardOptions = [
  { label: 'CIE IGCSE', value: 'cie-igcse' },
  { label: 'CIE A Level', value: 'cie-a-level' },
  { label: 'Pearson IGCSE', value: 'pearson-igcse' },
  { label: 'Pearson A Level', value: 'pearson-a-level' },
  { label: 'AQA GCSE', value: 'aqa-gcse' },
  { label: 'AQA A Level', value: 'aqa-a-level' },
]

const languageOptions = [
  { label: 'Python', value: 'python' },
  { label: 'Visual Basic', value: 'vb' },
  { label: 'Java', value: 'java' },
  { label: 'C++', value: 'cpp' },
  { label: 'HTML', value: 'html' },
  { label: 'SQL', value: 'sql' },
]

type SettingsModalProps = {
  isOpen: boolean
  onClose: () => void
  onOpenLogin: () => void
}

function SettingsModal({
  isOpen,
  onClose,
  onOpenLogin,
}: SettingsModalProps) {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const signOut = useAuthStore((state) => state.signOut)
  const board = useSettingsStore((state) => state.board)
  const language = useSettingsStore((state) => state.language)
  const theme = useSettingsStore((state) => state.theme)
  const textSize = useSettingsStore((state) => state.textSize)
  const setBoard = useSettingsStore((state) => state.setBoard)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const setTextSize = useSettingsStore((state) => state.setTextSize)
  const [accountMessage, setAccountMessage] = useState<string | null>(null)

  const handleLogout = async () => {
    await signOut()
    setAccountMessage('Signed out.')
  }

  const handleChangePassword = async () => {
    const currentPassword = window.prompt('Enter your current password')
    if (!currentPassword) {
      return
    }
    const nextPassword = window.prompt('Enter new password (min 6 characters)')
    if (!nextPassword) {
      return
    }

    if (nextPassword.length < 6) {
      setAccountMessage('Password must be at least 6 characters.')
      return
    }

    const { error } = await changePassword(currentPassword, nextPassword)
    if (error) {
      setAccountMessage(error.message || 'Could not update password.')
      return
    }

    setAccountMessage('Password updated successfully.')
  }

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Delete account? This action cannot be undone.',
    )
    if (!confirmed) {
      return
    }

    const { error } = await supabase.rpc('delete_current_user')
    if (error) {
      setAccountMessage('Delete account is not enabled in this build.')
      return
    }

    await signOut()
    setAccountMessage('Account deleted.')
  }

  const handleThemeChange = (nextTheme: 'light' | 'dark') => {
    setTheme(nextTheme)
  }

  const handleTextSizeChange = (
    nextSize: 'small' | 'medium' | 'large',
  ) => {
    setTextSize(nextSize)
  }

  if (!isOpen) {
    return null
  }

  const stopClose = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1000 }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        onClick={stopClose}
        style={{
          background: '#43464f',
          border: '2px solid #ababb6',
          borderRadius: '8px',
          width: '700px',
          maxWidth: '90vw',
          padding: '40px',
        }}
      >
        <div
          style={{
            color: '#ffffff',
            fontSize: '24px',
            marginBottom: '32px',
          }}
        >
          [ Settings ]
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '32px',
          }}
        >
          <div>
            <div style={{ color: '#ffffff', fontSize: '18px', marginBottom: '8px' }}>
              Exam Board
            </div>
            <select
              value={board}
              onChange={(event) => setBoard(event.target.value)}
              style={{
                width: '100%',
                background: '#43464f',
                color: '#ffffff',
                border: '2px solid #ffffff',
                borderRadius: '4px',
                padding: '10px 14px',
                fontSize: '18px',
                outline: 'none',
              }}
            >
              {boardOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div
              style={{
                color: '#ffffff',
                fontSize: '18px',
                marginTop: '24px',
                marginBottom: '8px',
              }}
            >
              Programming Language
            </div>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              style={{
                width: '100%',
                background: '#43464f',
                color: '#ffffff',
                border: '2px solid #ffffff',
                borderRadius: '4px',
                padding: '10px 14px',
                fontSize: '18px',
                outline: 'none',
              }}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ color: '#ffffff', fontSize: '18px', marginBottom: '8px' }}>
              Theme
            </div>
            <div style={{ display: 'flex', gap: '24px' }}>
              {(['light', 'dark'] as const).map((option) => (
                <label
                  key={option}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: '#ffffff',
                    fontSize: '18px',
                  }}
                >
                  <input
                    type="radio"
                    name="settings-theme"
                    className={`radio-circle${theme === option ? ' selected' : ''}`}
                    checked={theme === option}
                    onChange={() => handleThemeChange(option)}
                    style={{
                      appearance: 'none',
                      width: '22px',
                      height: '22px',
                      margin: 0,
                      border: `2px solid ${theme === option ? '#7ed957' : '#ffffff'}`,
                      borderRadius: '50%',
                      backgroundColor: theme === option ? '#7ed957' : 'transparent',
                      flexShrink: 0,
                    }}
                  />
                  {option[0].toUpperCase() + option.slice(1)}
                </label>
              ))}
            </div>

            <div
              style={{
                color: '#ffffff',
                fontSize: '18px',
                marginTop: '24px',
                marginBottom: '8px',
              }}
            >
              Text Size
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { label: 'A-', value: 'small' as const },
                { label: 'A', value: 'medium' as const },
                { label: 'A+', value: 'large' as const },
              ].map((option) => {
                const isActive = textSize === option.value

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleTextSizeChange(option.value)}
                    style={{
                      border: '2px solid #ffffff',
                      borderRadius: '4px',
                      padding: '10px 20px',
                      background: isActive ? '#ffffff' : 'transparent',
                      color: isActive ? '#43464f' : '#ffffff',
                      fontSize: '18px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '56px',
                      lineHeight: 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <div style={{ color: '#ffffff', fontSize: '18px', marginBottom: '8px' }}>
              Account
            </div>
            {user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px' }}>
                  {user.email ?? 'Logged in'}
                </div>
                <button
                  type="button"
                  className="terminal-button"
                  style={{
                    fontSize: '18px',
                    padding: '10px 20px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 'fit-content',
                  }}
                  onClick={() => {
                    void handleLogout()
                  }}
                >
                  [ Logout ]
                </button>
                <button
                  type="button"
                  className="terminal-button"
                  style={{
                    fontSize: '18px',
                    padding: '10px 20px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 'fit-content',
                  }}
                  onClick={() => {
                    onClose()
                    navigate('/my-submissions')
                  }}
                >
                  [ My Submissions ]
                </button>
                <button
                  type="button"
                  className="terminal-button"
                  style={{
                    fontSize: '18px',
                    padding: '10px 20px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 'fit-content',
                  }}
                  onClick={() => {
                    void handleChangePassword()
                  }}
                >
                  [ Change Password ]
                </button>
                <button
                  type="button"
                  className="terminal-button"
                  style={{
                    fontSize: '18px',
                    padding: '10px 20px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 'fit-content',
                  }}
                  onClick={() => {
                    void handleDeleteAccount()
                  }}
                >
                  [ Delete Account ]
                </button>
                {accountMessage && (
                  <div
                    style={{
                      color: accountMessage.toLowerCase().includes('success') || accountMessage.toLowerCase().includes('signed') || accountMessage.toLowerCase().includes('deleted')
                        ? '#7ed957'
                        : '#ff6b6b',
                      fontSize: '13px',
                    }}
                  >
                    {accountMessage}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  className="terminal-button"
                  style={{ fontSize: '18px', padding: '10px 20px', width: 'fit-content' }}
                  onClick={() => {
                    onClose()
                    navigate('/my-submissions')
                  }}
                >
                  [ My Submissions ]
                </button>
                <button
                  type="button"
                  className="terminal-button"
                  style={{ fontSize: '18px', padding: '10px 20px', width: 'fit-content' }}
                  onClick={() => {
                    onClose()
                    onOpenLogin()
                  }}
                >
                  [ Login ]
                </button>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '32px',
          }}
        >
          <button
            type="button"
            className="terminal-button"
            style={{ fontSize: '18px', padding: '10px 24px' }}
            onClick={onClose}
          >
            [ Close ]
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal

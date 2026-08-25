import { type MouseEvent, useState } from 'react'
import { resetPasswordWithToken, supabase } from '../../lib/supabaseClient'

type LoginModalProps = {
  isOpen: boolean
  onClose: () => void
}

function LoginModal({ isOpen, onClose }: LoginModalProps) {
  const resetToken = new URLSearchParams(window.location.search).get('token')
  const [activeTab, setActiveTab] = useState<'login' | 'register' | 'reset'>(
    resetToken ? 'reset' : 'login',
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  if (!isOpen) {
    return null
  }

  const stopClose = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const resetMessages = () => {
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  const handleGoogle = async () => {
    resetMessages()
    setIsSubmitting(true)

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })

    setIsSubmitting(false)

    if (error) {
      setErrorMessage(error.message)
    }
  }

  const handleSignIn = async () => {
    resetMessages()
    setIsSubmitting(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setIsSubmitting(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    onClose()
  }

  const handleRegister = async () => {
    resetMessages()

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.')
      return
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
    })
    setIsSubmitting(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSuccessMessage('Check your email to confirm your account')
  }

  const handleForgotPassword = async () => {
    resetMessages()
    if (!email.trim()) {
      setErrorMessage('Enter your email address first.')
      return
    }

    setIsSubmitting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setIsSubmitting(false)

    if (error) {
      setErrorMessage(error.message)
      return
    }

    setSuccessMessage('Password reset email sent. Check your inbox.')
  }

  const handleResetPassword = async () => {
    resetMessages()
    if (!resetToken) {
      setErrorMessage('This password reset link is invalid or has expired.')
      return
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }

    setIsSubmitting(true)
    const { error } = await resetPasswordWithToken(resetToken, password)
    setIsSubmitting(false)
    if (error) {
      setErrorMessage(error.message || 'Could not reset password.')
      return
    }

    window.history.replaceState({}, '', window.location.pathname)
    setActiveTab('login')
    setPassword('')
    setConfirmPassword('')
    setSuccessMessage('Password updated. You can now sign in.')
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
          width: '460px',
          maxWidth: '90vw',
          padding: '32px',
        }}
      >
        {activeTab !== 'reset' && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
          <button
            type="button"
            className="terminal-button"
            onClick={() => {
              setActiveTab('login')
              resetMessages()
            }}
            style={{
              background: activeTab === 'login' ? '#ffffff' : 'transparent',
              color: activeTab === 'login' ? '#43464f' : '#ffffff',
            }}
          >
            [ Login ]
          </button>
          <button
            type="button"
            className="terminal-button"
            onClick={() => {
              setActiveTab('register')
              resetMessages()
            }}
            style={{
              background: activeTab === 'register' ? '#ffffff' : 'transparent',
              color: activeTab === 'register' ? '#43464f' : '#ffffff',
            }}
          >
            [ Register ]
          </button>
        </div>
        )}

        {activeTab === 'reset' && (
          <div style={{ color: '#ffffff', marginBottom: '18px', fontSize: '18px' }}>
            Choose a new password
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {activeTab !== 'reset' && (
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{
                width: '100%',
                background: 'transparent',
                border: '2px solid #ffffff',
                borderRadius: '4px',
                padding: '10px 14px',
                color: '#ffffff',
                fontSize: '16px',
                outline: 'none',
              }}
            />
          )}

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{
              width: '100%',
              background: 'transparent',
              border: '2px solid #ffffff',
              borderRadius: '4px',
              padding: '10px 14px',
              color: '#ffffff',
              fontSize: '16px',
              outline: 'none',
            }}
          />

          {(activeTab === 'register' || activeTab === 'reset') && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              style={{
                width: '100%',
                background: 'transparent',
                border: '2px solid #ffffff',
                borderRadius: '4px',
                padding: '10px 14px',
                color: '#ffffff',
                fontSize: '16px',
                outline: 'none',
              }}
            />
          )}

          {errorMessage && (
            <div style={{ color: '#ff6b6b', fontSize: '14px' }}>{errorMessage}</div>
          )}
          {successMessage && (
            <div style={{ color: '#7ed957', fontSize: '14px' }}>{successMessage}</div>
          )}

          {activeTab === 'reset' ? (
            <button
              type="button"
              className="terminal-button signin-btn"
              onClick={() => {
                void handleResetPassword()
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? '[ Updating... ]' : '[ Set New Password ]'}
            </button>
          ) : activeTab === 'login' ? (
            <>
              <button
                type="button"
                className="terminal-button signin-btn"
                onClick={() => {
                  void handleSignIn()
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? '[ Signing In... ]' : '[ Sign In ]'}
              </button>
              <button
                type="button"
                className="terminal-button"
                onClick={() => {
                  void handleForgotPassword()
                }}
                disabled={isSubmitting}
              >
                [ Forgot password? ]
              </button>
            </>
          ) : (
            <button
              type="button"
              className="terminal-button signin-btn"
              onClick={() => {
                void handleRegister()
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? '[ Registering... ]' : '[ Register ]'}
            </button>
          )}

          {activeTab !== 'reset' && (
          <button
            type="button"
            className="terminal-button google-btn"
            onClick={() => {
              void handleGoogle()
            }}
            disabled={isSubmitting}
          >
            [ G Continue with Google ]
          </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default LoginModal

import { type MouseEvent, useState } from 'react'

type SaveProjectModalProps = {
  isSaving: boolean
  onClose: () => void
  onSave: (projectName: string) => void | Promise<void>
}

function SaveProjectModal({
  isSaving,
  onClose,
  onSave,
}: SaveProjectModalProps) {
  const [projectName, setProjectName] = useState('')

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
          width: '420px',
          maxWidth: '90vw',
          padding: '28px',
        }}
      >
        <div style={{ color: '#ffffff', fontSize: '22px', marginBottom: '16px' }}>
          [ Save Project ]
        </div>

        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', marginBottom: '8px' }}>
          Project name
        </div>
        <input
          type="text"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="My Project"
          style={{
            width: '100%',
            background: 'transparent',
            border: '2px solid #ffffff',
            borderRadius: '4px',
            padding: '10px 12px',
            color: '#ffffff',
            fontSize: '16px',
            outline: 'none',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '18px' }}>
          <button type="button" className="terminal-button" onClick={onClose} disabled={isSaving}>
            [ Cancel ]
          </button>
          <button
            type="button"
            className="terminal-button"
            disabled={isSaving || projectName.trim().length === 0}
            onClick={() => onSave(projectName.trim())}
          >
            {isSaving ? '[ Saving... ]' : '[ Save ]'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SaveProjectModal

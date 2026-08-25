import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fastapi } from '../api/fastapi'
import { useAuthStore } from '../stores/authStore'

const MY_SUBMISSIONS_STORAGE_KEY = 'pct_my_submissions'
const GUEST_ACCOUNT_STORAGE_KEY = 'pct_guest_account_id'

type Difficulty = 'easy' | 'medium' | 'hard'
type ModerationStatus = 'approved' | 'pending' | 'rejected'

interface LocalSubmissionItem {
  id: string
  accountKey: string
  title: string
  description: string
  difficulty: Difficulty
  board: string
  moderationStatus: ModerationStatus
  createdAt: string
}

interface SubmissionItem {
  id: string
  title: string
  description: string
  difficulty: Difficulty
  board: string
  moderationStatus: ModerationStatus
  createdAt: string
}

const getOrCreateGuestAccountId = () => {
  const existing = window.localStorage.getItem(GUEST_ACCOUNT_STORAGE_KEY)
  if (existing) {
    return existing
  }
  const created = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  window.localStorage.setItem(GUEST_ACCOUNT_STORAGE_KEY, created)
  return created
}

const loadLocalSubmissions = () => {
  const raw = window.localStorage.getItem(MY_SUBMISSIONS_STORAGE_KEY)
  if (!raw) {
    return [] as LocalSubmissionItem[]
  }
  try {
    const parsed = JSON.parse(raw) as LocalSubmissionItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const saveLocalSubmissions = (items: LocalSubmissionItem[]) => {
  window.localStorage.setItem(MY_SUBMISSIONS_STORAGE_KEY, JSON.stringify(items))
}

function MySubmissionsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const accountKey = user?.id ?? getOrCreateGuestAccountId()
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionItem | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadSubmissions = async () => {
      setIsLoading(true)

      if (user?.id) {
        try {
          const response = await fastapi.get<{
            submissions?: Array<Record<string, unknown>>
          }>('/community/my-submissions', {
            params: { user_id: user.id },
          })

          const mapped = (response.data.submissions ?? []).map((item) => {
            const difficulty =
              item.difficulty === 'easy' ||
              item.difficulty === 'medium' ||
              item.difficulty === 'hard'
                ? item.difficulty
                : 'easy'

            const moderationStatus =
              item.moderation_status === 'approved' ||
              item.moderation_status === 'pending' ||
              item.moderation_status === 'rejected'
                ? item.moderation_status
                : item.status === 'approved' ||
                    item.status === 'pending' ||
                    item.status === 'rejected'
                  ? item.status
                  : 'pending'

            return {
              id:
                typeof item.id === 'string' || typeof item.id === 'number'
                  ? String(item.id)
                  : `unknown-${Date.now()}`,
              title: typeof item.title === 'string' ? item.title : 'Untitled',
              description:
                typeof item.description === 'string' ? item.description : '',
              difficulty,
              board: typeof item.board === 'string' ? item.board : '',
              moderationStatus,
              createdAt:
                typeof item.created_at === 'string'
                  ? item.created_at
                  : new Date().toISOString(),
            } satisfies SubmissionItem
          })

          mapped.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )

          if (isMounted) {
            setSubmissions(mapped)
            setIsLoading(false)
          }
          return
        } catch {
          if (isMounted) {
            setSubmissions([])
            setIsLoading(false)
          }
          return
        }
      }

      if (isMounted) {
        setSubmissions([])
        setIsLoading(false)
      }
    }

    void loadSubmissions()

    return () => {
      isMounted = false
    }
  }, [accountKey, refreshKey, user?.id])

  const handleOpenSubmission = (item: SubmissionItem) => {
    setSelectedSubmission(item)
    setIsEditing(false)
    setShowDeleteConfirm(false)
  }

  const handleEditSubmission = () => {
    if (!selectedSubmission) {
      return
    }
    setEditTitle(selectedSubmission.title)
    setEditDescription(selectedSubmission.description)
    setIsEditing(true)
  }

  const handleSaveEditSubmission = () => {
    if (!selectedSubmission) {
      return
    }
    if (editTitle.trim().length === 0 || editDescription.trim().length === 0) {
      return
    }
    const updated = {
      ...selectedSubmission,
      title: editTitle.trim(),
      description: editDescription.trim(),
    }

    if (user?.id) {
      void (async () => {
        try {
          const response = await fastapi.post<{ ok?: boolean }>(
            '/community/update-problem',
            {
              problem_id: selectedSubmission.id,
              title: updated.title,
              description: updated.description,
              difficulty: updated.difficulty,
              board: updated.board,
            },
          )

          if (response.data.ok !== true) {
            return
          }

          setSelectedSubmission(updated)
          setSubmissions((current) =>
            current.map((item) =>
              item.id === selectedSubmission.id ? updated : item,
            ),
          )
          setIsEditing(false)
          setRefreshKey((value) => value + 1)
        } catch {
          // keep current view unchanged on backend failure
        }
      })()
      return
    }

    const all = loadLocalSubmissions()
    const nextItems = all.map((item) =>
      item.id === selectedSubmission.id && item.accountKey === accountKey
        ? {
            ...item,
            title: updated.title,
            description: updated.description,
          }
        : item,
    )
    saveLocalSubmissions(nextItems)
    setSelectedSubmission(updated)
    setSubmissions((current) =>
      current.map((item) => (item.id === selectedSubmission.id ? updated : item)),
    )
    setIsEditing(false)
    setRefreshKey((value) => value + 1)
  }

  const handleDeleteSubmission = () => {
    if (!selectedSubmission) {
      return
    }
    if (user?.id) {
      void (async () => {
        try {
          const response = await fastapi.post<{ ok?: boolean }>(
            '/community/delete-problem',
            {
              problem_id: selectedSubmission.id,
            },
          )
          if (response.data.ok !== true) {
            return
          }
          setSubmissions((current) =>
            current.filter((item) => item.id !== selectedSubmission.id),
          )
          setSelectedSubmission(null)
          setShowDeleteConfirm(false)
          setIsEditing(false)
          setRefreshKey((value) => value + 1)
        } catch {
          // keep current view unchanged on backend failure
        }
      })()
      return
    }

    const all = loadLocalSubmissions()
    const nextItems = all.filter(
      (item) =>
        !(item.id === selectedSubmission.id && item.accountKey === accountKey),
    )
    saveLocalSubmissions(nextItems)
    setSubmissions((current) =>
      current.filter((item) => item.id !== selectedSubmission.id),
    )
    setSelectedSubmission(null)
    setShowDeleteConfirm(false)
    setIsEditing(false)
    setRefreshKey((value) => value + 1)
  }

  return (
    <div
      style={{
        height: 'calc(100vh - 72px)',
        width: '100%',
        minWidth: 0,
        padding: '8px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="terminal-panel panel" style={{ flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div className="terminal-label">[ My Submissions ]</div>
          <button
            type="button"
            className="terminal-button"
            onClick={() => navigate('/community')}
          >
            [ Open Community ]
          </button>
        </div>

        {selectedSubmission ? (
          <div
            className="panel-scroll panel-content"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              overflowY: 'auto',
              flex: 1,
              minHeight: 0,
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="terminal-button"
                onClick={() => {
                  setSelectedSubmission(null)
                  setIsEditing(false)
                }}
              >
                [ ← Back ]
              </button>
              <button
                type="button"
                className="terminal-button"
                onClick={() => navigate('/community')}
              >
                [ Open In Community ]
              </button>
              {isEditing ? (
                <>
                  <button
                    type="button"
                    className="terminal-button"
                    onClick={handleSaveEditSubmission}
                  >
                    [ Save ]
                  </button>
                  <button
                    type="button"
                    className="terminal-button"
                    onClick={() => setIsEditing(false)}
                  >
                    [ Cancel Edit ]
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="terminal-button"
                    onClick={handleEditSubmission}
                  >
                    [ Edit ]
                  </button>
                  <button
                    type="button"
                    className="terminal-button"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    [ Delete ]
                  </button>
                </>
              )}
            </div>

            {isEditing ? (
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '2px solid #ffffff',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  color: '#ffffff',
                  fontSize: '22px',
                  outline: 'none',
                }}
              />
            ) : (
              <div style={{ fontSize: '22px', color: '#ffffff' }}>{selectedSubmission.title}</div>
            )}
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
              {selectedSubmission.board}
            </div>
            <div
              className={`difficulty-badge difficulty-${selectedSubmission.difficulty}`}
              style={{
                fontSize: '13px',
                marginTop: '4px',
              }}
            >
              {selectedSubmission.difficulty.toUpperCase()}
            </div>
            <div
              className={`status-badge status-${selectedSubmission.moderationStatus}`}
              style={{
                fontSize: '13px',
              }}
            >
              {selectedSubmission.moderationStatus.toUpperCase()}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
              {new Date(selectedSubmission.createdAt).toLocaleString()}
            </div>
            {isEditing ? (
              <textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={12}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '2px solid #ffffff',
                  borderRadius: '4px',
                  padding: '10px 12px',
                  color: '#ffffff',
                  fontSize: '14px',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', color: '#ffffff', fontSize: '14px' }}>
                {selectedSubmission.description}
              </div>
            )}
          </div>
        ) : isLoading ? (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '15px' }}>
            Loading submissions...
          </div>
        ) : submissions.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '15px' }}>
            {user ? 'No submissions found for this account.' : 'Login to view your submissions.'}
          </div>
        ) : (
          <div
            className="panel-scroll panel-content"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '12px',
              overflowY: 'auto',
              minHeight: 0,
              paddingRight: '4px',
              alignContent: 'start',
              alignItems: 'start',
            }}
          >
            {submissions.map((item, index) => (
              <button
                type="button"
                className="interactive-hover-card submission-card"
                key={`${item.id}-${index}`}
                onClick={() => handleOpenSubmission(item)}
                style={{
                  textAlign: 'left',
                  border: '2px solid #ababb6',
                  borderRadius: '8px',
                  background: 'transparent',
                  color: '#ffffff',
                  padding: '14px',
                  height: 'fit-content',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: '20px', marginBottom: '8px' }}>{item.title}</div>
                <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>
                  {item.board}
                </div>
                <div
                  className={`status-badge status-${item.moderationStatus}`}
                  style={{
                    fontSize: '13px',
                    marginTop: '10px',
                  }}
                >
                  {item.moderationStatus.toUpperCase()}
                </div>
                <div
                  className={`difficulty-badge difficulty-${item.difficulty}`}
                  style={{
                    fontSize: '13px',
                    marginTop: '8px',
                  }}
                >
                  {item.difficulty.toUpperCase()}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginTop: '8px' }}>
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showDeleteConfirm && selectedSubmission && (
        <div
          className="modal-overlay"
          style={{ zIndex: 1200 }}
          role="presentation"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="modal-box"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: '#43464f',
              border: '2px solid #ababb6',
              borderRadius: '8px',
              width: '420px',
              maxWidth: '90vw',
              padding: '24px',
            }}
          >
            <div style={{ color: '#ffffff', fontSize: '20px', marginBottom: '16px' }}>
              Are you sure?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="terminal-button"
                onClick={() => setShowDeleteConfirm(false)}
              >
                [ Cancel ]
              </button>
              <button
                type="button"
                className="terminal-button"
                onClick={handleDeleteSubmission}
                style={{
                  background: '#e53935',
                  borderColor: '#e53935',
                  color: '#ffffff',
                }}
              >
                [ Delete ]
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MySubmissionsPage

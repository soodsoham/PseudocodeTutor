import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from '../stores/authStore'

type Difficulty = 'easy' | 'medium' | 'hard'

interface PendingModerationItem {
  queueId: number | string
  problemId: number | string
  title: string
  description: string
  difficulty: Difficulty
  submittedBy: string
  createdAt: string
}

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase()

function ModerationPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [pendingItems, setPendingItems] = useState<PendingModerationItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL
  const pendingCount = useMemo(() => pendingItems.length, [pendingItems.length])

  const fetchPendingItems = async () => {
    setIsLoading(true)
    setError(null)

    const { data: queueRows, error: queueError } = await supabase
      .from('moderation_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (queueError) {
      setError('Could not load moderation queue.')
      setIsLoading(false)
      return
    }

    const queueProblemRows = (queueRows ?? []).filter(
      (row) =>
        !row.content_type ||
        String(row.content_type).toLowerCase() === 'problem',
    )

    const problemIds = queueProblemRows
      .map((row) => {
        if (typeof row.problem_id === 'number' || typeof row.problem_id === 'string') {
          return row.problem_id
        }
        if (typeof row.content_id === 'number' || typeof row.content_id === 'string') {
          return row.content_id
        }
        return null
      })
      .filter((value): value is number | string => value !== null)

    if (problemIds.length === 0) {
      setPendingItems([])
      setIsLoading(false)
      return
    }

    const { data: problemsRows, error: problemsError } = await supabase
      .from('community_problems')
      .select('*')
      .in('id', problemIds)

    if (problemsError) {
      setError('Could not load community problems.')
      setIsLoading(false)
      return
    }

    const problemMap = new Map<string, Record<string, unknown>>(
      (problemsRows ?? []).map((row) => [String(row.id), row]),
    )

    const mapped: PendingModerationItem[] = queueProblemRows
      .map((queueRow) => {
        const queueId =
          typeof queueRow.id === 'number' || typeof queueRow.id === 'string'
            ? queueRow.id
            : null
        const problemId = typeof queueRow.problem_id === 'number' ||
          typeof queueRow.problem_id === 'string'
          ? queueRow.problem_id
          : typeof queueRow.content_id === 'number' ||
              typeof queueRow.content_id === 'string'
            ? queueRow.content_id
            : null
        if (queueId === null || problemId === null) {
          return null
        }

        const problemRow = problemMap.get(String(problemId))
        if (!problemRow) {
          return null
        }

        const difficulty =
          problemRow.difficulty === 'easy' ||
          problemRow.difficulty === 'medium' ||
          problemRow.difficulty === 'hard'
            ? problemRow.difficulty
            : 'easy'

        return {
          queueId,
          problemId,
          title:
            typeof problemRow.title === 'string' ? problemRow.title : 'Untitled',
          description:
            typeof problemRow.description === 'string' ? problemRow.description : '',
          difficulty,
          submittedBy:
            typeof problemRow.created_by === 'string'
              ? problemRow.created_by
              : 'Unknown',
          createdAt:
            typeof queueRow.created_at === 'string'
              ? queueRow.created_at
              : new Date().toISOString(),
        }
      })
      .filter((item): item is PendingModerationItem => item !== null)

    setPendingItems(mapped)
    setIsLoading(false)
  }

  useEffect(() => {
    if (!isAdmin) {
      return
    }
    // Loading the admin-only queue is the intended synchronization for this route.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchPendingItems()
  }, [isAdmin])

  const handleApprove = async (item: PendingModerationItem) => {
    const key = String(item.queueId)
    setBusyId(key)

    const { error: queueError } = await supabase
      .from('moderation_queue')
      .update({ status: 'approved' })
      .eq('id', item.queueId)

    if (queueError) {
      setError('Approve failed while updating moderation status.')
      setBusyId(null)
      return
    }

    setPendingItems((current) =>
      current.filter((candidate) => candidate.queueId !== item.queueId),
    )
    setBusyId(null)
  }

  const handleReject = async (item: PendingModerationItem) => {
    const key = String(item.queueId)
    setBusyId(key)

    const { error: queueError } = await supabase
      .from('moderation_queue')
      .update({ status: 'rejected' })
      .eq('id', item.queueId)

    if (queueError) {
      setError('Reject failed while updating moderation status.')
      setBusyId(null)
      return
    }

    const { error: deleteError } = await supabase
      .from('community_problems')
      .delete()
      .eq('id', item.problemId)

    if (deleteError) {
      setError('Reject failed while deleting problem.')
      setBusyId(null)
      return
    }

    setPendingItems((current) =>
      current.filter((candidate) => candidate.queueId !== item.queueId),
    )
    setBusyId(null)
  }

  if (!isAdmin) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="terminal-panel" style={{ flex: 1, minHeight: 0 }}>
          <div className="terminal-label" style={{ marginBottom: '14px' }}>
            [ Moderation Queue ]
          </div>
          <div style={{ color: '#ff6b6b', fontSize: '18px', marginBottom: '14px' }}>
            Access denied
          </div>
          <button
            type="button"
            className="terminal-button"
            onClick={() => navigate('/')}
            style={{ alignSelf: 'flex-start' }}
          >
            [ ← Back ]
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="terminal-panel" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div className="terminal-label" style={{ marginBottom: '14px' }}>
          [ Moderation Queue ({pendingCount}) ]
        </div>

        {error && (
          <div style={{ color: '#ff6b6b', marginBottom: '10px', fontSize: '14px' }}>
            {error}
          </div>
        )}

        {isLoading ? (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }}>
            Loading moderation queue...
          </div>
        ) : pendingItems.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px' }}>
            No pending items.
          </div>
        ) : (
          <div className="panel-scroll panel-content" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {pendingItems.map((item) => {
              const isBusy = busyId === String(item.queueId)
              return (
                <div
                  key={item.queueId}
                  style={{
                    border: '2px solid #ababb6',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ fontSize: '20px', color: '#ffffff' }}>{item.title}</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)' }}>
                    {item.difficulty.toUpperCase()} · Submitted by {item.submittedBy} ·{' '}
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', color: '#ffffff', fontSize: '14px' }}>
                    {item.description}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      type="button"
                      className="terminal-button"
                      disabled={isBusy}
                      onClick={() => {
                        void handleApprove(item)
                      }}
                    >
                      [ ✓ Approve ]
                    </button>
                    <button
                      type="button"
                      className="terminal-button"
                      disabled={isBusy}
                      onClick={() => {
                        void handleReject(item)
                      }}
                    >
                      [ ✗ Reject ]
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModerationPage

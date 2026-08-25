import { create } from 'zustand'

interface HintStoreState {
  currentHint: string | null
  hintLevel: 1 | 2 | 'trace-suggestion' | null
  attemptsByBlock: Record<string, number>
  showInlineTraceTable: boolean
  traceTableColumns: string[]
  isLoading: boolean
  setCurrentHint: (currentHint: string | null) => void
  setHintLevel: (hintLevel: 1 | 2 | 'trace-suggestion' | null) => void
  setAttemptsByBlock: (attemptsByBlock: Record<string, number>) => void
  setShowInlineTraceTable: (showInlineTraceTable: boolean) => void
  setTraceTableColumns: (traceTableColumns: string[]) => void
  setIsLoading: (isLoading: boolean) => void
}

export const useHintStore = create<HintStoreState>((set) => ({
  currentHint: null,
  hintLevel: null,
  attemptsByBlock: {},
  showInlineTraceTable: false,
  traceTableColumns: [],
  isLoading: false,
  setCurrentHint: (currentHint) => set({ currentHint }),
  setHintLevel: (hintLevel) => set({ hintLevel }),
  setAttemptsByBlock: (attemptsByBlock) => set({ attemptsByBlock }),
  setShowInlineTraceTable: (showInlineTraceTable) => set({ showInlineTraceTable }),
  setTraceTableColumns: (traceTableColumns) => set({ traceTableColumns }),
  setIsLoading: (isLoading) => set({ isLoading }),
}))

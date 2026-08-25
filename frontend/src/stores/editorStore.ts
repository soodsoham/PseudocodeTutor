import { create } from 'zustand'

export interface WarningItem {
  from: number
  to: number
  message: string
}

export interface SyntaxErrorItem {
  from: number
  to: number
  message: string
}

export interface ProblemCard {
  description: string
  inputs: string
  outputs: string
  constraints: string
}

interface EditorStoreState {
  pseudocode: string
  generatedCode: string
  lineMapping: Record<number, number[]>
  problemAttachmentText: string
  problemAttachmentPreviewUrl: string | null
  output: string | null
  outputStatus: 'empty' | 'running' | 'correct' | 'wrong' | 'error'
  tier1Warnings: WarningItem[]
  tier2Errors: SyntaxErrorItem[]
  activePseudoLine: number | null
  activeCodeLine: number | null
  problemCard: ProblemCard | null
  currentProjectId: number | string | null
  currentProjectName: string | null
  solutionTargetProblemId: number | string | null
  solutionTargetProblemTitle: string | null
  isProblemCardCollapsed: boolean
  isDebriefUnlocked: boolean
  isRunDisabled: boolean
  setPseudocode: (pseudocode: string) => void
  setGeneratedCode: (generatedCode: string) => void
  setLineMapping: (lineMapping: Record<number, number[]>) => void
  setProblemAttachmentText: (problemAttachmentText: string) => void
  setProblemAttachmentPreviewUrl: (problemAttachmentPreviewUrl: string | null) => void
  setOutput: (output: string | null) => void
  setOutputStatus: (
    outputStatus: 'empty' | 'running' | 'correct' | 'wrong' | 'error',
  ) => void
  setTier1Warnings: (tier1Warnings: WarningItem[]) => void
  setTier2Errors: (tier2Errors: SyntaxErrorItem[]) => void
  setActivePseudoLine: (activePseudoLine: number | null) => void
  setActiveCodeLine: (activeCodeLine: number | null) => void
  setProblemCard: (problemCard: ProblemCard | null) => void
  setCurrentProject: (
    project: { id: number | string; name: string } | null,
  ) => void
  setSolutionTargetProblem: (
    target: { id: number | string; title: string } | null,
  ) => void
  setIsProblemCardCollapsed: (isProblemCardCollapsed: boolean) => void
  setIsDebriefUnlocked: (isDebriefUnlocked: boolean) => void
  setIsRunDisabled: (isRunDisabled: boolean) => void
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  pseudocode: '',
  generatedCode: '',
  lineMapping: {},
  problemAttachmentText: '',
  problemAttachmentPreviewUrl: null,
  output: null,
  outputStatus: 'empty',
  tier1Warnings: [],
  tier2Errors: [],
  activePseudoLine: null,
  activeCodeLine: null,
  problemCard: null,
  currentProjectId: null,
  currentProjectName: null,
  solutionTargetProblemId: null,
  solutionTargetProblemTitle: null,
  isProblemCardCollapsed: false,
  isDebriefUnlocked: false,
  isRunDisabled: false,
  setPseudocode: (pseudocode) => set({ pseudocode }),
  setGeneratedCode: (generatedCode) => set({ generatedCode }),
  setLineMapping: (lineMapping) => set({ lineMapping }),
  setProblemAttachmentText: (problemAttachmentText) => set({ problemAttachmentText }),
  setProblemAttachmentPreviewUrl: (problemAttachmentPreviewUrl) =>
    set({ problemAttachmentPreviewUrl }),
  setOutput: (output) => set({ output }),
  setOutputStatus: (outputStatus) => set({ outputStatus }),
  setTier1Warnings: (tier1Warnings) => set({ tier1Warnings }),
  setTier2Errors: (tier2Errors) => set({ tier2Errors }),
  setActivePseudoLine: (activePseudoLine) => set({ activePseudoLine }),
  setActiveCodeLine: (activeCodeLine) => set({ activeCodeLine }),
  setProblemCard: (problemCard) => set({ problemCard }),
  setCurrentProject: (project) =>
    set({
      currentProjectId: project?.id ?? null,
      currentProjectName: project?.name ?? null,
    }),
  setSolutionTargetProblem: (target) =>
    set({
      solutionTargetProblemId: target?.id ?? null,
      solutionTargetProblemTitle: target?.title ?? null,
    }),
  setIsProblemCardCollapsed: (isProblemCardCollapsed) =>
    set({ isProblemCardCollapsed }),
  setIsDebriefUnlocked: (isDebriefUnlocked) => set({ isDebriefUnlocked }),
  setIsRunDisabled: (isRunDisabled) => set({ isRunDisabled }),
}))

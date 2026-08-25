import { create } from 'zustand'

export interface CommunityProblem {
  id: string
  title: string
  description: string
  inputs: string
  outputs: string
  constraints: string
}

interface CommunityStoreState {
  problems: CommunityProblem[]
  isLoading: boolean
  sortBy: 'newest' | 'most-attempted' | 'difficulty'
  setProblems: (problems: CommunityProblem[]) => void
  setIsLoading: (isLoading: boolean) => void
  setSortBy: (sortBy: 'newest' | 'most-attempted' | 'difficulty') => void
}

export const useCommunityStore = create<CommunityStoreState>((set) => ({
  problems: [],
  isLoading: false,
  sortBy: 'newest',
  setProblems: (problems) => set({ problems }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setSortBy: (sortBy) => set({ sortBy }),
}))

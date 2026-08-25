import { create } from 'zustand'

interface SettingsStoreState {
  board: string
  language: string
  theme: 'light' | 'dark'
  textSize: 'small' | 'medium' | 'large'
  isFirstRun: boolean
  tutorialDone: boolean
  setBoard: (board: string) => void
  setLanguage: (language: string) => void
  setTheme: (theme: 'light' | 'dark') => void
  setTextSize: (textSize: 'small' | 'medium' | 'large') => void
  setIsFirstRun: (isFirstRun: boolean) => void
  setTutorialDone: (tutorialDone: boolean) => void
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  board: 'cie-igcse',
  language: 'python',
  theme: 'dark',
  textSize: 'medium',
  isFirstRun: true,
  tutorialDone: false,
  setBoard: (board) => set({ board }),
  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  setTextSize: (textSize) => set({ textSize }),
  setIsFirstRun: (isFirstRun) => set({ isFirstRun }),
  setTutorialDone: (tutorialDone) => set({ tutorialDone }),
}))

import { create } from 'zustand'
import type { Route } from './types'

type Session = {
  history: { entries: Route[]; cursor: number };
  compared: string[];
  resetHistory: (route: Route) => void;
  navigate: (route: Route) => void;
  moveHistory: (direction: number) => void;
  setCompared: (names: string[]) => void;
}

export const useSession = create<Session>(set => ({
  history: { entries: [{ page: 'overview' }], cursor: 0 },
  compared: [],
  resetHistory: route => set({ history: { entries: [route], cursor: 0 } }),
  navigate: route => set(state => {
    const { entries, cursor } = state.history
    if (JSON.stringify(entries[cursor]) === JSON.stringify(route)) return state
    const updated = [...entries.slice(0, cursor + 1), route].slice(-40)
    return { history: { entries: updated, cursor: updated.length - 1 } }
  }),
  moveHistory: direction => set(({ history }) => ({
    history: { ...history, cursor: Math.min(history.entries.length - 1, Math.max(0, history.cursor + direction)) }
  })),
  setCompared: compared => set({ compared }),
}))

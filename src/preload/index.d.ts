import type { AgentyApi } from '../shared/types'

declare global {
  interface Window {
    agenty: AgentyApi
  }
}

export {}

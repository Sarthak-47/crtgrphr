/// <reference types="vite/client" />
import type { CartographApi } from '../../preload'

declare global {
  interface Window {
    cartographer: CartographApi
  }
}

export {}

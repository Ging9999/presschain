export type TorState = 'starting' | 'ready' | 'error'

export type StatusCode = 0 | 1 | 2 // Active | Flagged | Removed

/** On-chain article metadata (mirrors the preload PressChainApi ArticleMeta). */
export interface ArticleMeta {
  id: number
  title: string
  summary: string
  uploader: string
  timestamp: number
  status: StatusCode
  flagCount: number
  cid?: string
}

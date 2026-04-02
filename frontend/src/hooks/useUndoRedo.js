import { useRef, useCallback } from 'react'

const MAX_HISTORY = 50

export default function useUndoRedo() {
  const historyRef = useRef([])
  const pointerRef = useRef(-1)
  const isUndoRedoRef = useRef(false)

  // Push a new snapshot (deep-cloned). Called after every mutation.
  const pushState = useCallback((snapshot) => {
    // Don't record if this change came from undo/redo itself
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false
      return
    }
    const clone = JSON.parse(JSON.stringify(snapshot))
    // Truncate any redo entries ahead of pointer
    historyRef.current = historyRef.current.slice(0, pointerRef.current + 1)
    historyRef.current.push(clone)
    // Cap size
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current = historyRef.current.slice(historyRef.current.length - MAX_HISTORY)
    }
    pointerRef.current = historyRef.current.length - 1
  }, [])

  // Undo: returns previous snapshot or null
  const undo = useCallback(() => {
    if (pointerRef.current <= 0) return null
    pointerRef.current -= 1
    isUndoRedoRef.current = true
    return JSON.parse(JSON.stringify(historyRef.current[pointerRef.current]))
  }, [])

  // Redo: returns next snapshot or null
  const redo = useCallback(() => {
    if (pointerRef.current >= historyRef.current.length - 1) return null
    pointerRef.current += 1
    isUndoRedoRef.current = true
    return JSON.parse(JSON.stringify(historyRef.current[pointerRef.current]))
  }, [])

  const canUndo = useCallback(() => pointerRef.current > 0, [])
  const canRedo = useCallback(() => pointerRef.current < historyRef.current.length - 1, [])

  // Reset history (e.g. on new project)
  const reset = useCallback(() => {
    historyRef.current = []
    pointerRef.current = -1
  }, [])

  return { pushState, undo, redo, canUndo, canRedo, reset }
}

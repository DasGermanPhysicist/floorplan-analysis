import React, { useState } from 'react'
import { Radio, Keyboard } from 'lucide-react'

const SHORTCUTS = [
  ['1 / 2 / 3', 'Switch to Setup / Place / Review'],
  ['B', 'Place beacon'],
  ['A', 'Place access point'],
  ['G', 'Place gateway'],
  ['M', 'Measure distance'],
  ['⌘/Ctrl + Z', 'Undo'],
  ['⌘/Ctrl + ⇧Z', 'Redo'],
  ['Esc', 'Cancel current mode'],
  ['Delete', 'Delete selected devices'],
  ['⌘/Ctrl + S', 'Save project'],
]

export default function Header() {
  const [showHelp, setShowHelp] = useState(false)

  return (
    <header className="bg-linklabs-900 text-white px-6 py-3 flex items-center gap-3 shadow-lg relative">
      <Radio className="w-7 h-7 text-linklabs-400" />
      <div className="flex-1">
        <h1 className="text-lg font-bold tracking-tight">AirFinder 2 — Floorplan Analyzer</h1>
        <p className="text-xs text-linklabs-300">Link Labs Infrastructure Planning Tool</p>
      </div>
      <button
        onClick={() => setShowHelp(prev => !prev)}
        className="p-2 rounded-lg hover:bg-linklabs-800 transition-colors text-linklabs-300 hover:text-white"
        title="Keyboard shortcuts"
      >
        <Keyboard className="w-5 h-5" />
      </button>
      {showHelp && (
        <div className="absolute right-4 top-full mt-2 bg-white text-gray-800 rounded-xl shadow-2xl border border-gray-200 p-4 z-50 w-72">
          <h3 className="text-sm font-bold mb-2 text-gray-900">Keyboard Shortcuts</h3>
          <div className="space-y-1.5">
            {SHORTCUTS.map(([key, desc]) => (
              <div key={key} className="flex items-center gap-2 text-xs">
                <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono font-semibold text-gray-700 min-w-[60px] text-center">{key}</kbd>
                <span className="text-gray-600">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

import React from 'react'
import { Radio } from 'lucide-react'

export default function Header() {
  return (
    <header className="bg-linklabs-900 text-white px-6 py-3 flex items-center gap-3 shadow-lg">
      <Radio className="w-7 h-7 text-linklabs-400" />
      <div>
        <h1 className="text-lg font-bold tracking-tight">AirFinder 2 — Floorplan Analyzer</h1>
        <p className="text-xs text-linklabs-300">Link Labs Infrastructure Planning Tool</p>
      </div>
    </header>
  )
}

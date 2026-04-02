import React, { useCallback, useState, useEffect } from 'react'
import { Upload, FileUp, Loader2, FolderOpen } from 'lucide-react'

const PROCESSING_STEPS = [
  { label: 'Reading file...', pct: 10 },
  { label: 'Detecting walls...', pct: 30 },
  { label: 'Detecting rooms...', pct: 55 },
  { label: 'Building masks...', pct: 75 },
  { label: 'Generating visualizations...', pct: 90 },
]

export default function UploadPanel({ onUpload, onLoadProject, loading }) {
  const [dragOver, setDragOver] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [skipAnalysis, setSkipAnalysis] = useState(false)

  // Animate through processing steps while loading
  useEffect(() => {
    if (!loading) { setStepIndex(0); return }
    setStepIndex(0)
    const timers = PROCESSING_STEPS.map((_, i) =>
      setTimeout(() => setStepIndex(i), i * 2200)
    )
    return () => timers.forEach(clearTimeout)
  }, [loading])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onUpload(file, { skipAnalysis })
  }, [onUpload, skipAnalysis])

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files[0]
    if (file) onUpload(file, { skipAnalysis })
  }, [onUpload, skipAnalysis])

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div
        className={`w-full max-w-xl border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
          dragOver ? 'border-linklabs-500 bg-linklabs-50' : 'border-gray-300 bg-white'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {loading ? (
          <div className="flex flex-col items-center gap-4 w-full max-w-sm mx-auto">
            <Loader2 className="w-10 h-10 text-linklabs-600 animate-spin" />
            <p className="text-gray-700 text-lg font-medium">Processing floorplan</p>
            <div className="w-full">
              <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-linklabs-600 h-2.5 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${PROCESSING_STEPS[Math.min(stepIndex, PROCESSING_STEPS.length - 1)].pct}%` }}
                />
              </div>
              <p className="text-sm text-gray-500 mt-2 text-center">
                {PROCESSING_STEPS[Math.min(stepIndex, PROCESSING_STEPS.length - 1)].label}
              </p>
            </div>
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-700 mb-2">Upload a Floorplan</h2>
            <p className="text-gray-500 mb-6">
              Drag and drop a PDF or image file, or click to browse.
            </p>
            <label className="inline-flex items-center gap-2 px-6 py-3 bg-linklabs-600 text-white rounded-lg cursor-pointer hover:bg-linklabs-700 transition-colors font-medium">
              <FileUp className="w-5 h-5" />
              Choose File
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.bmp,.tiff"
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>
            <label className="flex items-center gap-2 mt-4 text-sm text-gray-500 cursor-pointer justify-center">
              <input
                type="checkbox"
                checked={skipAnalysis}
                onChange={e => setSkipAnalysis(e.target.checked)}
                className="rounded text-linklabs-600 focus:ring-linklabs-500"
              />
              Skip room analysis (manual placement only)
            </label>
            <p className="text-xs text-gray-400 mt-2">Supports PDF, PNG, JPG, BMP, TIFF</p>
            {onLoadProject && (
              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-sm text-gray-500 mb-3">Or load a previously saved project:</p>
                <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors font-medium text-sm">
                  <FolderOpen className="w-4 h-4" />
                  Load Project (.zip)
                  <input
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={e => { const f = e.target.files[0]; if (f) onLoadProject(f) }}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

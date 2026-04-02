import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import Header from './components/Header'
import UploadPanel from './components/UploadPanel'
import Sidebar from './components/Sidebar'
import FloorplanCanvas from './components/FloorplanCanvas'
import BOMPanel from './components/BOMPanel'
import StatsPanel from './components/StatsPanel'

const API_BASE = ''

export default function App() {
  const [project, setProject] = useState(null)       // { project_id, filename, floors[], config }
  const [activeFloorIndex, setActiveFloorIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('setup')
  const [overlayMode, setOverlayMode] = useState('original')
  const [placementTool, setPlacementTool] = useState(null)
  const [calibrating, setCalibrating] = useState(false)
  const [calibrationPoints, setCalibrationPoints] = useState([])
  const [showBOM, setShowBOM] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [selectedDevices, setSelectedDevices] = useState(new Set())
  // interactionMode: null | 'select' | 'drawRoom' | 'deleteRoom' | 'ruler'
  const [interactionMode, setInteractionMode] = useState(null)
  const [rulerPoints, setRulerPoints] = useState([])
  const [visibleLayers, setVisibleLayers] = useState({
    beacons: true, access_points: true, gateways: true, rooms: true, ap_coverage: true,
  })

  const [config, setConfig] = useState({
    beacon_spacing_ft: 45,
    ap_spacing_ft: 100,
    gateway_to_ap_ratio: 0.1,
    scale_pixels_per_ft: null,
    beacons_per_room: 1,
    unit: 'ft',
  })

  // ── Autosave to localStorage ──────────────────────────────────────────────
  const autosaveTimer = useRef(null)
  useEffect(() => {
    if (!project?.project_id) return
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem('floorplan_autosave', JSON.stringify({
          project_id: project.project_id,
          config,
          activeFloorIndex,
          activeTab,
          ts: Date.now(),
        }))
      } catch { /* quota exceeded — ignore */ }
    }, 2000)
    return () => clearTimeout(autosaveTimer.current)
  }, [project, config, activeFloorIndex, activeTab])

  // ── Restore session on mount ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('floorplan_autosave'))
      if (!saved?.project_id) return
      // Only restore if saved within the last 4 hours
      if (Date.now() - saved.ts > 4 * 60 * 60 * 1000) {
        localStorage.removeItem('floorplan_autosave')
        return
      }
      fetch(`${API_BASE}/api/project/${saved.project_id}`)
        .then(r => { if (!r.ok) throw new Error(); return r.json() })
        .then(data => {
          setProject(data)
          if (saved.config) setConfig(prev => ({ ...prev, ...saved.config, unit: saved.config.unit || 'ft' }))
          if (typeof saved.activeFloorIndex === 'number') setActiveFloorIndex(saved.activeFloorIndex)
          if (saved.activeTab) setActiveTab(saved.activeTab)
        })
        .catch(() => localStorage.removeItem('floorplan_autosave'))
    } catch { /* no saved session */ }
  }, [])

  // Listen for ruler cancel (Esc key in canvas)
  useEffect(() => {
    const handler = () => { setInteractionMode(null); setRulerPoints([]) }
    window.addEventListener('ruler-cancel', handler)
    return () => window.removeEventListener('ruler-cancel', handler)
  }, [])

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Ignore if typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (!project) return

      const key = e.key.toLowerCase()

      // Tab navigation: 1 = Setup, 2 = Place, 3 = Review
      if (key === '1') { setActiveTab('setup'); return }
      if (key === '2') { setActiveTab('place'); return }
      if (key === '3') { setActiveTab('review'); return }

      // Escape: cancel any active mode
      if (key === 'escape') {
        setInteractionMode(null)
        setPlacementTool(null)
        setCalibrating(false)
        setRulerPoints([])
        setSelectedDevices(new Set())
        return
      }

      // M = measure (ruler)
      if (key === 'm' && !e.metaKey && !e.ctrlKey) {
        setInteractionMode(prev => prev === 'ruler' ? null : 'ruler')
        setRulerPoints([])
        return
      }

      // S = save project (Cmd/Ctrl+S)
      if (key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (project) window.open(`${API_BASE}/api/save-project/${project.project_id}`, '_blank')
        return
      }

      // B = place beacon
      if (key === 'b' && !e.metaKey && !e.ctrlKey) {
        setPlacementTool(prev => prev === 'beacon' ? null : 'beacon')
        setInteractionMode(null)
        return
      }
      // A = place access point
      if (key === 'a' && !e.metaKey && !e.ctrlKey) {
        setPlacementTool(prev => prev === 'access_point' ? null : 'access_point')
        setInteractionMode(null)
        return
      }
      // G = place gateway
      if (key === 'g' && !e.metaKey && !e.ctrlKey) {
        setPlacementTool(prev => prev === 'gateway' ? null : 'gateway')
        setInteractionMode(null)
        return
      }

      // Delete/Backspace = delete selected devices
      if ((key === 'delete' || key === 'backspace') && selectedDevices.size > 0) {
        e.preventDefault()
        handleBulkDelete()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [project, selectedDevices, handleBulkDelete])

  // Derived: active floor data (what canvas & sidebar work with)
  const activeFloor = useMemo(() => {
    if (!project?.floors) return null
    return project.floors[activeFloorIndex] || project.floors[0] || null
  }, [project, activeFloorIndex])

  // Room detection params are per-floor
  const roomDetectionParams = activeFloor?.room_detection_params || {
    sensitivity: 8, min_room_area_pct: 0.005, max_room_area_pct: 6.0,
    min_dilation: 6, max_dilation: 20, num_scales: 5,
    solidity_threshold: 0.25, max_aspect_ratio: 10.0,
  }

  const setRoomDetectionParams = useCallback((updater) => {
    setProject(prev => {
      if (!prev) return prev
      const floors = [...prev.floors]
      const idx = activeFloorIndex
      const newParams = typeof updater === 'function'
        ? updater(floors[idx].room_detection_params)
        : updater
      floors[idx] = { ...floors[idx], room_detection_params: newParams }
      return { ...prev, floors }
    })
  }, [activeFloorIndex])

  // Build a "floorplan-like" object the canvas understands (flat shape)
  const canvasProject = useMemo(() => {
    if (!activeFloor) return null
    return {
      project_id: project.project_id,
      filename: project.filename,
      image_url: activeFloor.image_url,
      walls_image_url: activeFloor.walls_image_url,
      rooms_image_url: activeFloor.rooms_image_url,
      width: activeFloor.width,
      height: activeFloor.height,
      rooms: activeFloor.rooms,
      walls: activeFloor.walls,
      placements: activeFloor.placements,
    }
  }, [project, activeFloor])

  // ── Upload ──────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (file, options = {}) => {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const params = options.skipAnalysis ? '?skip_analysis=true' : ''
      const res = await fetch(`${API_BASE}/api/upload${params}`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed')
      const data = await res.json()
      setProject(data)
      if (data.config) setConfig(prev => ({ ...prev, ...data.config, unit: data.config.unit || 'ft' }))
      setActiveFloorIndex(0)
      setActiveTab('setup')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Load saved project ────────────────────────────────────────────────────
  const handleLoadProject = useCallback(async (file) => {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/api/load-project`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error((await res.json()).detail || 'Load failed')
      const data = await res.json()
      setProject(data)
      if (data.config) setConfig(prev => ({ ...prev, ...data.config, unit: data.config.unit || 'ft' }))
      setActiveFloorIndex(0)
      setActiveTab('setup')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Calibrate scale (per-floor with global fallback) ─────────────────────
  const handleCalibrateScale = useCallback(async (pixelDistance, realDistanceFt) => {
    if (!project) return
    try {
      const res = await fetch(`${API_BASE}/api/calibrate-scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          pixel_distance: pixelDistance,
          real_distance_ft: realDistanceFt,
          floor_index: activeFloorIndex,
        }),
      })
      const data = await res.json()
      // Update global config scale
      setConfig(prev => ({ ...prev, scale_pixels_per_ft: data.scale_pixels_per_ft }))
      // Store per-floor scale on the floor object
      setProject(prev => {
        const floors = [...prev.floors]
        floors[activeFloorIndex] = { ...floors[activeFloorIndex], scale_pixels_per_ft: data.scale_pixels_per_ft }
        return { ...prev, floors }
      })
      setCalibrating(false)
      setCalibrationPoints([])
    } catch (e) {
      setError(e.message)
    }
  }, [project, activeFloorIndex])

  // ── Auto-place (per floor) ────────────────────────────────────────────────
  const handleAutoPlace = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${API_BASE}/api/auto-place?project_id=${project.project_id}&floor_index=${activeFloorIndex}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) },
      )
      if (!res.ok) throw new Error((await res.json()).detail || 'Auto-placement failed')
      const data = await res.json()
      setProject(prev => {
        const floors = [...prev.floors]
        floors[activeFloorIndex] = { ...floors[activeFloorIndex], placements: data.placements }
        return { ...prev, floors }
      })
      setActiveTab('review')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [project, config, activeFloorIndex])

  // ── Manual placement (per floor) ──────────────────────────────────────────
  const handleManualPlace = useCallback(async (deviceType, x, y, action, deviceId) => {
    if (!project) return
    try {
      const res = await fetch(`${API_BASE}/api/manual-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          floor_index: activeFloorIndex,
          device_type: deviceType,
          x, y, action, device_id: deviceId,
        }),
      })
      const data = await res.json()

      // Re-fetch full project state
      const projRes = await fetch(`${API_BASE}/api/project/${project.project_id}`)
      const projData = await projRes.json()
      setProject(projData)

      return data
    } catch (e) {
      setError(e.message)
    }
  }, [project, activeFloorIndex])

  // ── Reprocess rooms (per floor) ───────────────────────────────────────────
  const handleReprocess = useCallback(async (params) => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${API_BASE}/api/reprocess?project_id=${project.project_id}&floor_index=${activeFloorIndex}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) },
      )
      if (!res.ok) throw new Error((await res.json()).detail || 'Reprocess failed')
      const data = await res.json()
      setProject(prev => {
        const floors = [...prev.floors]
        floors[activeFloorIndex] = data
        return { ...prev, floors }
      })
      setOverlayMode('rooms')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [project, activeFloorIndex])

  // ── Rename floor ──────────────────────────────────────────────────────────
  const handleRenameFloor = useCallback(async (floorIndex, name) => {
    if (!project) return
    try {
      await fetch(`${API_BASE}/api/rename-floor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.project_id, floor_index: floorIndex, name }),
      })
      setProject(prev => {
        const floors = [...prev.floors]
        floors[floorIndex] = { ...floors[floorIndex], name }
        return { ...prev, floors }
      })
    } catch (e) {
      setError(e.message)
    }
  }, [project])

  // ── Save project ──────────────────────────────────────────────────────────
  const handleSaveProject = useCallback(async () => {
    if (!project) return
    window.open(`${API_BASE}/api/save-project/${project.project_id}`, '_blank')
  }, [project])

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const handleExportPDF = useCallback(async () => {
    if (!project) return
    window.open(`${API_BASE}/api/export-pdf/${project.project_id}`, '_blank')
  }, [project])

  // ── Auto-place ALL floors ──────────────────────────────────────────────────
  const handleAutoPlaceAll = useCallback(async () => {
    if (!project) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${API_BASE}/api/auto-place-all?project_id=${project.project_id}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) },
      )
      if (!res.ok) throw new Error((await res.json()).detail || 'Auto-placement failed')
      const data = await res.json()
      setProject(prev => ({ ...prev, floors: data.floors }))
      setActiveTab('review')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [project, config])

  // ── Bulk delete selected devices ──────────────────────────────────────────
  const handleBulkDelete = useCallback(async () => {
    if (!project || selectedDevices.size === 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          floor_index: activeFloorIndex,
          device_ids: [...selectedDevices],
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Bulk delete failed')
      const data = await res.json()
      setProject(prev => {
        const floors = [...prev.floors]
        floors[activeFloorIndex] = { ...floors[activeFloorIndex], placements: data.placements }
        return { ...prev, floors }
      })
      setSelectedDevices(new Set())
      setInteractionMode(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [project, activeFloorIndex, selectedDevices])

  // ── Delete room ───────────────────────────────────────────────────────────
  const handleDeleteRoom = useCallback(async (roomId) => {
    if (!project) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/delete-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          floor_index: activeFloorIndex,
          room_id: roomId,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Delete room failed')
      const data = await res.json()
      setProject(prev => {
        const floors = [...prev.floors]
        floors[activeFloorIndex] = data
        return { ...prev, floors }
      })
      // Stay in deleteRoom mode so user can keep clicking rooms
    } catch (e) {
      setError(e.message)
    }
  }, [project, activeFloorIndex])

  // ── Draw room ─────────────────────────────────────────────────────────────
  const handleDrawRoom = useCallback(async (contour) => {
    if (!project) return
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/draw-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          floor_index: activeFloorIndex,
          contour,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Draw room failed')
      const data = await res.json()
      setProject(prev => {
        const floors = [...prev.floors]
        floors[activeFloorIndex] = data
        return { ...prev, floors }
      })
      // Stay in drawRoom mode so user can immediately draw the next room
    } catch (e) {
      setError(e.message)
    }
  }, [project, activeFloorIndex])

  // ── Canvas interactions ───────────────────────────────────────────────────
  const handleCanvasClick = useCallback((x, y) => {
    if (calibrating) {
      setCalibrationPoints(prev => [...prev, { x, y }])
      return
    }
    if (interactionMode === 'ruler') {
      setRulerPoints(prev => {
        if (prev.length >= 2) return [{ x, y }]
        return [...prev, { x, y }]
      })
      return
    }
    if (placementTool) {
      handleManualPlace(placementTool, x, y, 'add')
    }
  }, [calibrating, placementTool, handleManualPlace, interactionMode])

  const handleDeviceDrag = useCallback((deviceType, deviceId, newX, newY) => {
    handleManualPlace(deviceType, newX, newY, 'move', deviceId)
  }, [handleManualPlace])

  const handleDeviceDelete = useCallback((deviceType, deviceId) => {
    handleManualPlace(deviceType, 0, 0, 'remove', deviceId)
  }, [handleManualPlace])

  // ── New project ───────────────────────────────────────────────────────────
  const handleNewProject = useCallback(() => {
    setProject(null)
    setActiveFloorIndex(0)
    setSelectedDevices(new Set())
    setInteractionMode(null)
    setConfig(prev => ({ ...prev, scale_pixels_per_ft: null }))
    localStorage.removeItem('floorplan_autosave')
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />

      {error && (
        <div className="mx-4 mt-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">×</button>
        </div>
      )}

      {!project ? (
        <UploadPanel onUpload={handleUpload} onLoadProject={handleLoadProject} loading={loading} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            project={project}
            activeFloor={activeFloor}
            activeFloorIndex={activeFloorIndex}
            setActiveFloorIndex={setActiveFloorIndex}
            config={config}
            setConfig={setConfig}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            overlayMode={overlayMode}
            setOverlayMode={setOverlayMode}
            placementTool={placementTool}
            setPlacementTool={setPlacementTool}
            calibrating={calibrating}
            setCalibrating={setCalibrating}
            calibrationPoints={calibrationPoints}
            onCalibrateScale={handleCalibrateScale}
            onAutoPlace={handleAutoPlace}
            onAutoPlaceAll={handleAutoPlaceAll}
            onExportBOM={() => setShowBOM(true)}
            onExportPDF={handleExportPDF}
            onSaveProject={handleSaveProject}
            onNewProject={handleNewProject}
            onRenameFloor={handleRenameFloor}
            loading={loading}
            roomDetectionParams={roomDetectionParams}
            setRoomDetectionParams={setRoomDetectionParams}
            onReprocess={handleReprocess}
            selectedDevices={selectedDevices}
            interactionMode={interactionMode}
            setInteractionMode={setInteractionMode}
            onBulkDelete={handleBulkDelete}
            onShowStats={() => setShowStats(true)}
            visibleLayers={visibleLayers}
            setVisibleLayers={setVisibleLayers}
            rulerPoints={rulerPoints}
            setRulerPoints={setRulerPoints}
          />

          <div className="flex-1 p-4 overflow-hidden">
            {canvasProject && (
              <FloorplanCanvas
                key={`floor-${activeFloorIndex}`}
                project={canvasProject}
                overlayMode={overlayMode}
                placementTool={placementTool}
                calibrating={calibrating}
                calibrationPoints={calibrationPoints}
                onClick={handleCanvasClick}
                onDeviceDrag={handleDeviceDrag}
                onDeviceDelete={handleDeviceDelete}
                interactionMode={interactionMode}
                selectedDevices={selectedDevices}
                setSelectedDevices={setSelectedDevices}
                onDeleteRoom={handleDeleteRoom}
                onDrawRoom={handleDrawRoom}
                config={config}
                visibleLayers={visibleLayers}
                rulerPoints={rulerPoints}
              />
            )}
          </div>
        </div>
      )}

      {showBOM && project && (
        <BOMPanel
          project={project}
          onClose={() => setShowBOM(false)}
        />
      )}

      {showStats && project && (
        <StatsPanel
          project={project}
          config={config}
          onClose={() => setShowStats(false)}
        />
      )}
    </div>
  )
}

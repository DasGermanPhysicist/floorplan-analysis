import React, { useState, useCallback, useMemo } from 'react'
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
  // interactionMode: null | 'select' | 'drawRoom' | 'deleteRoom'
  const [interactionMode, setInteractionMode] = useState(null)

  const [config, setConfig] = useState({
    beacon_spacing_ft: 45,
    ap_spacing_ft: 100,
    gateway_to_ap_ratio: 0.1,
    scale_pixels_per_ft: null,
    beacons_per_room: 1,
    unit: 'ft',
  })

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
  const handleUpload = useCallback(async (file) => {
    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData })
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

  // ── Calibrate scale (global) ──────────────────────────────────────────────
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
        }),
      })
      const data = await res.json()
      setConfig(prev => ({ ...prev, scale_pixels_per_ft: data.scale_pixels_per_ft }))
      setCalibrating(false)
      setCalibrationPoints([])
    } catch (e) {
      setError(e.message)
    }
  }, [project])

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
    if (placementTool) {
      handleManualPlace(placementTool, x, y, 'add')
    }
  }, [calibrating, placementTool, handleManualPlace])

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

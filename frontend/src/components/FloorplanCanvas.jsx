import React, { useRef, useEffect, useState, useCallback } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'

const DEVICE_COLORS = {
  beacon: { fill: '#3b82f6', stroke: '#1d4ed8', label: 'B' },
  access_point: { fill: '#22c55e', stroke: '#15803d', label: 'AP' },
  gateway: { fill: '#a855f7', stroke: '#7e22ce', label: 'GW' },
}

const DEVICE_RADIUS = 12

export default function FloorplanCanvas({
  project, overlayMode, placementTool, calibrating, calibrationPoints,
  onClick, onDeviceDrag, onDeviceDelete,
  interactionMode, selectedDevices, setSelectedDevices,
  onDeleteRoom, onDrawRoom, config, visibleLayers, rulerPoints,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [image, setImage] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [draggingDevice, setDraggingDevice] = useState(null)
  const [hoveredDevice, setHoveredDevice] = useState(null)
  // Rectangle selection state
  const [selectStart, setSelectStart] = useState(null)
  const [selectEnd, setSelectEnd] = useState(null)
  // Room drawing state
  const [drawingPoints, setDrawingPoints] = useState([])
  // Hovered room (for delete mode)
  const [hoveredRoom, setHoveredRoom] = useState(null)

  // Load the appropriate image based on overlay mode
  useEffect(() => {
    const img = new Image()
    let url
    if (overlayMode === 'walls' && project.walls_image_url) {
      url = project.walls_image_url
    } else if (overlayMode === 'rooms' && project.rooms_image_url) {
      url = project.rooms_image_url
    } else {
      url = project.image_url
    }
    img.src = url
    img.onload = () => {
      setImage(img)
      // Fit to container
      if (containerRef.current) {
        const container = containerRef.current
        const scaleX = (container.clientWidth - 20) / img.width
        const scaleY = (container.clientHeight - 20) / img.height
        const fitZoom = Math.min(scaleX, scaleY, 1)
        setZoom(fitZoom)
        setOffset({
          x: (container.clientWidth - img.width * fitZoom) / 2,
          y: (container.clientHeight - img.height * fitZoom) / 2,
        })
      }
    }
  }, [overlayMode, project.image_url, project.walls_image_url, project.rooms_image_url])

  // Find room at floorplan coords
  const findRoomAt = useCallback((fx, fy) => {
    if (!project.rooms) return null
    for (let i = project.rooms.length - 1; i >= 0; i--) {
      const room = project.rooms[i]
      if (room.contour && room.contour.length > 2) {
        // Point-in-polygon test (ray casting)
        let inside = false
        const pts = room.contour
        for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
          const xi = pts[j][0], yi = pts[j][1]
          const xk = pts[k][0], yk = pts[k][1]
          if (((yi > fy) !== (yk > fy)) && (fx < (xk - xi) * (fy - yi) / (yk - yi) + xi)) {
            inside = !inside
          }
        }
        if (inside) return room
      }
    }
    return null
  }, [project.rooms])

  // Draw everything on canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return

    const ctx = canvas.getContext('2d')
    const container = containerRef.current
    if (!container) return

    canvas.width = container.clientWidth
    canvas.height = container.clientHeight

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw checkerboard background
    const tileSize = 20
    for (let x = 0; x < canvas.width; x += tileSize) {
      for (let y = 0; y < canvas.height; y += tileSize) {
        ctx.fillStyle = ((x + y) / tileSize) % 2 === 0 ? '#f1f5f9' : '#e2e8f0'
        ctx.fillRect(x, y, tileSize, tileSize)
      }
    }

    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(zoom, zoom)

    // Draw floorplan image
    ctx.drawImage(image, 0, 0)

    // Draw rooms overlay
    if (project.rooms && project.rooms.length > 0 && visibleLayers?.rooms !== false) {
      const isDeleteMode = interactionMode === 'deleteRoom'
      const baseAlpha = isDeleteMode ? 0.2 : 0.08
      project.rooms.forEach((room, i) => {
        if (room.contour && room.contour.length > 2) {
          const hue = (i * 47) % 360
          const isHovRoom = hoveredRoom && hoveredRoom.id === room.id

          ctx.globalAlpha = isHovRoom ? 0.5 : baseAlpha
          ctx.fillStyle = isHovRoom ? '#ef4444' : `hsl(${hue}, 60%, 50%)`
          ctx.beginPath()
          ctx.moveTo(room.contour[0][0], room.contour[0][1])
          room.contour.forEach(pt => ctx.lineTo(pt[0], pt[1]))
          ctx.closePath()
          ctx.fill()

          if (isDeleteMode) {
            ctx.globalAlpha = isHovRoom ? 0.8 : 0.4
            ctx.strokeStyle = isHovRoom ? '#ef4444' : `hsl(${hue}, 60%, 40%)`
            ctx.lineWidth = (isHovRoom ? 3 : 1.5) / zoom
            ctx.stroke()
          }
        }
      })
      ctx.globalAlpha = 1
    }

    // Draw placed devices (filtered by layer visibility)
    const allDevices = [
      ...(visibleLayers?.beacons !== false ? (project.placements?.beacons || []).map(d => ({ ...d, type: 'beacon' })) : []),
      ...(visibleLayers?.access_points !== false ? (project.placements?.access_points || []).map(d => ({ ...d, type: 'access_point' })) : []),
      ...(visibleLayers?.gateways !== false ? (project.placements?.gateways || []).map(d => ({ ...d, type: 'gateway' })) : []),
    ]

    allDevices.forEach(device => {
      const colors = DEVICE_COLORS[device.type]
      const r = DEVICE_RADIUS / zoom
      const isHovered = hoveredDevice && hoveredDevice.id === device.id
      const isDragging = draggingDevice && draggingDevice.id === device.id
      const isSelected = selectedDevices && selectedDevices.has(device.id)

      // Coverage radius visualization
      if (device.type === 'access_point' && visibleLayers?.ap_coverage !== false) {
        const apRadiusPx = (config?.scale_pixels_per_ft && config?.ap_spacing_ft)
          ? (config.ap_spacing_ft / 2) * config.scale_pixels_per_ft
          : 150
        ctx.beginPath()
        ctx.arc(device.x, device.y, apRadiusPx, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(34, 197, 94, 0.06)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.15)'
        ctx.lineWidth = 1 / zoom
        ctx.stroke()
      }

      // Selection ring
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(device.x, device.y, r * 1.8, 0, Math.PI * 2)
        ctx.strokeStyle = '#f59e0b'
        ctx.lineWidth = 3 / zoom
        ctx.setLineDash([4 / zoom, 3 / zoom])
        ctx.stroke()
        ctx.setLineDash([])
      }

      // Device marker — distinct shapes per type
      const s = r * (isHovered ? 1.3 : 1)
      ctx.fillStyle = isDragging ? colors.stroke : (isSelected ? '#f59e0b' : colors.fill)
      ctx.strokeStyle = isHovered ? '#fff' : (isSelected ? '#d97706' : colors.stroke)
      ctx.lineWidth = (isHovered ? 3 : 2) / zoom

      ctx.beginPath()
      if (device.type === 'beacon') {
        // Diamond
        ctx.moveTo(device.x, device.y - s * 1.2)
        ctx.lineTo(device.x + s, device.y)
        ctx.lineTo(device.x, device.y + s * 1.2)
        ctx.lineTo(device.x - s, device.y)
        ctx.closePath()
      } else if (device.type === 'access_point') {
        // Rounded square
        const hs = s * 0.95
        const rr = hs * 0.3
        ctx.moveTo(device.x - hs + rr, device.y - hs)
        ctx.arcTo(device.x + hs, device.y - hs, device.x + hs, device.y + hs, rr)
        ctx.arcTo(device.x + hs, device.y + hs, device.x - hs, device.y + hs, rr)
        ctx.arcTo(device.x - hs, device.y + hs, device.x - hs, device.y - hs, rr)
        ctx.arcTo(device.x - hs, device.y - hs, device.x + hs, device.y - hs, rr)
        ctx.closePath()
      } else {
        // Gateway: triangle (point up)
        ctx.moveTo(device.x, device.y - s * 1.2)
        ctx.lineTo(device.x + s * 1.1, device.y + s * 0.8)
        ctx.lineTo(device.x - s * 1.1, device.y + s * 0.8)
        ctx.closePath()
      }
      ctx.fill()
      ctx.stroke()

      // Shadow on hover
      if (isHovered) {
        ctx.beginPath()
        ctx.arc(device.x, device.y, r * 1.6, 0, Math.PI * 2)
        ctx.strokeStyle = `${colors.fill}40`
        ctx.lineWidth = 3 / zoom
        ctx.stroke()
      }

      // Label
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.max(9, 11 / zoom)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(colors.label, device.x, device.y)
    })

    // Draw selection rectangle
    if (selectStart && selectEnd) {
      const sx = Math.min(selectStart.x, selectEnd.x)
      const sy = Math.min(selectStart.y, selectEnd.y)
      const sw = Math.abs(selectEnd.x - selectStart.x)
      const sh = Math.abs(selectEnd.y - selectStart.y)
      ctx.fillStyle = 'rgba(245, 158, 11, 0.1)'
      ctx.fillRect(sx, sy, sw, sh)
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([6 / zoom, 4 / zoom])
      ctx.strokeRect(sx, sy, sw, sh)
      ctx.setLineDash([])
    }

    // Draw room-drawing polygon in progress
    if (drawingPoints.length > 0) {
      ctx.beginPath()
      ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y)
      drawingPoints.forEach(pt => ctx.lineTo(pt.x, pt.y))
      ctx.strokeStyle = '#06b6d4'
      ctx.lineWidth = 2.5 / zoom
      ctx.stroke()

      if (drawingPoints.length > 2) {
        ctx.globalAlpha = 0.15
        ctx.fillStyle = '#06b6d4'
        ctx.beginPath()
        ctx.moveTo(drawingPoints[0].x, drawingPoints[0].y)
        drawingPoints.forEach(pt => ctx.lineTo(pt.x, pt.y))
        ctx.closePath()
        ctx.fill()
        ctx.globalAlpha = 1
      }

      drawingPoints.forEach((pt, i) => {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5 / zoom, 0, Math.PI * 2)
        ctx.fillStyle = i === 0 ? '#06b6d4' : '#67e8f9'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5 / zoom
        ctx.stroke()
      })
    }

    // Draw calibration points
    if (calibrating && calibrationPoints.length > 0) {
      calibrationPoints.forEach((pt, i) => {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 6 / zoom, 0, Math.PI * 2)
        ctx.fillStyle = '#ef4444'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 2 / zoom
        ctx.stroke()

        ctx.fillStyle = '#fff'
        ctx.font = `bold ${10 / zoom}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${i + 1}`, pt.x, pt.y)
      })

      if (calibrationPoints.length === 2) {
        ctx.beginPath()
        ctx.moveTo(calibrationPoints[0].x, calibrationPoints[0].y)
        ctx.lineTo(calibrationPoints[1].x, calibrationPoints[1].y)
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 2 / zoom
        ctx.setLineDash([6 / zoom, 4 / zoom])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Draw ruler measurement line
    if (rulerPoints && rulerPoints.length >= 1) {
      const p1 = rulerPoints[0]
      ctx.beginPath()
      ctx.arc(p1.x, p1.y, 5 / zoom, 0, Math.PI * 2)
      ctx.fillStyle = '#f97316'
      ctx.fill()

      if (rulerPoints.length === 2) {
        const p2 = rulerPoints[1]
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.strokeStyle = '#f97316'
        ctx.lineWidth = 2 / zoom
        ctx.setLineDash([6 / zoom, 4 / zoom])
        ctx.stroke()
        ctx.setLineDash([])

        ctx.beginPath()
        ctx.arc(p2.x, p2.y, 5 / zoom, 0, Math.PI * 2)
        ctx.fillStyle = '#f97316'
        ctx.fill()

        // Calculate and show distance
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const pxDist = Math.sqrt(dx * dx + dy * dy)
        const scale = config?.scale_pixels_per_ft
        const unitPref = config?.unit || 'ft'
        let label = `${Math.round(pxDist)} px`
        if (scale) {
          const ftDist = pxDist / scale
          if (unitPref === 'm') {
            label = `${(ftDist / 3.28084).toFixed(1)} m`
          } else {
            label = `${ftDist.toFixed(1)} ft`
          }
        }
        const mx = (p1.x + p2.x) / 2
        const my = (p1.y + p2.y) / 2
        ctx.font = `bold ${Math.max(12, 14 / zoom)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        // Background for readability
        const tw = ctx.measureText(label).width + 8 / zoom
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.fillRect(mx - tw / 2, my - 20 / zoom, tw, 18 / zoom)
        ctx.fillStyle = '#f97316'
        ctx.fillText(label, mx, my - 4 / zoom)
      }
    }

    ctx.restore()

    // Cursor indicator for placement tool
    if (placementTool) {
      const colors = DEVICE_COLORS[placementTool]
      ctx.fillStyle = `${colors.fill}20`
      ctx.strokeStyle = colors.fill
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(30, 30, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = colors.fill
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`Placing: ${placementTool.replace('_', ' ')}`, 44, 34)
    }

    // Mode indicator
    if (interactionMode === 'select') {
      ctx.fillStyle = '#f59e0b'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('🔲 Drag to select devices', 14, 20)
    } else if (interactionMode === 'drawRoom') {
      ctx.fillStyle = '#06b6d4'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`✏️ Drawing room (${drawingPoints.length} pts)${drawingPoints.length >= 3 ? ' — press Enter to confirm' : ''}`, 14, 20)
    } else if (interactionMode === 'deleteRoom') {
      ctx.fillStyle = '#ef4444'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('🗑️ Click a room to delete it', 14, 20)
    } else if (interactionMode === 'ruler') {
      ctx.fillStyle = '#f97316'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText('📏 Click two points to measure — Esc to cancel', 14, 20)
    }
  }, [image, zoom, offset, overlayMode, project, calibrating, calibrationPoints, placementTool, hoveredDevice, draggingDevice, selectedDevices, selectStart, selectEnd, drawingPoints, interactionMode, hoveredRoom, config, visibleLayers, rulerPoints])

  useEffect(() => {
    draw()
  }, [draw])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(container)
    return () => observer.disconnect()
  }, [draw])

  // Convert screen coords to floorplan coords
  const screenToFloorplan = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    return {
      x: (sx - offset.x) / zoom,
      y: (sy - offset.y) / zoom,
    }
  }, [zoom, offset])

  // Find device at position
  const findDeviceAt = useCallback((fx, fy) => {
    const allDevices = [
      ...(project.placements?.beacons || []).map(d => ({ ...d, type: 'beacon' })),
      ...(project.placements?.access_points || []).map(d => ({ ...d, type: 'access_point' })),
      ...(project.placements?.gateways || []).map(d => ({ ...d, type: 'gateway' })),
    ]
    const hitRadius = DEVICE_RADIUS / zoom * 1.5
    for (const device of allDevices.reverse()) {
      const dx = device.x - fx
      const dy = device.y - fy
      if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
        return device
      }
    }
    return null
  }, [project.placements, zoom])

  const handleMouseDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true)
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
      e.preventDefault()
      return
    }

    if (e.button === 0) {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)

      // Select mode: start rectangle drag
      if (interactionMode === 'select') {
        setSelectStart({ x, y })
        setSelectEnd({ x, y })
        return
      }

      // These modes handle clicks via handleCanvasClick, not mouseDown
      if (interactionMode === 'drawRoom' || interactionMode === 'deleteRoom' || interactionMode === 'ruler') return

      // Default: check for device drag
      if (!calibrating && !placementTool) {
        const device = findDeviceAt(x, y)
        if (device) {
          setDraggingDevice(device)
          return
        }
      }
    }
  }, [screenToFloorplan, findDeviceAt, calibrating, placementTool, offset, interactionMode])

  const handleMouseMove = useCallback((e) => {
    if (isPanning) {
      setOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      })
      return
    }

    const { x, y } = screenToFloorplan(e.clientX, e.clientY)

    // Selection rectangle drag
    if (interactionMode === 'select' && selectStart) {
      setSelectEnd({ x, y })
      return
    }

    // Room delete hover
    if (interactionMode === 'deleteRoom') {
      setHoveredRoom(findRoomAt(x, y))
      return
    }

    if (draggingDevice) return

    // Hover detection
    const device = findDeviceAt(x, y)
    setHoveredDevice(device)
  }, [isPanning, panStart, draggingDevice, screenToFloorplan, findDeviceAt, findRoomAt, interactionMode, selectStart])

  const handleMouseUp = useCallback((e) => {
    if (isPanning) {
      setIsPanning(false)
      return
    }

    // Finish rectangle selection
    if (interactionMode === 'select' && selectStart && selectEnd) {
      const minX = Math.min(selectStart.x, selectEnd.x)
      const maxX = Math.max(selectStart.x, selectEnd.x)
      const minY = Math.min(selectStart.y, selectEnd.y)
      const maxY = Math.max(selectStart.y, selectEnd.y)

      // Only count as rect-select if dragged more than a few pixels
      if (Math.abs(maxX - minX) > 5 || Math.abs(maxY - minY) > 5) {
        const allDevices = [
          ...(project.placements?.beacons || []),
          ...(project.placements?.access_points || []),
          ...(project.placements?.gateways || []),
        ]
        const inRect = new Set()
        allDevices.forEach(d => {
          if (d.x >= minX && d.x <= maxX && d.y >= minY && d.y <= maxY) {
            inRect.add(d.id)
          }
        })
        if (e.shiftKey) {
          // Add to existing selection
          setSelectedDevices(prev => {
            const next = new Set(prev)
            inRect.forEach(id => next.add(id))
            return next
          })
        } else {
          setSelectedDevices(inRect)
        }
      }
      setSelectStart(null)
      setSelectEnd(null)
      return
    }

    if (draggingDevice) {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)
      onDeviceDrag(draggingDevice.type, draggingDevice.id, x, y)
      setDraggingDevice(null)
      return
    }

    if (e.button === 0 && !interactionMode) {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)
      onClick(x, y)
    }
  }, [isPanning, draggingDevice, screenToFloorplan, onClick, onDeviceDrag, interactionMode, selectStart, selectEnd, project.placements, setSelectedDevices])

  const handleCanvasClick = useCallback((e) => {
    if (interactionMode === 'deleteRoom') {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)
      const room = findRoomAt(x, y)
      if (room && onDeleteRoom) {
        onDeleteRoom(room.id)
      }
      return
    }

    if (interactionMode === 'drawRoom') {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)
      setDrawingPoints(prev => [...prev, { x, y }])
      return
    }

    if (interactionMode === 'ruler') {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)
      onClick(x, y)
      return
    }

    // Click a device to toggle selection in select mode
    if (interactionMode === 'select') {
      const { x, y } = screenToFloorplan(e.clientX, e.clientY)
      const device = findDeviceAt(x, y)
      if (device) {
        setSelectedDevices(prev => {
          const next = new Set(prev)
          if (next.has(device.id)) next.delete(device.id)
          else next.add(device.id)
          return next
        })
      }
    }
  }, [interactionMode, screenToFloorplan, findRoomAt, findDeviceAt, onDeleteRoom, setSelectedDevices, onClick])

  const handleDblClick = useCallback((e) => {
    // Double-click also finishes room drawing as a fallback
    if (interactionMode === 'drawRoom' && drawingPoints.length >= 3 && onDrawRoom) {
      onDrawRoom(drawingPoints.map(p => [p.x, p.y]))
      setDrawingPoints([])
    }
  }, [interactionMode, drawingPoints, onDrawRoom])

  // Keyboard: Enter to confirm room polygon, Escape to cancel/undo, Backspace to undo last point
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (interactionMode === 'drawRoom') {
        if (e.key === 'Enter' && drawingPoints.length >= 3 && onDrawRoom) {
          e.preventDefault()
          onDrawRoom(drawingPoints.map(p => [p.x, p.y]))
          setDrawingPoints([])  // clear for next room, stay in drawRoom mode
        } else if (e.key === 'Escape') {
          e.preventDefault()
          if (drawingPoints.length > 0) {
            setDrawingPoints([])  // cancel current polygon
          }
        } else if (e.key === 'Backspace' || e.key === 'z' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          setDrawingPoints(prev => prev.slice(0, -1))  // undo last point
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [interactionMode, drawingPoints, onDrawRoom])

  // Keyboard: Escape to cancel ruler mode
  useEffect(() => {
    if (interactionMode !== 'ruler') return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        // Dispatch a custom event so App can clear ruler state
        window.dispatchEvent(new CustomEvent('ruler-cancel'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [interactionMode])

  // Reset drawing points when mode changes away from drawRoom
  useEffect(() => {
    if (interactionMode !== 'drawRoom') setDrawingPoints([])
    if (interactionMode !== 'deleteRoom') setHoveredRoom(null)
    if (interactionMode !== 'select') {
      setSelectStart(null)
      setSelectEnd(null)
    }
  }, [interactionMode])

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    const { x, y } = screenToFloorplan(e.clientX, e.clientY)
    const device = findDeviceAt(x, y)
    if (device) {
      onDeviceDelete(device.type, device.id)
    }
  }, [screenToFloorplan, findDeviceAt, onDeviceDelete])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.1, Math.min(5, zoom * delta))

    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    setOffset(prev => ({
      x: mx - (mx - prev.x) * (newZoom / zoom),
      y: my - (my - prev.y) * (newZoom / zoom),
    }))
    setZoom(newZoom)
  }, [zoom])

  const fitToScreen = useCallback(() => {
    if (!image || !containerRef.current) return
    const container = containerRef.current
    const scaleX = (container.clientWidth - 20) / image.width
    const scaleY = (container.clientHeight - 20) / image.height
    const fitZoom = Math.min(scaleX, scaleY, 1)
    setZoom(fitZoom)
    setOffset({
      x: (container.clientWidth - image.width * fitZoom) / 2,
      y: (container.clientHeight - image.height * fitZoom) / 2,
    })
  }, [image])

  const cursorStyle = interactionMode === 'select'
    ? 'crosshair'
    : interactionMode === 'drawRoom'
      ? 'crosshair'
      : interactionMode === 'deleteRoom'
        ? 'pointer'
        : calibrating
          ? 'crosshair'
          : placementTool
            ? 'crosshair'
            : hoveredDevice
              ? 'grab'
              : draggingDevice
                ? 'grabbing'
                : isPanning
                  ? 'grabbing'
                  : 'default'

  const helpText = interactionMode === 'select'
    ? 'Drag to select · Click device to toggle · Shift+drag to add'
    : interactionMode === 'drawRoom'
      ? `Click points to draw polygon${drawingPoints.length >= 3 ? ' · Enter to confirm' : ''} · Esc to cancel · Backspace to undo`
      : interactionMode === 'deleteRoom'
        ? 'Click a highlighted room to delete it'
        : 'Scroll to zoom · Alt+drag to pan · Right-click device to remove'

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => setZoom(z => Math.min(5, z * 1.2))}
          className="p-1.5 rounded bg-white border border-gray-200 hover:bg-gray-50 text-gray-600"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom(z => Math.max(0.1, z * 0.8))}
          className="p-1.5 rounded bg-white border border-gray-200 hover:bg-gray-50 text-gray-600"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={fitToScreen}
          className="p-1.5 rounded bg-white border border-gray-200 hover:bg-gray-50 text-gray-600"
          title="Fit to Screen"
        >
          <Maximize className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500 ml-2">{Math.round(zoom * 100)}%</span>
        {selectedDevices && selectedDevices.size > 0 && (
          <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
            {selectedDevices.size} selected
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {helpText}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 canvas-container rounded-lg overflow-hidden"
        style={{ cursor: cursorStyle }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleCanvasClick}
          onDoubleClick={handleDblClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
        />
      </div>
    </div>
  )
}

import React, { useState } from 'react'
import {
  Settings, Eye, MousePointer, Crosshair, Wifi, Radio, Server,
  Play, Download, FolderPlus, Ruler, Loader2, ChevronDown, ChevronRight,
  SlidersHorizontal, RotateCcw, Layers, Pencil, Check, Save, FileDown,
  FileText, BarChart3, Trash2, BoxSelect, PenTool, Eraser,
  X as XIcon
} from 'lucide-react'

export default function Sidebar({
  project, activeFloor, activeFloorIndex, setActiveFloorIndex,
  config, setConfig, activeTab, setActiveTab,
  overlayMode, setOverlayMode, placementTool, setPlacementTool,
  calibrating, setCalibrating, calibrationPoints, onCalibrateScale,
  onAutoPlace, onAutoPlaceAll, onExportBOM, onExportPDF, onSaveProject, onNewProject,
  onRenameFloor, loading,
  roomDetectionParams, setRoomDetectionParams, onReprocess,
  selectedDevices, interactionMode, setInteractionMode, onBulkDelete, onShowStats,
}) {
  const [calibrationFt, setCalibrationFt] = useState('')
  const [editingFloorName, setEditingFloorName] = useState(null)
  const [floorNameDraft, setFloorNameDraft] = useState('')

  const placements = activeFloor?.placements || { beacons: [], access_points: [], gateways: [] }
  const totalDevices = (placements.beacons?.length || 0) +
    (placements.access_points?.length || 0) +
    (placements.gateways?.length || 0)

  const floors = project?.floors || []

  const handleCalibrationSubmit = () => {
    if (calibrationPoints.length === 2 && calibrationFt) {
      const dx = calibrationPoints[1].x - calibrationPoints[0].x
      const dy = calibrationPoints[1].y - calibrationPoints[0].y
      const pixelDist = Math.sqrt(dx * dx + dy * dy)
      onCalibrateScale(pixelDist, parseFloat(calibrationFt))
    }
  }

  const startRename = (idx, currentName) => {
    setEditingFloorName(idx)
    setFloorNameDraft(currentName)
  }

  const commitRename = () => {
    if (editingFloorName !== null && floorNameDraft.trim()) {
      onRenameFloor(editingFloorName, floorNameDraft.trim())
    }
    setEditingFloorName(null)
  }

  const tabs = [
    { id: 'setup', label: 'Setup', icon: Settings },
    { id: 'place', label: 'Place', icon: Crosshair },
    { id: 'review', label: 'Review', icon: Eye },
  ]

  return (
    <aside className="w-80 bg-white border-r border-gray-200 flex flex-col overflow-y-auto shadow-sm">
      {/* Floor Selector */}
      {floors.length > 1 && (
        <div className="px-3 pt-3 pb-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Layers className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Floors</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {floors.map((f, idx) => (
              <div key={idx} className="flex items-center">
                {editingFloorName === idx ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={floorNameDraft}
                      onChange={e => setFloorNameDraft(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && commitRename()}
                      className="w-24 px-1.5 py-0.5 text-xs border border-linklabs-400 rounded focus:outline-none"
                      autoFocus
                    />
                    <button onClick={commitRename} className="p-0.5 text-green-600 hover:text-green-800">
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setActiveFloorIndex(idx)}
                    onDoubleClick={() => startRename(idx, f.name)}
                    title="Click to select, double-click to rename"
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      activeFloorIndex === idx
                        ? 'bg-linklabs-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f.name}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-3 px-2 text-xs font-medium flex flex-col items-center gap-1 transition-colors ${
              activeTab === tab.id
                ? 'text-linklabs-600 border-b-2 border-linklabs-600 bg-linklabs-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 p-4 space-y-4">
        {/* Floor Info */}
        <div className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">{project.filename}</span>
          {floors.length > 1 && <span className="text-linklabs-600"> — {activeFloor?.name}</span>}
          <br />
          {activeFloor?.width} × {activeFloor?.height}px · {activeFloor?.rooms_detected} rooms detected
          {floors.length > 1 && <span> · {floors.length} floors</span>}
        </div>

        {/* SETUP TAB */}
        {activeTab === 'setup' && (
          <>
            {/* Scale Calibration */}
            <Section title="Scale Calibration" icon={Ruler}>
              {config.scale_pixels_per_ft ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                    <span className="w-2 h-2 bg-green-500 rounded-full" />
                    Calibrated: {config.scale_pixels_per_ft.toFixed(1)} px/ft
                  </div>
                  <button
                    onClick={() => { setCalibrating(true); setConfig(prev => ({ ...prev, scale_pixels_per_ft: null })) }}
                    className="text-xs text-linklabs-600 hover:underline"
                  >
                    Recalibrate
                  </button>
                </div>
              ) : calibrating ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-600">
                    Click two points on the floorplan with a known distance between them.
                  </p>
                  <div className="text-xs space-y-1">
                    <div className={`flex items-center gap-2 ${calibrationPoints.length >= 1 ? 'text-green-600' : 'text-gray-400'}`}>
                      <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px]">1</span>
                      {calibrationPoints.length >= 1 ? 'Point 1 set' : 'Click first point'}
                    </div>
                    <div className={`flex items-center gap-2 ${calibrationPoints.length >= 2 ? 'text-green-600' : 'text-gray-400'}`}>
                      <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center text-[10px]">2</span>
                      {calibrationPoints.length >= 2 ? 'Point 2 set' : 'Click second point'}
                    </div>
                  </div>
                  {calibrationPoints.length === 2 && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-gray-700">Real distance (ft):</label>
                      <input
                        type="number"
                        value={calibrationFt}
                        onChange={e => setCalibrationFt(e.target.value)}
                        placeholder="e.g. 50"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-linklabs-500 focus:border-linklabs-500"
                      />
                      <button
                        onClick={handleCalibrationSubmit}
                        disabled={!calibrationFt}
                        className="w-full px-3 py-2 bg-linklabs-600 text-white rounded-lg text-sm font-medium hover:bg-linklabs-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Set Scale
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => { setCalibrating(false) }}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setCalibrating(true)}
                  className="w-full px-3 py-2 bg-linklabs-600 text-white rounded-lg text-sm font-medium hover:bg-linklabs-700 flex items-center justify-center gap-2"
                >
                  <Ruler className="w-4 h-4" />
                  Calibrate Scale
                </button>
              )}
            </Section>

            {/* Overlay */}
            <Section title="Floorplan View" icon={Eye}>
              <div className="space-y-1">
                {[
                  { id: 'original', label: 'Original' },
                  { id: 'walls', label: 'Detected Walls' },
                  { id: 'rooms', label: 'Detected Rooms' },
                ].map(mode => (
                  <label key={mode.id} className="flex items-center gap-2 text-sm cursor-pointer py-1 px-2 rounded hover:bg-gray-50">
                    <input
                      type="radio"
                      name="overlay"
                      value={mode.id}
                      checked={overlayMode === mode.id}
                      onChange={() => setOverlayMode(mode.id)}
                      className="text-linklabs-600 focus:ring-linklabs-500"
                    />
                    {mode.label}
                  </label>
                ))}
              </div>
            </Section>

            {/* Room Detection Tuning */}
            <Section title="Room Detection Tuning" icon={SlidersHorizontal}>
              <div className="space-y-3">
                <ConfigSlider
                  label="Sensitivity"
                  value={roomDetectionParams.sensitivity}
                  min={2} max={20} step={1} unit=""
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, sensitivity: v }))}
                  tooltip="Adaptive threshold C value. Higher = detects more features as walls"
                />
                <ConfigSlider
                  label="Min Room Size"
                  value={roomDetectionParams.min_room_area_pct}
                  min={0.001} max={0.05} step={0.001} unit="%"
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, min_room_area_pct: v }))}
                  format={v => `${v.toFixed(3)}%`}
                  tooltip="Minimum room area as % of image. Lower = catches smaller rooms"
                />
                <ConfigSlider
                  label="Max Room Size"
                  value={roomDetectionParams.max_room_area_pct}
                  min={1} max={15} step={0.5} unit="%"
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, max_room_area_pct: v }))}
                  format={v => `${v.toFixed(1)}%`}
                  tooltip="Maximum room area as % of image. Higher = allows larger open areas"
                />
                <ConfigSlider
                  label="Min Wall Dilation"
                  value={roomDetectionParams.min_dilation}
                  min={3} max={15} step={1} unit="px"
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, min_dilation: v }))}
                  tooltip="Smallest dilation kernel. Lower = catches rooms with narrow doors"
                />
                <ConfigSlider
                  label="Max Wall Dilation"
                  value={roomDetectionParams.max_dilation}
                  min={10} max={40} step={1} unit="px"
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, max_dilation: v }))}
                  tooltip="Largest dilation kernel. Higher = bridges wider door gaps"
                />
                <ConfigSlider
                  label="Detection Scales"
                  value={roomDetectionParams.num_scales}
                  min={1} max={10} step={1} unit=""
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, num_scales: v }))}
                  tooltip="Number of dilation levels between min and max. More = thorough but slower"
                />
                <ConfigSlider
                  label="Min Solidity"
                  value={roomDetectionParams.solidity_threshold}
                  min={0.1} max={0.6} step={0.05} unit=""
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, solidity_threshold: v }))}
                  format={v => v.toFixed(2)}
                  tooltip="Minimum fill ratio (area / bounding box). Lower = accepts irregular shapes"
                />
                <ConfigSlider
                  label="Max Aspect Ratio"
                  value={roomDetectionParams.max_aspect_ratio}
                  min={3} max={20} step={1} unit=":1"
                  onChange={v => setRoomDetectionParams(prev => ({ ...prev, max_aspect_ratio: v }))}
                  tooltip="Maximum elongation. Higher = allows long narrow rooms"
                />
                <button
                  onClick={() => onReprocess(roomDetectionParams)}
                  disabled={loading}
                  className="w-full px-3 py-2 bg-linklabs-600 text-white rounded-lg text-sm font-medium hover:bg-linklabs-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  {loading ? 'Re-detecting...' : 'Re-detect Rooms'}
                </button>
              </div>
            </Section>

            {/* Placement Configuration */}
            <Section title="Placement Rules" icon={Settings}>
              <div className="space-y-3">
                <ConfigSlider
                  label="Beacon Spacing"
                  value={config.beacon_spacing_ft}
                  min={20} max={80} step={5} unit="ft"
                  onChange={v => setConfig(prev => ({ ...prev, beacon_spacing_ft: v }))}
                />
                <ConfigSlider
                  label="AP Spacing"
                  value={config.ap_spacing_ft}
                  min={50} max={200} step={10} unit="ft"
                  onChange={v => setConfig(prev => ({ ...prev, ap_spacing_ft: v }))}
                />
                <ConfigSlider
                  label="Gateway:AP Ratio"
                  value={config.gateway_to_ap_ratio}
                  min={0.05} max={0.5} step={0.05} unit=":1"
                  onChange={v => setConfig(prev => ({ ...prev, gateway_to_ap_ratio: v }))}
                  format={v => `1:${Math.round(1/v)}`}
                />
                <ConfigSlider
                  label="Beacons per Room"
                  value={config.beacons_per_room}
                  min={1} max={5} step={1} unit=""
                  onChange={v => setConfig(prev => ({ ...prev, beacons_per_room: v }))}
                  tooltip="Minimum number of beacons placed in each detected room"
                />
              </div>
            </Section>
          </>
        )}

        {/* PLACE TAB */}
        {activeTab === 'place' && (
          <>
            <Section title="Auto-Place" icon={Play}>
              {!config.scale_pixels_per_ft ? (
                <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                  Please calibrate the scale first (Setup tab).
                </p>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={onAutoPlace}
                    disabled={loading}
                    className="w-full px-3 py-2 bg-linklabs-600 text-white rounded-lg text-sm font-medium hover:bg-linklabs-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {loading ? 'Placing...' : `Auto-Place on ${activeFloor?.name || 'Floor'}`}
                  </button>
                  {floors.length > 1 && (
                    <button
                      onClick={onAutoPlaceAll}
                      disabled={loading}
                      className="w-full px-3 py-2 bg-white border border-linklabs-300 text-linklabs-700 rounded-lg text-sm font-medium hover:bg-linklabs-50 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                      Auto-Place on All Floors
                    </button>
                  )}
                </div>
              )}
            </Section>

            <Section title="Manual Placement" icon={MousePointer}>
              <p className="text-xs text-gray-500 mb-2">
                Select a device type, then click on the floorplan to place it.
              </p>
              <div className="space-y-1">
                {[
                  { id: 'beacon', label: 'Location Beacon', icon: Radio, color: 'text-blue-600 bg-blue-50 border-blue-200' },
                  { id: 'access_point', label: 'Access Point', icon: Wifi, color: 'text-green-600 bg-green-50 border-green-200' },
                  { id: 'gateway', label: 'Gateway', icon: Server, color: 'text-purple-600 bg-purple-50 border-purple-200' },
                ].map(device => (
                  <button
                    key={device.id}
                    onClick={() => { setPlacementTool(placementTool === device.id ? null : device.id); setInteractionMode(null) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${
                      placementTool === device.id
                        ? `${device.color} border-current font-medium ring-2 ring-current/20`
                        : 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <device.icon className="w-4 h-4" />
                    {device.label}
                  </button>
                ))}
              </div>
              {placementTool && (
                <p className="text-xs text-linklabs-600 mt-2">
                  Click on the floorplan to place a {placementTool.replace('_', ' ')}.
                  Right-click a device to remove it.
                </p>
              )}
            </Section>

            <Section title="Bulk Select & Delete" icon={BoxSelect}>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setPlacementTool(null)
                    setInteractionMode(interactionMode === 'select' ? null : 'select')
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${
                    interactionMode === 'select'
                      ? 'text-amber-700 bg-amber-50 border-amber-300 font-medium ring-2 ring-amber-200'
                      : 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <BoxSelect className="w-4 h-4" />
                  {interactionMode === 'select' ? 'Selection Mode Active' : 'Enter Selection Mode'}
                </button>
                {interactionMode === 'select' && (
                  <p className="text-xs text-amber-600">
                    Drag a rectangle to select devices. Click a device to toggle. Hold Shift to add to selection.
                  </p>
                )}
                {selectedDevices && selectedDevices.size > 0 && (
                  <button
                    onClick={onBulkDelete}
                    disabled={loading}
                    className="w-full px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete {selectedDevices.size} Selected Device{selectedDevices.size !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </Section>

            <Section title="Room Management" icon={PenTool}>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setPlacementTool(null)
                    setInteractionMode(interactionMode === 'drawRoom' ? null : 'drawRoom')
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${
                    interactionMode === 'drawRoom'
                      ? 'text-cyan-700 bg-cyan-50 border-cyan-300 font-medium ring-2 ring-cyan-200'
                      : 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <PenTool className="w-4 h-4" />
                  {interactionMode === 'drawRoom' ? 'Drawing Room...' : 'Draw New Room'}
                </button>
                <button
                  onClick={() => {
                    setPlacementTool(null)
                    setInteractionMode(interactionMode === 'deleteRoom' ? null : 'deleteRoom')
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all ${
                    interactionMode === 'deleteRoom'
                      ? 'text-red-700 bg-red-50 border-red-300 font-medium ring-2 ring-red-200'
                      : 'text-gray-600 bg-gray-50 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <Eraser className="w-4 h-4" />
                  {interactionMode === 'deleteRoom' ? 'Click Room to Delete' : 'Delete Room'}
                </button>
                {(interactionMode === 'drawRoom' || interactionMode === 'deleteRoom') && (
                  <button
                    onClick={() => setInteractionMode(null)}
                    className="w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1"
                  >
                    <XIcon className="w-3 h-3" /> Cancel
                  </button>
                )}
              </div>
            </Section>
          </>
        )}

        {/* REVIEW TAB */}
        {activeTab === 'review' && (
          <>
            <Section title={`Devices — ${activeFloor?.name || 'Floor'}`} icon={Eye}>
              <div className="space-y-2">
                <DeviceCount icon={Radio} label="Location Beacons" count={placements.beacons?.length || 0} color="text-blue-600" />
                <DeviceCount icon={Wifi} label="Access Points" count={placements.access_points?.length || 0} color="text-green-600" />
                <DeviceCount icon={Server} label="Gateways" count={placements.gateways?.length || 0} color="text-purple-600" />
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <DeviceCount icon={Radio} label="Floor Total" count={totalDevices} color="text-gray-800" bold />
                </div>
              </div>
            </Section>

            {floors.length > 1 && (
              <Section title="All Floors Summary" icon={Layers}>
                <div className="space-y-1 text-xs">
                  {floors.map((f, idx) => {
                    const fp = f.placements || {}
                    const ft = (fp.beacons?.length || 0) + (fp.access_points?.length || 0) + (fp.gateways?.length || 0)
                    return (
                      <div key={idx} className="flex justify-between py-0.5">
                        <span className="text-gray-600">{f.name}</span>
                        <span className="font-mono text-gray-800">{ft} devices</span>
                      </div>
                    )
                  })}
                  <div className="border-t border-gray-200 pt-1 mt-1 flex justify-between font-semibold">
                    <span>Grand Total</span>
                    <span className="font-mono">
                      {floors.reduce((sum, f) => {
                        const fp = f.placements || {}
                        return sum + (fp.beacons?.length || 0) + (fp.access_points?.length || 0) + (fp.gateways?.length || 0)
                      }, 0)} devices
                    </span>
                  </div>
                </div>
              </Section>
            )}

            <Section title="Floorplan Info" icon={BarChart3}>
              <button
                onClick={onShowStats}
                className="w-full px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
              >
                <BarChart3 className="w-4 h-4" />
                View Statistics
              </button>
            </Section>

            <Section title="Export" icon={Download}>
              <div className="space-y-2">
                <button
                  onClick={onExportBOM}
                  className="w-full px-3 py-2 bg-linklabs-600 text-white rounded-lg text-sm font-medium hover:bg-linklabs-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Bill of Materials
                </button>
                <button
                  onClick={onExportPDF}
                  className="w-full px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-2"
                >
                  <FileDown className="w-4 h-4" />
                  Export Floorplan PDF
                </button>
              </div>
            </Section>
          </>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="p-4 border-t border-gray-200 space-y-2">
        <button
          onClick={onSaveProject}
          className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          Save Project
        </button>
        <button
          onClick={onNewProject}
          className="w-full px-3 py-2 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg flex items-center justify-center gap-2"
        >
          <FolderPlus className="w-4 h-4" />
          New Project
        </button>
      </div>
    </aside>
  )
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {title}
      </h3>
      {children}
    </div>
  )
}

function ConfigSlider({ label, value, min, max, step, unit, onChange, format, tooltip }) {
  const displayValue = format ? format(value) : `${value}${unit}`
  return (
    <div title={tooltip}>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-800">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-linklabs-600"
      />
    </div>
  )
}

function DeviceCount({ icon: Icon, label, count, color, bold }) {
  return (
    <div className={`flex items-center justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${color}`} />
        {label}
      </span>
      <span className={`font-mono ${color}`}>{count}</span>
    </div>
  )
}

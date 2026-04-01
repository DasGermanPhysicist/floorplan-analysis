import React, { useEffect, useState } from 'react'
import { X, Download, FileText, ChevronDown, ChevronRight } from 'lucide-react'

export default function BOMPanel({ project, onClose }) {
  const [bom, setBom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedFloor, setExpandedFloor] = useState(null)

  useEffect(() => {
    async function fetchBOM() {
      try {
        const res = await fetch(`/api/export/${project.project_id}`)
        const data = await res.json()
        setBom(data)
      } catch (e) {
        console.error('Failed to fetch BOM:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchBOM()
  }, [project.project_id])

  const handleDownloadJSON = () => {
    if (!bom) return
    const blob = new Blob([JSON.stringify(bom, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `airfinder2_bom_${project.project_id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadCSV = () => {
    if (!bom) return
    let csv = 'Device,Model,Quantity\n'
    bom.items.forEach(item => {
      csv += `"${item.device}","${item.model}",${item.quantity}\n`
    })
    csv += `\nTotal Devices,,${bom.total_devices || bom.items.reduce((sum, i) => sum + i.quantity, 0)}\n`

    // Per-floor breakdown
    if (bom.floor_details && bom.floor_details.length > 1) {
      csv += `\nPer-Floor Breakdown\n`
      csv += `Floor,Beacons,Access Points,Gateways,Total\n`
      bom.floor_details.forEach(fd => {
        csv += `"${fd.name}",${fd.beacons},${fd.access_points},${fd.gateways},${fd.total}\n`
      })
    }

    // Placement details per floor
    csv += `\nPlacement Details\n`
    csv += `Floor,Type,ID,X,Y\n`
    ;(bom.floor_details || []).forEach(fd => {
      const details = fd.placement_details || {}
      ;['beacons', 'access_points', 'gateways'].forEach(type => {
        (details[type] || []).forEach(d => {
          csv += `"${fd.name}","${type}","${d.id}",${Math.round(d.x)},${Math.round(d.y)}\n`
        })
      })
    })

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `airfinder2_bom_${project.project_id}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const floorDetails = bom?.floor_details || []
  const hasMultipleFloors = floorDetails.length > 1

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-linklabs-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Bill of Materials</h2>
              <p className="text-sm text-gray-500">
                {project.filename}
                {hasMultipleFloors && ` · ${floorDetails.length} floors`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : bom ? (
            <div className="space-y-6">
              {/* Grand Total Summary */}
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Device</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Model</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">
                      {hasMultipleFloors ? 'All Floors' : 'Qty'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bom.items.map((item, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-900">{item.device}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{item.model}</td>
                      <td className="py-3 px-4 text-sm text-gray-900 text-right font-mono font-semibold">
                        {item.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50">
                    <td colSpan={2} className="py-3 px-4 text-sm font-bold text-gray-900">
                      Total Devices
                    </td>
                    <td className="py-3 px-4 text-sm font-bold text-gray-900 text-right font-mono">
                      {bom.total_devices || bom.items.reduce((sum, i) => sum + i.quantity, 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Per-floor breakdown */}
              {hasMultipleFloors && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Per-Floor Breakdown</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500">
                        <th className="text-left py-2 px-3">Floor</th>
                        <th className="text-right py-2 px-3">Beacons</th>
                        <th className="text-right py-2 px-3">APs</th>
                        <th className="text-right py-2 px-3">GWs</th>
                        <th className="text-right py-2 px-3">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {floorDetails.map((fd, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 text-gray-900 font-medium">{fd.name}</td>
                          <td className="py-2 px-3 text-right font-mono text-blue-600">{fd.beacons}</td>
                          <td className="py-2 px-3 text-right font-mono text-green-600">{fd.access_points}</td>
                          <td className="py-2 px-3 text-right font-mono text-purple-600">{fd.gateways}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold">{fd.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Expandable placement coordinates per floor */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Placement Coordinates</h3>
                <div className="max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-600">
                  {floorDetails.map((fd, fi) => {
                    const details = fd.placement_details || {}
                    const isExpanded = expandedFloor === fi
                    const deviceCount = (details.beacons?.length || 0) + (details.access_points?.length || 0) + (details.gateways?.length || 0)
                    return (
                      <div key={fi}>
                        {hasMultipleFloors && (
                          <button
                            onClick={() => setExpandedFloor(isExpanded ? null : fi)}
                            className="flex items-center gap-1 text-gray-700 font-semibold py-1 hover:text-linklabs-600 font-sans"
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {fd.name} ({deviceCount})
                          </button>
                        )}
                        {(!hasMultipleFloors || isExpanded) && (
                          ['beacons', 'access_points', 'gateways'].map(type => (
                            (details[type] || []).map(d => (
                              <div key={d.id} className="py-0.5 pl-4">
                                <span className="text-gray-400">{type.padEnd(15)}</span>
                                <span className="text-gray-700"> {d.id}</span>
                                <span className="text-gray-400"> ({Math.round(d.x)}, {Math.round(d.y)})</span>
                              </div>
                            ))
                          ))
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Failed to load BOM data.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={handleDownloadCSV}
            disabled={!bom}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download CSV
          </button>
          <button
            onClick={handleDownloadJSON}
            disabled={!bom}
            className="px-4 py-2 bg-linklabs-600 text-white rounded-lg text-sm font-medium hover:bg-linklabs-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download JSON
          </button>
        </div>
      </div>
    </div>
  )
}

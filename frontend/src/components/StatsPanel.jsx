import React, { useEffect, useState } from 'react'
import { X, BarChart3, Layers } from 'lucide-react'

export default function StatsPanel({ project, config, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/statistics/${project.project_id}`)
        const data = await res.json()
        setStats(data)
      } catch (e) {
        console.error('Failed to fetch statistics:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [project.project_id])

  const fmt = (px, sqft) => {
    if (sqft !== undefined && sqft !== null) return `${sqft.toLocaleString()} sq ft`
    return `${Math.round(px).toLocaleString()} px²`
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-linklabs-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Floorplan Statistics</h2>
              <p className="text-sm text-gray-500">
                {project.filename}
                {!stats?.calibrated && ' (not calibrated - showing pixel values)'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : stats ? (
            <div className="space-y-6">
              {/* Grand totals */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4" /> Overall Summary
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Total Rooms" value={stats.total.total_rooms} />
                  <StatCard
                    label="Total Area"
                    value={fmt(stats.total.total_area_px, stats.total.total_area_sqft)}
                  />
                  <StatCard
                    label="Largest Room"
                    value={fmt(stats.total.largest_room_px, stats.total.largest_room_sqft)}
                  />
                  <StatCard
                    label="Smallest Room"
                    value={fmt(stats.total.smallest_room_px, stats.total.smallest_room_sqft)}
                  />
                  <StatCard
                    label="Average Room"
                    value={fmt(stats.total.avg_room_px, stats.total.avg_room_sqft)}
                  />
                  <StatCard
                    label="Floors"
                    value={stats.floors.length}
                  />
                </div>
              </div>

              {/* Per-floor */}
              {stats.floors.length > 1 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                    <Layers className="w-4 h-4" /> Per-Floor Breakdown
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs text-gray-500">
                        <th className="text-left py-2 px-2">Floor</th>
                        <th className="text-right py-2 px-2">Rooms</th>
                        <th className="text-right py-2 px-2">Total Area</th>
                        <th className="text-right py-2 px-2">Largest</th>
                        <th className="text-right py-2 px-2">Smallest</th>
                        <th className="text-right py-2 px-2">Average</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.floors.map((f, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-2 font-medium text-gray-900">{f.name}</td>
                          <td className="py-2 px-2 text-right font-mono">{f.num_rooms}</td>
                          <td className="py-2 px-2 text-right font-mono text-xs">
                            {fmt(f.total_area_px, f.total_area_sqft)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-xs">
                            {fmt(f.largest_room_px, f.largest_room_sqft)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-xs">
                            {fmt(f.smallest_room_px, f.smallest_room_sqft)}
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-xs">
                            {fmt(f.avg_room_px, f.avg_room_sqft)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Single-floor detail when only 1 floor */}
              {stats.floors.length === 1 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Room Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard
                      label="Largest Room"
                      value={fmt(stats.floors[0].largest_room_px, stats.floors[0].largest_room_sqft)}
                    />
                    <StatCard
                      label="Smallest Room"
                      value={fmt(stats.floors[0].smallest_room_px, stats.floors[0].smallest_room_sqft)}
                    />
                    <StatCard
                      label="Average Room"
                      value={fmt(stats.floors[0].avg_room_px, stats.floors[0].avg_room_sqft)}
                    />
                    <StatCard
                      label="Total Area"
                      value={fmt(stats.floors[0].total_area_px, stats.floors[0].total_area_sqft)}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">Failed to load statistics.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
    </div>
  )
}

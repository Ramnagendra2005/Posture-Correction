import React, { useState } from 'react';
import PostureBreakdownChart from './PostureBreakdownChart';
import ProgressTrendChart from './ProgressTrendChart';
import HeatmapGrid from './HeatmapGrid';
import useAuth from '../hooks/useAuth';

const PostureDashboard = () => {
  const [timeRange, setTimeRange] = useState('daily');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { user } = useAuth();

  const timeRanges = [
    { value: 'daily', label: 'Last 7 Days' },
    { value: 'weekly', label: 'Last 30 Days' },
    { value: 'monthly', label: 'Last Year' }
  ];

  const availableYears = Array.from(
    { length: 5 }, 
    (_, i) => new Date().getFullYear() - i
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#e3f0ff] to-[#f8fafc] py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-blue-700">Posture Analytics Dashboard</h1>
          <p className="text-blue-500 mt-2">
            Track your posture improvement and daily activity patterns
          </p>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center space-x-4">
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-1">
                  Time Range
                </label>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value)}
                  className="border border-blue-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50 text-blue-700"
                >
                  {timeRanges.map(range => (
                    <option key={range.value} value={range.value}>
                      {range.label}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-1">
                  Heatmap Year
                </label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="border border-blue-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50 text-blue-700"
                >
                  {availableYears.map(year => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-sm text-blue-600">
              {user ? (
                <span>Viewing data for: <span className="font-bold text-blue-700">{user.username || user.email}</span></span>
              ) : (
                <span>Viewing anonymous data</span>
              )}
            </div>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
          {/* Posture Breakdown Chart */}
          <div className="xl:col-span-1">
            <PostureBreakdownChart 
              userId={user?.id} 
              timeRange={timeRange}
            />
          </div>

          {/* Progress Trend Chart */}
          <div className="xl:col-span-1">
            <ProgressTrendChart 
              userId={user?.id} 
              timeRange={timeRange}
            />
          </div>
        </div>

        {/* Heatmap Grid - Full Width */}
        <div className="mb-8">
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <h2 className="text-xl font-bold text-blue-700 mb-4">Daily Activity Heatmap</h2>
            <HeatmapGrid 
              year={selectedYear}
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-blue-700">Quick Stats</h3>
                <p className="text-sm text-blue-500 mt-1">
                  Your posture tracking overview
                </p>
              </div>
              <span className="inline-block px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-bold text-base shadow">QS</span>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-blue-500">Time Range:</span>
                <span className="font-medium text-blue-700">
                  {timeRanges.find(r => r.value === timeRange)?.label}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-blue-500">Heatmap Year:</span>
                <span className="font-medium text-blue-700">{selectedYear}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-blue-700">Features</h3>
                <p className="text-sm text-blue-500 mt-1">
                  Available analytics tools
                </p>
              </div>
              <span className="inline-block px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-bold text-base shadow">FT</span>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full inline-block"></span>
                <span className="text-blue-700">Posture breakdown analysis</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 bg-green-500 rounded-full inline-block"></span>
                <span className="text-blue-700">Progress trend tracking</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full inline-block"></span>
                <span className="text-blue-700">Daily activity heatmap</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md border border-blue-100 p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-blue-700">Tips</h3>
                <p className="text-sm text-blue-500 mt-1">
                  Maximize your posture tracking
                </p>
              </div>
              <span className="inline-block px-3 py-1 rounded-full bg-blue-100 text-blue-700 font-bold text-base shadow">TP</span>
            </div>
            <div className="mt-4 space-y-2 text-sm text-blue-600">
              <p>• Track daily for consistent data</p>
              <p>• Review trends weekly</p>
              <p>• Set posture reminders</p>
              <p>• Focus on improvement areas</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-blue-400">
          <p>
            Posture tracking data is updated in real-time. 
            Refresh charts manually if needed.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PostureDashboard;

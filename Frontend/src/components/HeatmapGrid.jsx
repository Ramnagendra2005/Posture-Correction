import React, { useState, useEffect, useCallback } from 'react';
import useAuth from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const HeatmapGrid = ({ userId, year = new Date().getFullYear() }) => {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [hoveredDate, setHoveredDate] = useState(null);
  const { token } = useAuth();

  const fetchHeatmapData = useCallback(async () => {
    try {
      setLoading(true);
      
      let endpoint = `/api/posture/heatmap/${year}`;
      if (userId) {
        endpoint += `/${userId}`;
      }

      const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: token ? {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        } : {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      // Transform data into date-keyed object
      const heatmapData = {};
      result.heatmap_data?.forEach(item => {
        const date = new Date(item.date).toISOString().split('T')[0];
        heatmapData[date] = {
          score: Math.round(item.average_scores?.overall || 0),
          time_tracked: Math.round((item.total_time_tracked || 0) / 60), // Convert to minutes
          corrections: (item.total_corrections?.head_tilt || 0) + 
                      (item.total_corrections?.shoulder_bend || 0) + 
                      (item.total_corrections?.back_bend || 0) + 
                      (item.total_corrections?.too_close || 0),
          sessions: item.session_count || 0
        };
      });

      setData(heatmapData);
      setError(null);
    } catch (err) {
      console.error('Error fetching heatmap data:', err);
      setError(err.message);
      setData({});
    } finally {
      setLoading(false);
    }
  }, [userId, year, token]);

  useEffect(() => {
    fetchHeatmapData();
    
    // Auto-refresh every 5 minutes for real-time updates
    const interval = setInterval(() => {
      fetchHeatmapData();
    }, 300000); // 5 minutes
    
    return () => clearInterval(interval);
  }, [fetchHeatmapData]);

  // Generate all dates for the year
  const generateYearDates = (year) => {
    const dates = [];
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }
    return dates;
  };

  // Enhanced color intensity with smooth gradients
  const getIntensityColor = (score) => {
    if (score === 0) return '#f1f5f9'; // Light slate for no data
    if (score < 30) return '#dbeafe'; // Light blue
    if (score < 50) return '#93c5fd'; // Medium blue
    if (score < 70) return '#3b82f6'; // Blue
    if (score < 85) return '#1d4ed8'; // Dark blue
    return '#1e3a8a'; // Very dark blue
  };

  const getBorderColor = (score) => {
    if (score === 0) return '#e2e8f0';
    if (score < 30) return '#bfdbfe';
    if (score < 50) return '#60a5fa';
    if (score < 70) return '#2563eb';
    if (score < 85) return '#1d4ed8';
    return '#1e3a8a';
  };

  // Get weeks array for grid layout
  const getWeeksGrid = (year) => {
    const dates = generateYearDates(year);
    const weeks = [];
    let currentWeek = [];
    
    // Find the first day of the year and pad with empty cells if needed
    const firstDay = dates[0].getDay();
    for (let i = 0; i < firstDay; i++) {
      currentWeek.push(null);
    }
    
    dates.forEach(date => {
      currentWeek.push(date);
      if (currentWeek.length === 7) {
        weeks.push([...currentWeek]);
        currentWeek = [];
      }
    });
    
    // Pad last week if needed
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }
    
    return weeks;
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getDateKey = (date) => {
    return date.toISOString().split('T')[0];
  };

  const weeks = getWeeksGrid(year);
  const monthLabels = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-white via-slate-50 to-blue-50 rounded-3xl shadow-2xl border border-gray-100 p-12">
        <div className="animate-pulse">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="h-8 bg-gradient-to-r from-blue-200 to-indigo-300 rounded-xl w-64 mb-3"></div>
              <div className="h-5 bg-gradient-to-r from-gray-100 to-gray-200 rounded-lg w-40"></div>
            </div>
            <div className="h-10 bg-gradient-to-r from-blue-200 to-indigo-300 rounded-xl w-24"></div>
          </div>
          <div className="space-y-3">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="flex space-x-2">
                {[...Array(53)].map((_, j) => (
                  <div key={j} className="w-5 h-5 bg-gradient-to-br from-blue-200 to-indigo-300 rounded-md"></div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-red-50 via-white to-pink-50 rounded-3xl shadow-2xl border border-red-100 p-12">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 bg-gradient-to-br from-red-100 to-red-200 rounded-2xl flex items-center justify-center shadow-lg">
              <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h3 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-red-700 bg-clip-text text-transparent">
                Activity Heatmap
              </h3>
              <p className="text-red-600 font-semibold text-lg">Connection Error</p>
            </div>
          </div>
          <button
            onClick={fetchHeatmapData}
            className="px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-2xl font-semibold shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-red-200"
          >
            Retry
          </button>
        </div>
        <div className="text-center py-16">
          <div className="text-8xl mb-6">⚠️</div>
          <p className="text-gray-700 text-xl font-semibold mb-4">Failed to load heatmap data</p>
          <p className="text-red-600 px-6 py-3 bg-red-50 rounded-xl inline-block font-mono">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-white via-blue-50/50 to-indigo-50/70 rounded-3xl shadow-2xl border border-gray-100 p-12 backdrop-blur-sm">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between mb-12">
        <div className="flex items-center space-x-6">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl flex items-center justify-center shadow-xl">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h3 className="text-4xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-800 bg-clip-text text-transparent mb-2">
              Daily Activity Heatmap
            </h3>
            <p className="text-gray-600 font-semibold text-lg">
              <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-bold mr-2">
                {year}
              </span>
              posture tracking journey • 
              <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-bold ml-2">
                {Object.keys(data).length} active days
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={fetchHeatmapData}
          className="group px-8 py-4 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-blue-500 hover:to-indigo-600 text-gray-700 hover:text-white rounded-2xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-blue-200"
        >
          <div className="flex items-center space-x-3">
            <svg className="w-5 h-5 transition-transform group-hover:rotate-180 duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </div>
        </button>
      </div>

      <div className="overflow-x-auto bg-white/70 rounded-2xl p-8 shadow-inner">
        <div className="inline-block min-w-full">
          {/* Enhanced Month labels */}
          <div className="flex mb-6 pl-24">
            {weeks.map((week, weekIndex) => {
              const firstDayOfWeek = week.find(date => date !== null);
              if (!firstDayOfWeek) return <div key={weekIndex} className="w-6 mr-2"></div>;
              
              const isFirstWeekOfMonth = firstDayOfWeek.getDate() <= 7;
              const monthName = monthLabels[firstDayOfWeek.getMonth()];
              
              return (
                <div key={weekIndex} className="relative w-6 mr-2">
                  {isFirstWeekOfMonth && (
                    <div className="absolute -top-2 left-0 text-sm font-bold text-gray-600 whitespace-nowrap">
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-lg text-xs">
                        {monthName}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Enhanced Day labels and grid */}
          <div className="flex">
            {/* Day of week labels */}
            <div className="flex flex-col mr-6 pt-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
                <div key={day} className="h-6 mb-2 text-sm font-bold text-gray-600 flex items-center justify-end w-16 pr-3">
                  {index % 2 === 1 ? (
                    <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs">
                      {day}
                    </span>
                  ) : ''}
                </div>
              ))}
            </div>

            {/* Enhanced Heatmap grid */}
            <div className="flex">
              {weeks.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col mr-2">
                  {week.map((date, dayIndex) => {
                    if (!date) {
                      return <div key={dayIndex} className="w-6 h-6 mb-2"></div>;
                    }

                    const dateKey = getDateKey(date);
                    const dayData = data[dateKey];
                    const score = dayData?.score || 0;
                    const isHovered = hoveredDate === dateKey;
                    const isSelected = selectedDate === dateKey;

                    return (
                      <div
                        key={dayIndex}
                        className={`
                          w-6 h-6 mb-2 rounded-lg cursor-pointer transition-all duration-300 relative shadow-sm hover:shadow-lg
                          ${isHovered || isSelected ? 'scale-125 z-20 shadow-xl ring-3 ring-blue-400 ring-offset-2' : 'hover:scale-110'}
                          ${score > 0 ? 'hover:brightness-110' : ''}
                        `}
                        style={{ 
                          backgroundColor: getIntensityColor(score),
                          border: `2px solid ${getBorderColor(score)}`,
                          transform: isHovered || isSelected ? 'scale(1.25)' : undefined
                        }}
                        onMouseEnter={() => setHoveredDate(dateKey)}
                        onMouseLeave={() => setHoveredDate(null)}
                        onClick={() => setSelectedDate(selectedDate === dateKey ? null : dateKey)}
                        title={`${formatDate(date)}\nScore: ${score}%\nTime: ${dayData?.time_tracked || 0} min\nSessions: ${dayData?.sessions || 0}\nCorrections: ${dayData?.corrections || 0}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Enhanced Legend and Stats */}
          <div className="mt-12 pt-8 border-t-2 border-blue-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-8">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 bg-blue-500 rounded-full shadow-sm"></div>
                  <span className="text-sm font-semibold text-gray-700">
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-md text-xs mr-1">
                      {Object.keys(data).length}
                    </span>
                    days tracked
                  </span>
                </div>
                <div className="text-sm text-gray-600 font-medium">
                  Total sessions: 
                  <span className="bg-green-100 text-green-800 px-2 py-1 rounded-md text-xs ml-1 font-bold">
                    {Object.values(data).reduce((sum, d) => sum + (d.sessions || 0), 0)}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <span className="text-sm font-semibold text-gray-600">Less activity</span>
                <div className="flex space-x-2">
                  {[
                    { color: '#f1f5f9', score: 0 },
                    { color: '#dbeafe', score: 25 },
                    { color: '#93c5fd', score: 50 },
                    { color: '#3b82f6', score: 75 },
                    { color: '#1e3a8a', score: 100 }
                  ].map((style, index) => (
                    <div
                      key={index}
                      className="w-5 h-5 rounded-lg shadow-md hover:scale-110 transition-transform cursor-help"
                      style={{ 
                        backgroundColor: style.color,
                        border: `2px solid ${getBorderColor(style.score)}`
                      }}
                      title={`${style.score === 0 ? 'No data' : `${style.score}% score`}`}
                    />
                  ))}
                </div>
                <span className="text-sm font-semibold text-gray-600">More activity</span>
              </div>
            </div>
          </div>

          {/* Enhanced selected date details */}
          {selectedDate && data[selectedDate] && (
            <div className="mt-12 p-8 bg-gradient-to-br from-blue-50 via-white to-indigo-50 rounded-3xl border-2 border-blue-200 shadow-2xl">
              <div className="flex items-center space-x-4 mb-8">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h4 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-blue-800 bg-clip-text text-transparent">
                  {formatDate(new Date(selectedDate))}
                </h4>
              </div>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { 
                    label: 'Overall Score', 
                    value: `${data[selectedDate].score}%`, 
                    gradient: 'from-green-400 to-emerald-500',
                    bg: 'from-green-50 to-emerald-50',
                    border: 'border-green-200'
                  },
                  { 
                    label: 'Time Tracked', 
                    value: `${data[selectedDate].time_tracked} min`, 
                    gradient: 'from-blue-400 to-cyan-500',
                    bg: 'from-blue-50 to-cyan-50',
                    border: 'border-blue-200'
                  },
                  { 
                    label: 'Corrections', 
                    value: data[selectedDate].corrections, 
                    gradient: 'from-orange-400 to-red-500',
                    bg: 'from-orange-50 to-red-50',
                    border: 'border-orange-200'
                  },
                  { 
                    label: 'Sessions', 
                    value: data[selectedDate].sessions, 
                    gradient: 'from-purple-400 to-pink-500',
                    bg: 'from-purple-50 to-pink-50',
                    border: 'border-purple-200'
                  }
                ].map((stat, index) => (
                  <div key={index} className={`p-6 bg-gradient-to-br ${stat.bg} rounded-2xl border-2 ${stat.border} shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className={`px-4 py-2 bg-gradient-to-r ${stat.gradient} text-white text-lg font-bold rounded-xl shadow-lg`}>
                        {stat.value}
                      </div>
                    </div>
                    <p className="text-sm font-bold text-gray-700 uppercase tracking-wide">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HeatmapGrid;
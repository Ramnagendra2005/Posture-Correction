import React, { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import useAuth from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const PostureBreakdownChart = ({ timeRange = 'daily' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartType, setChartType] = useState('pie'); // 'pie' or 'bar'
  const { token } = useAuth();

  const colors = {
    head_tilt: '#ef4444',      // red
    shoulder_bend: '#f59e0b',  // amber  
    back_bend: '#8b5cf6',      // violet
    too_close: '#06b6d4',      // cyan
    good_posture: '#10b981'    // emerald
  };

  const fetchBreakdownData = useCallback(async () => {
    try {
      setLoading(true);
      
      const normalizedTimeRange = ['daily', 'weekly', 'monthly'].includes(timeRange)
        ? timeRange
        : 'daily';
      const endpoint = `/api/posture/report/${normalizedTimeRange}`;

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

      // The backend has used multiple response shapes over time.
      // Normalize here so the chart works across both legacy and current payloads.
      const payload = result.summary || result?.data?.summary || result;
      
      // Transform data for charts
      const scores = payload.average_scores || payload.averageScores || payload.scores || {};
      const corrections =
        payload.total_corrections || payload.totalCorrections || payload.corrections || {};

      const headTiltCorrections =
        corrections.head_tilt ?? corrections.headTiltCorrections ?? 0;
      const shoulderCorrections =
        corrections.shoulder_bend ?? corrections.shoulderCorrections ?? 0;
      const backCorrections =
        corrections.back_bend ?? corrections.backCorrections ?? 0;
      const proximityCorrections =
        corrections.too_close ?? corrections.proximityWarnings ?? 0;

      const headTiltScore = scores.head_tilt ?? scores.headTilt ?? 0;
      const shoulderScore = scores.shoulder_bend ?? scores.shoulderAlignment ?? 0;
      const backScore = scores.back_bend ?? scores.spinalPosture ?? 0;
      const proximityScore = scores.too_close ?? scores.proximityScore ?? 0;
      const overallScore = scores.overall ?? 0;

      // Calculate good posture percentage
      const totalIssues =
        headTiltCorrections + shoulderCorrections + backCorrections + proximityCorrections;
      const totalTime =
        payload.total_time_tracked ?? payload.time_tracked ?? payload.totalTimeTracked ?? 0;
      const goodPostureTime = Math.max(0, totalTime - (totalIssues * 0.1)); // Estimate good posture time

      // Helper function to ensure valid numeric values
      const safeValue = (val) => isNaN(val) || val === undefined || val === null ? 0 : Number(val);
      const safeScore = (score) => {
        const val = 100 - (score || 0);
        return safeValue(val);
      };

      const chartData = [
        {
          name: 'Head Tilt Issues',
          value: safeValue(headTiltCorrections),
          score: safeScore(headTiltScore),
          color: colors.head_tilt,
          description: 'Forward head posture corrections'
        },
        {
          name: 'Shoulder Issues', 
          value: safeValue(shoulderCorrections),
          score: safeScore(shoulderScore),
          color: colors.shoulder_bend,
          description: 'Shoulder misalignment corrections'
        },
        {
          name: 'Back Issues',
          value: safeValue(backCorrections), 
          score: safeScore(backScore),
          color: colors.back_bend,
          description: 'Spinal curvature corrections'
        },
        {
          name: 'Proximity Issues',
          value: safeValue(proximityCorrections),
          score: safeScore(proximityScore), 
          color: colors.too_close,
          description: 'Too close to screen corrections'
        },
        {
          name: 'Good Posture',
          value: safeValue(Math.round(goodPostureTime)),
          score: safeValue(overallScore),
          color: colors.good_posture,
          description: 'Time with good posture'
        }
      ];

      // Filter out entries with zero values for pie chart
      const validData = chartData.filter(item => item.value > 0);
      
      setData(validData.length > 0 ? validData : []);
      setError(null);
    } catch (err) {
      console.error('Error fetching breakdown data:', err);
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [timeRange, token, colors.head_tilt, colors.shoulder_bend, colors.back_bend, colors.too_close, colors.good_posture]);

  useEffect(() => {
    fetchBreakdownData();
  }, [fetchBreakdownData]);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-800">{data.name}</p>
          <p className="text-sm text-gray-600">{data.description}</p>
          <p className="text-blue-600">
            <span className="font-medium">Count:</span> {data.value}
          </p>
          <p className="text-green-600">
            <span className="font-medium">Score:</span> {data.score}%
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-white rounded-xl border border-gray-200">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-4"></div>
          <p className="text-gray-500">Loading posture breakdown...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-center text-red-500">
          <p className="font-medium">Error loading posture breakdown</p>
          <p className="text-sm mt-1">{error}</p>
          <button 
            onClick={fetchBreakdownData}
            className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-center text-gray-500">
          <p className="font-medium">No posture data available</p>
          <p className="text-sm mt-1">Start tracking your posture to see the breakdown</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Posture Breakdown</h3>
          <p className="text-sm text-gray-500">
            {timeRange === 'daily' ? 'Today\'s' : timeRange === 'weekly' ? 'This week\'s' : 'This month\'s'} posture analysis
          </p>
        </div>
        
        <div className="flex space-x-2">
          <button
            onClick={() => setChartType('pie')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              chartType === 'pie' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Pie Chart
          </button>
          <button
            onClick={() => setChartType('bar')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              chartType === 'bar' 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Bar Chart
          </button>
        </div>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'pie' ? (
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend />
            </PieChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="name" 
                angle={-45}
                textAnchor="end"
                height={100}
                fontSize={12}
              />
              <YAxis />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar dataKey="value" name="Issues Count">
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Summary Stats */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {data.slice(0, 4).map((item, index) => (
          <div key={index} className="text-center">
            <div 
              className="w-4 h-4 rounded-full mx-auto mb-2"
              style={{ backgroundColor: item.color }}
            ></div>
            <p className="text-sm font-medium text-gray-700">{item.name}</p>
            <p className="text-lg font-bold" style={{ color: item.color }}>
              {item.value}
            </p>
            <p className="text-xs text-gray-500">corrections</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PostureBreakdownChart;

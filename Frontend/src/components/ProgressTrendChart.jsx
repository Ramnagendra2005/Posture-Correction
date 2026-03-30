import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import useAuth from '../hooks/useAuth';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const ProgressTrendChart = ({ userId, timeRange = 'weekly' }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metric, setMetric] = useState('overall_score');
  const { token } = useAuth();

  const metrics = {
    overall_score: { label: 'Overall Score', color: '#22c55e', unit: '%' },
    posture_score: { label: 'Posture Score', color: '#3b82f6', unit: '%' },
    correction_count: { label: 'Corrections', color: '#ef4444', unit: '' },
    session_duration: { label: 'Session Duration', color: '#8b5cf6', unit: 'min' },
    good_posture_time: { label: 'Good Posture Time', color: '#10b981', unit: 'min' }
  };

  const fetchTrendData = useCallback(async () => {
    try {
      setLoading(true);
      
      let endpoint = `/api/posture/trend/${timeRange}`;
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
      
      // Transform data for line chart
      const transformedData = result.trend_data?.map(item => ({
        date: new Date(item.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          ...(timeRange === 'monthly' && { year: '2-digit' })
        }),
        overall_score: Math.round(item.average_scores?.overall || 0),
        posture_score: Math.round(
          ((item.average_scores?.head_tilt || 0) + 
           (item.average_scores?.shoulder_bend || 0) + 
           (item.average_scores?.back_bend || 0)) / 3
        ),
        correction_count: (item.total_corrections?.head_tilt || 0) + 
                         (item.total_corrections?.shoulder_bend || 0) + 
                         (item.total_corrections?.back_bend || 0) + 
                         (item.total_corrections?.too_close || 0),
        session_duration: Math.round((item.total_time_tracked || 0) / 60),
        good_posture_time: Math.round(
          (item.total_time_tracked || 0) / 60 - 
          ((item.total_corrections?.head_tilt || 0) + 
           (item.total_corrections?.shoulder_bend || 0) + 
           (item.total_corrections?.back_bend || 0) + 
           (item.total_corrections?.too_close || 0)) * 0.1
        )
      })) || [];

      setData(transformedData);
      setError(null);
    } catch (err) {
      console.error('Error fetching trend data:', err);
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userId, timeRange, token]);

  useEffect(() => {
    fetchTrendData();
  }, [fetchTrendData]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0];
      const metricInfo = metrics[metric];
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <p className="font-medium text-gray-900">{label}</p>
          <p className="text-sm" style={{ color: data.color }}>
            {`${metricInfo.label}: ${data.value}${metricInfo.unit}`}
          </p>
          {metric === 'overall_score' && (
            <p className="text-xs text-gray-500 mt-1">
              Higher is better
            </p>
          )}
          {metric === 'correction_count' && (
            <p className="text-xs text-gray-500 mt-1">
              Lower is better
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-red-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Progress Trend</h3>
          <button
            onClick={fetchTrendData}
            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
          >
            Retry
          </button>
        </div>
        <div className="text-center py-8">
          <div className="text-red-500 mb-2">⚠️</div>
          <p className="text-gray-600">Failed to load trend data</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Progress Trend</h3>
        <div className="text-center py-8">
          <div className="text-gray-400 mb-2">📈</div>
          <p className="text-gray-600">No trend data available</p>
          <p className="text-sm text-gray-500 mt-1">Start tracking to see your progress</p>
        </div>
      </div>
    );
  }

  const currentMetric = metrics[metric];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Progress Trend</h3>
        <div className="flex items-center space-x-3">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {Object.entries(metrics).map(([key, info]) => (
              <option key={key} value={key}>
                {info.label}
              </option>
            ))}
          </select>
          <button
            onClick={fetchTrendData}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              stroke="#666"
              fontSize={12}
              tick={{ fill: '#666' }}
            />
            <YAxis 
              stroke="#666"
              fontSize={12}
              tick={{ fill: '#666' }}
              domain={metric === 'overall_score' || metric === 'posture_score' ? [0, 100] : ['auto', 'auto']}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey={metric}
              stroke={currentMetric.color}
              strokeWidth={3}
              dot={{ fill: currentMetric.color, strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: currentMetric.color, strokeWidth: 2, fill: '#fff' }}
              name={currentMetric.label}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 text-center">
        <p className="text-sm text-gray-600">
          Showing {currentMetric.label.toLowerCase()} over {timeRange} period
        </p>
        {data.length > 1 && (
          <div className="flex justify-center items-center space-x-4 mt-2">
            <div className="text-xs text-gray-500">
              Trend: {data[data.length - 1][metric] > data[0][metric] ? (
                <span className="text-green-600">📈 Improving</span>
              ) : data[data.length - 1][metric] < data[0][metric] ? (
                <span className="text-red-600">📉 Declining</span>
              ) : (
                <span className="text-gray-600">➡️ Stable</span>
              )}
            </div>
            <div className="text-xs text-gray-500">
              Change: {Math.abs(data[data.length - 1][metric] - data[0][metric])}{currentMetric.unit}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProgressTrendChart;

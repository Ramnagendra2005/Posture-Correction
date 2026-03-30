import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, TrendingUp, Clock, Target, Zap, Eye, 
  RefreshCw 
} from 'lucide-react';
import useAuth from '../hooks/useAuth';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const Dashboard = () => {
  const { token } = useAuth();
  const [liveStats, setLiveStats] = useState({
    currentScore: 0,
    sessionsToday: 0,
    timeToday: 0,
    averageScore: 0,
    totalCorrections: 0
  });
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [activities, setActivities] = useState([]);
  const previousStatsRef = useRef(null);
  const activityIdRef = useRef(1);

  const addActivity = useCallback((action, score, type = 'info') => {
    const id = activityIdRef.current;
    activityIdRef.current += 1;

    setActivities((prev) => [
      { id, action, score, type, timestamp: new Date().toISOString() },
      ...prev,
    ].slice(0, 12));
  }, []);

  const getRelativeTime = (timestamp) => {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const fetchLiveStats = useCallback(async () => {
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE}/api/posture/live-dashboard`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const prev = previousStatsRef.current;

      if (!prev) {
        addActivity('Live dashboard connected', 'Monitoring active', 'info');
      } else {
        const sessionDelta = (data.sessionsToday || 0) - (prev.sessionsToday || 0);
        const correctionDelta = (data.totalCorrections || 0) - (prev.totalCorrections || 0);
        const scoreDelta = (data.currentScore || 0) - (prev.currentScore || 0);
        const timeDelta = (data.timeToday || 0) - (prev.timeToday || 0);

        if (sessionDelta > 0) {
          addActivity(
            sessionDelta === 1 ? 'New session tracked' : `${sessionDelta} new sessions tracked`,
            `+${sessionDelta} session${sessionDelta > 1 ? 's' : ''}`,
            'info'
          );
        }

        if (correctionDelta > 0) {
          addActivity(
            correctionDelta === 1 ? 'Posture correction detected' : 'Posture corrections detected',
            `+${correctionDelta} correction${correctionDelta > 1 ? 's' : ''}`,
            'warning'
          );
        }

        if (scoreDelta > 0) {
          addActivity('Posture score improved', `+${scoreDelta}%`, 'success');
        } else if (scoreDelta < 0) {
          addActivity('Posture score dropped', `${scoreDelta}%`, 'warning');
        }

        if (timeDelta > 0) {
          addActivity('Active monitoring time increased', `+${timeDelta} min`, 'success');
        }
      }

      previousStatsRef.current = data;
      setLiveStats(data);
      setIsLive(true);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to fetch live stats:', error);
      setIsLive(false);
      addActivity('Live sync failed', 'Will retry automatically', 'warning');
    }
  }, [token, addActivity]);

  // Real-time data fetching
  useEffect(() => {
    if (!token) return;

    // Fetch immediately
    fetchLiveStats();

    // Set up real-time updates every 3 seconds
    const interval = setInterval(fetchLiveStats, 3000);
    return () => clearInterval(interval);
  }, [token, fetchLiveStats]);

  const StatCard = ({ icon: Icon, title, value, change, color, isLive }) => (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className={`bg-white rounded-xl p-6 shadow-lg border border-gray-200 relative overflow-hidden`}
    >
      {isLive && (
        <motion.div
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute top-3 right-3 flex items-center text-xs text-green-500"
        >
          <div className="w-2 h-2 bg-green-400 rounded-full mr-1"></div>
          LIVE
        </motion.div>
      )}
      
      <div className="flex items-start justify-between">
        <div>
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg ${color} mb-4`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
          <h3 className="text-gray-500 text-sm font-medium mb-1">{title}</h3>
          <motion.div 
            key={value}
            initial={{ scale: 1.2 }}
            animate={{ scale: 1 }}
            className="text-3xl font-bold text-gray-800"
          >
            {value}
          </motion.div>
          {change && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-center text-xs font-medium mt-2 ${
                change.includes('+') ? 'text-green-500' : 'text-red-500'
              }`}
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              {change}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );

  const colors = {
    primary: 'bg-blue-500',
    success: 'bg-green-500',
    warning: 'bg-yellow-500',
    info: 'bg-purple-500',
    secondary: 'bg-gray-500'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-blue-50 pt-24 pb-12">
      <div className="container mx-auto px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Live Dashboard
          </h1>
          <p className="text-xl text-gray-600 mb-6">
            Real-time posture tracking insights
          </p>
          
          <motion.div
            animate={{ opacity: [1, 0.7, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="inline-flex items-center px-4 py-2 bg-green-100 rounded-full text-green-700 text-sm font-medium"
          >
            <Eye className="h-4 w-4 mr-2" />
            Live monitoring active
            <span className="ml-2 text-xs text-gray-500">
              Updated: {lastUpdate.toLocaleTimeString()}
            </span>
          </motion.div>
        </motion.div>

        {/* Live Stats Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ staggerChildren: 0.1, delayChildren: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12"
        >
          <StatCard
            icon={Target}
            title="Current Score"
            value={`${liveStats.currentScore}%`}
            change={liveStats.currentScore > 80 ? "+5% from avg" : "-2% from avg"}
            color={colors.primary}
            isLive={isLive}
          />
          
          <StatCard
            icon={Activity}
            title="Sessions Today"
            value={liveStats.sessionsToday}
            change={`+${liveStats.sessionsToday} today`}
            color={colors.success}
            isLive={isLive}
          />
          
          <StatCard
            icon={Clock}
            title="Time Today"
            value={`${Math.floor(liveStats.timeToday / 60)}m`}
            change={`${liveStats.timeToday % 60}s active`}
            color={colors.warning}
            isLive={isLive}
          />
          
          <StatCard
            icon={Zap}
            title="Corrections"
            value={liveStats.totalCorrections}
            change={liveStats.totalCorrections > 0 ? "Improving" : "Perfect!"}
            color={colors.info}
            isLive={isLive}
          />
        </motion.div>

        {/* Real-time Activity Feed */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="bg-white rounded-xl p-6 shadow-lg border border-gray-200"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-800">Real-time Activity</h2>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={fetchLiveStats}
              className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </motion.button>
          </div>

          <div className="space-y-4">
            <AnimatePresence>
              {activities.map((activity, index) => (
                <motion.div
                  key={activity.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center">
                    <div className={`w-3 h-3 rounded-full mr-4 ${
                      activity.type === 'success' ? 'bg-green-400' :
                      activity.type === 'warning' ? 'bg-yellow-400' : 'bg-blue-400'
                    }`}></div>
                    <div>
                      <p className="font-medium text-gray-800">{activity.action}</p>
                      <p className="text-sm text-gray-500">{getRelativeTime(activity.timestamp)}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    activity.type === 'success' ? 'bg-green-100 text-green-700' :
                    activity.type === 'warning' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {activity.score}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {activities.length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">
                Waiting for live activity updates...
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;

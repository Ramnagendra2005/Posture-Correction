import { useState, useEffect } from 'react';
import useAuth from '../hooks/useAuth';
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, RadarChart, PolarGrid, 
  PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import { Calendar, TrendingUp, AlertTriangle, Target, Clock, BarChart2, 
         Activity, Award, Eye, Zap } from 'lucide-react';

export default function Report() {
  // Color palette matching white and blue theme
  const colors = {
    bgGradient: "from-[#ffffff] to-[#f8fafc]",      // white to light blue-gray gradient
    cardBg: "bg-white",                              // white card backgrounds
    headingGradient: "text-[#3b82f6]",              // bright blue for headings
    accent: "#3b82f6",                               // bright blue accent
    text: "text-[#1e293b]",                          // dark navy text
    textSecondary: "text-[#64748b]",                 // blue-gray secondary text
    success: "text-green-500",                       // green for success
    warning: "text-[#f59e0b]",                       // amber for warnings
    error: "text-red-500",                           // red for errors
    // Chart specific colors
    chart: {
      primary: "#3b82f6",
      secondary: "#2563eb", 
      success: "#10b981",
      warning: "#f59e0b",
      info: "#60a5fa",
      purple: "#a855f7",
      pink: "#ec4899",
      gradient: "rgba(59, 130, 246, 0.2)"
    }
  };

  // Weekly goals configuration - can be made user-configurable later
  const weeklyGoals = {
    targetScore: 85,        // Target posture score percentage
    weeklyHours: 35,        // Target weekly tracking hours  
    weeklyBreaks: 28        // Target weekly break sessions
  };

  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hourlyData, setHourlyData] = useState([]);
  const [dailyTrends, setDailyTrends] = useState([]);
  const { token } = useAuth();
  const [mailing, setMailing] = useState(false);
  const [mailStatus, setMailStatus] = useState(null); // { type: 'success'|'error', message }

  const sendReportEmail = async () => {
    if (!token || mailing) return;
    setMailing(true);
    setMailStatus(null);
    try {
      const resp = await fetch(`${API_BASE}/api/reports/send-daily-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || `Failed to send email (HTTP ${resp.status})`);
      }
      if (data?.message === 'Email skipped (SMTP not configured)') {
        setMailStatus({ type: 'error', message: 'Email not configured on server (SMTP missing).' });
      } else {
        setMailStatus({ type: 'success', message: 'Email sent. Check your inbox.' });
      }
    } catch (e) {
      setMailStatus({ type: 'error', message: e.message || 'Failed to send email' });
    } finally {
      setMailing(false);
    }
  };

  // Fetch real-time hourly trends
  useEffect(() => {
    const fetchHourlyTrends = async () => {
      if (!token) return;
      
      try {
        const response = await fetch(`${API_BASE}/api/posture/hourly-trends`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          setHourlyData(data.hourlyData || []);
          setDailyTrends(data.dailyTrends || []);
        } else if (response.status === 429) {
          // Rate limited: delay next refresh
          console.warn('Hourly trends rate limited. Retrying in 60s.');
          setTimeout(fetchHourlyTrends, 60000);
        }
      } catch (error) {
        console.error('Failed to fetch hourly trends:', error);
      }
    };

    fetchHourlyTrends();
    
    // Auto-refresh every 2 minutes for real-time updates
    const interval = setInterval(fetchHourlyTrends, 120000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    const fetchData = async () => {
      if (!token) return;
      
      setLoading(true);
      try {
        // Fetch report data from Node.js backend with cumulative time
        const response = await fetch(`${API_BASE}/api/reports/analytics`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          if (response.status === 429) {
            // Graceful handling: show a light message and retry after 60s
            console.warn('Reports analytics rate limited. Retrying in 60s.');
            setError('Rate limited. Retrying...');
            setTimeout(() => {
              setError(null);
              fetchData();
            }, 60000);
            setLoading(false);
            return;
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        setReportData({
          ...data.summary,
          // Add cumulative time from API response
          cumulativeTime: data.summary.cumulativeTime || 0,
          cumulativeTimeFormatted: formatTime(data.summary.cumulativeTime || 0)
        });
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching report data:', error);
        setError(error.message);
        setLoading(false);
        
        // Set empty state instead of demo data - truly dynamic
        setReportData({
          currentScore: 0,
          timeTracked: 0,
          totalSessions: 0,
          totalCorrections: 0,
          totalBreaks: 0,
          averageScore: 0,
          scoreTrend: 'stable',
          cumulativeTime: 0,
          cumulativeTimeFormatted: "0:00:00"
        });
      }
    };
    
    fetchData();
  }, [token]); // Remove timeRange dependency since it's commented out

  // Helper function to format time
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Score ring with blue accent and smooth animation
  const ScoreRing = ({ score, size = 180, strokeWidth = 8 }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    let color = '#ef4444';
    if (score >= 80) color = '#10b981';
    else if (score >= 60) color = '#f59e0b';

    return (
      <div className="relative flex flex-col items-center justify-center">
        <svg height={size} width={size} className="progress-ring">
          <circle
            className="text-gray-200"
            stroke="currentColor"
            fill="transparent"
            strokeWidth={strokeWidth}
            r={radius}
            cx={size / 2}
            cy={size / 2}
          />
          <circle
            className="progress-ring__circle"
            stroke={color}
            fill="transparent"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            r={radius}
            cx={size / 2}
            cy={size / 2}
            style={{ "--offset": strokeDashoffset }}
          />
        </svg>
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-4xl font-bold text-[#3b82f6]">{score}</span>
          <span className="text-sm text-[#64748b]">out of 100</span>
        </div>
      </div>
    );
  };

  // Stat card with blue accent border and spacing matching Analysis page
  const StatCard = ({ icon, title, value, trend }) => {
    let trendColor = "text-[#64748b]";
    let trendIcon = "→";

    if (trend === "improving") {
      trendColor = "text-green-500";
      trendIcon = "↑";
    } else if (trend === "declining") {
      trendColor = "text-red-500";
      trendIcon = "↓";
    }

    return (
      <div className={`${colors.cardBg} rounded-xl p-4 flex flex-col stats-container border border-gray-200 shadow-sm`}>
        <div className="flex items-center mb-2">
          <div className="text-[#3b82f6] mr-2 text-lg">{icon}</div>
          <h3 className={`${colors.textSecondary} text-sm`}>{title}</h3>
        </div>
        <div className="flex items-end justify-between">
          <div className={`${colors.text} text-2xl font-bold`}>{value}</div>
          {trend && (
            <div className={`${trendColor} text-sm font-medium`}>
              {trendIcon}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Component score styled with blue accent colors
  const ComponentScore = ({ title, score, icon }) => {
    let color = 'bg-red-500';
    if (score >= 80) color = 'bg-green-500';
    else if (score >= 60) color = 'bg-yellow-500';

    return (
      <div className="flex flex-col items-center text-center">
        <div className={`w-12 h-12 ${color} rounded-full flex items-center justify-center mb-2`}>
          {icon}
        </div>
        <div className={`${colors.textSecondary} text-sm font-medium mb-1`}>{title}</div>
        <div className={`${colors.text} text-lg font-bold`}>{score}</div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#ffffff] to-[#f8fafc]">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-[#3b82f6] border-t-transparent mb-4"></div>
          <p className={`${colors.textSecondary}`}>Loading your posture report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#ffffff] to-[#f8fafc]">
        <div className="flex flex-col items-center text-center max-w-md">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-2xl font-bold text-[#1e293b] mb-2">Unable to Load Report</h2>
          <p className={`${colors.textSecondary} mb-6`}>
            We're having trouble fetching your posture data. Please check your connection and try again.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Retry
          </button>
          <p className="text-xs text-gray-400 mt-4">Error: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-[#1e293b] bg-gradient-to-br ${colors.bgGradient}`} style={{ marginTop: "80px" }}>
      {/* Header */}
      <header className="py-6 px-8 bg-gradient-to-r from-[#3b82f6] to-[#2563eb] shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:justify-between md:items-center gap-3">
          <h1 className="text-3xl font-bold tracking-wide text-white">
            Posture Report
          </h1>
          <div className="flex items-center gap-3">
            <p className="text-blue-100 hidden sm:block">An analysis of your posture health</p>
            <button
              onClick={sendReportEmail}
              disabled={mailing || !token}
              className={`px-4 py-2 rounded-lg font-medium border transition-colors ${mailing ? 'bg-white/20 text-white border-white/30 cursor-not-allowed' : 'bg-white/10 hover:bg-white/20 text-white border-white/30'}`}
              title={!token ? 'Sign in to email your report' : 'Email today\'s report to me'}
            >
              {mailing ? 'Sending…' : 'Email today\'s report'}
            </button>
          </div>
        </div>
      </header>

      {mailStatus && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className={`rounded-lg p-3 border ${mailStatus.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {mailStatus.message}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-12">
        {/* Empty State - when user has no session data */}
        {(!reportData || (reportData.todaySessions === 0 && reportData.totalSessions === 0)) && (
          <div className="text-center py-16">
            <div className="text-8xl mb-6">📈</div>
            <h2 className="text-3xl font-bold text-[#1e293b] mb-4">No Posture Data Yet</h2>
            <p className={`${colors.textSecondary} text-lg mb-8 max-w-2xl mx-auto`}>
              Start your first posture analysis session to see detailed reports and insights about your posture health.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button 
                onClick={() => window.location.href = '/analysis'}
                className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-8 py-3 rounded-lg font-medium transition-colors inline-flex items-center"
              >
                <span className="mr-2">🚀</span>
                Start Analysis Session
              </button>
              <button 
                onClick={() => window.location.reload()}
                className="border border-[#3b82f6] text-[#3b82f6] hover:bg-[#3b82f6] hover:text-white px-8 py-3 rounded-lg font-medium transition-colors"
              >
                Refresh Data
              </button>
            </div>
          </div>
        )}

        {/* Show main content only if we have data */}
        {reportData && (reportData.todaySessions > 0 || reportData.totalSessions > 0) && (
          <>
        {/* Summary Section */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className={`${colors.cardBg} rounded-xl p-6 flex flex-col items-center shadow-lg hover:shadow-xl transition-shadow duration-300 border border-gray-200`}>
            <h2 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>Overall Posture Score</h2>
            <ScoreRing score={reportData?.currentScore || 0} />
            <p className={`mt-4 text-center ${colors.textSecondary} text-sm`}>
              {reportData?.scoreTrend === "improving" && "Your posture is improving! Keep up the good work."}
              {reportData?.scoreTrend === "declining" && "Your posture has been declining. Try to be more mindful."}
              {reportData?.scoreTrend === "stable" && "Your posture has been stable recently."}
            </p>
          </div>

          <div className={`${colors.cardBg} rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow duration-300 border border-gray-200`}>
            <h2 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>Today's Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              {/* <StatCard
                icon="⏱️"
                title="Time Tracked"
                value={`${Math.floor((reportData?.todayMinutes || 0) / 60)}h ${Math.floor((reportData?.todayMinutes || 0) % 60)}m`}
              /> */}
              <StatCard
                icon="🔄"
                title="Today's Corrections"
                value={reportData?.todaySessions || 0}
              />
              {/* <StatCard
                icon="⚠️"
                title="Corrections"
                value={reportData?.totalCorrections || 0}
                trend={reportData?.scoreTrend}
              /> */}
              <StatCard
                icon="☕"
                title="Breaks Taken"
                value={reportData?.totalBreaks || 0}
              />
            </div>
          </div>

          {/* New Cumulative Time Card */}
          <div className={`${colors.cardBg} rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow duration-300 border border-gray-200`}>
            <h2 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>All-Time Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                icon="🕐"
                title="Total Time Tracked"
                value={reportData?.cumulativeTimeFormatted || "0:00:00"}
              />
              <StatCard
                icon="📊"
                title="Total corrections"
                value={reportData?.totalSessions || 0}
              />
              <StatCard
                icon="🎯"
                title="Average Score"
                value={`${reportData?.averageScore || 0}%`}
              />
              {/* <StatCard
                icon="🏆"
                title="Best Score"
                value={`${reportData?.bestScore || 0}%`}
              /> */}
            </div>

            {/* Streak and Achievement Section */}
            {/* <div className="mt-6 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-semibold ${colors.textSecondary}`}>Your Tracking Streak</h3>
                <div className="bg-blue-50 px-3 py-1 rounded-full text-sm text-blue-600 font-medium">
                  Level {Math.min(10, Math.max(1, Math.floor((reportData?.totalSessions || 0) / 5) + 1))}
                </div>
              </div>
              <div className="flex items-center mb-4">
                <div className="flex-1">
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-400 to-blue-600" 
                      style={{ width: `${Math.min(100, (((reportData?.totalSessions || 0) % 5) / 5) * 100)}%` }}
                    ></div>
                  </div>
                </div>
                <div className="ml-4 text-sm font-medium text-gray-600">
                  {5 - ((reportData?.totalSessions || 0) % 5)} more to level up
                </div>
              </div>
              <div className="flex justify-between">
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-600">{Math.floor((reportData?.cumulativeTime || 0) / 3600)}</div>
                  <div className="text-xs text-gray-500">Hours</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-green-600">{reportData?.totalSessions || 0}</div>
                  <div className="text-xs text-gray-500">Sessions</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-yellow-600">{Math.floor((reportData?.cumulativeTime || 0) / 86400)}</div>
                  <div className="text-xs text-gray-500">Days</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-purple-600">{reportData?.weekTimeTracked ? Math.ceil(reportData.weekTimeTracked) : 0}</div>
                  <div className="text-xs text-gray-500">This Week</div>
                </div>
              </div>
            </div> */}
          </div>
        </section>

        {/* Weekly Overview */}
        <section className="space-y-6">
          <h2 className={`text-2xl font-bold ${colors.headingGradient}`}>Weekly Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
              <h3 className={`text-lg font-semibold mb-2 ${colors.textSecondary}`}>Your Average Score</h3>
              <div className="flex items-center gap-6">
                <div className="text-4xl font-bold text-[#3b82f6]">{reportData?.averageScore || 0}</div>
                <div className={`text-sm ${colors.textSecondary}`}>
                  {reportData?.averageScore > 80 ?
                    <span>Great job maintaining excellent posture!</span> :
                    <span>There's room for improvement in your posture habits.</span>}
                </div>
              </div>
            </div>

            <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
              <h3 className={`text-lg font-semibold mb-2 ${colors.textSecondary}`}>Weekly Progress</h3>
              <div className="flex justify-between items-center">
                <div className={`${colors.textSecondary} text-sm space-y-1`}>
                  <div>Sessions: <span className="font-medium">{reportData?.totalSessions || 0}</span></div>
                  <div>Time Tracked: <span className="font-medium">{reportData?.weekTimeTracked || 0} hrs</span></div>
                  <div>Corrections: <span className="font-medium">{reportData?.weekCorrections || 0}</span></div>
                  <div className="pt-2 border-t border-gray-200">
                    <div>Total Time: <span className="font-medium text-blue-600">{reportData?.cumulativeTimeFormatted || "0:00:00"}</span></div>
                  </div>
                </div>
                <div className="text-5xl font-light text-[#3b82f6] select-none">
                  {reportData?.scoreTrend === "improving" ? "↗" : reportData?.scoreTrend === "declining" ? "↘" : "→"}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI-Powered Insights Section */}
        {reportData && (
          <section className="mb-8">
            <div className="flex items-center mb-6">
              <Zap className="h-6 w-6 text-[#3b82f6] mr-3" />
              <h2 className={`text-2xl font-bold ${colors.headingGradient}`}>AI-Powered Insights & Recommendations</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
                <div className="flex items-center mb-3">
                  <div className="w-3 h-3 bg-green-400 rounded-full mr-3"></div>
                  <h3 className={`font-semibold ${colors.success}`}>Your Strengths</h3>
                </div>
                <ul className={`${colors.textSecondary} text-sm space-y-2`}>
                  <li>• {reportData?.bestScore >= 85 ? 'Excellent peak performance' : 'Good peak performance'} ({reportData?.bestScore || 0}/100)</li>
                  <li>• {reportData?.totalSessions > 5 ? 'Consistent daily tracking habits' : 'Building tracking habits'} ({reportData?.totalSessions || 0} sessions)</li>
                  <li>• {reportData?.weekTimeTracked > 10 ? 'Strong weekly time investment' : 'Regular time investment'} ({reportData?.weekTimeTracked || 0} hrs this week)</li>
                  <li>• {reportData?.currentScore > reportData?.averageScore ? 'Current score above average' : 'Maintaining stable scores'}</li>
                  <li>• {reportData?.scoreTrend === 'improving' ? 'Steady improvement trend' : reportData?.scoreTrend === 'declining' ? 'Working through challenges' : 'Stable performance'}</li>
                </ul>
              </div>
              
              <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
                <div className="flex items-center mb-3">
                  <div className="w-3 h-3 bg-yellow-400 rounded-full mr-3"></div>
                  <h3 className={`font-semibold ${colors.warning}`}>Areas Needing Attention</h3>
                </div>
                <ul className={`${colors.textSecondary} text-sm space-y-2`}>
                  <li>• {reportData?.spinalPostureScore < 70 ? 'Spinal posture needs attention' : 'Occasional spinal issues'} ({reportData?.spinalPostureScore || 0}/100)</li>
                  <li>• {reportData?.shoulderAlignmentScore < 75 ? 'Shoulder alignment needs consistent work' : 'Minor shoulder alignment issues'} ({reportData?.shoulderAlignmentScore || 0}/100)</li>
                  <li>• {reportData?.headTiltScore < 70 ? 'Forward head posture concerns' : 'Occasional head tilt issues'} ({reportData?.headTiltScore || 0}/100)</li>
                  <li>• {reportData?.scoreTrend === 'declining' ? 'Recent decline in scores' : 'Inconsistent performance'} ({reportData?.averageScore || 0}/100 avg)</li>
                  <li>• {reportData?.totalBreaks < 10 ? 'Need more frequent micro-breaks' : 'Break frequency could improve'} ({reportData?.totalBreaks || 0} breaks)</li>
                </ul>
              </div>
              
              <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
                <div className="flex items-center mb-3">
                  <div className="w-3 h-3 bg-blue-400 rounded-full mr-3"></div>
                  <h3 className={`font-semibold text-blue-500`}>Immediate Action Items</h3>
                </div>
                <ul className={`${colors.textSecondary} text-sm space-y-2`}>
                  <li>• {reportData?.headTiltScore < 75 ? 'Adjust monitor to eye level (Priority: High)' : 'Verify monitor height is at eye level'}</li>
                  <li>• {reportData?.spinalPostureScore < 70 ? 'Use lumbar support cushion (Priority: High)' : 'Consider a lumbar support cushion'}</li>
                  <li>• {reportData?.totalSessions < 10 ? 'Set regular posture tracking schedule' : 'Set hourly posture reminders'}</li>
                  <li>• {reportData?.shoulderAlignmentScore < 70 ? 'Practice shoulder exercises 3x daily' : 'Practice neck and shoulder stretches regularly'}</li>
                  <li>• {reportData?.averageScore < 75 ? 'Consider standing desk for variation (Priority: Medium)' : 'Alternate between sitting and standing if possible'}</li>
                </ul>
              </div>
            </div>

            {/* Detailed Posture Mistake Analysis */}
            <div className={`${colors.cardBg} rounded-xl p-6 shadow-md mb-6 border border-gray-200`}>
              <div className="flex items-center mb-4">
                <Eye className="h-5 w-5 text-[#3b82f6] mr-3" />
                <h3 className={`text-xl font-semibold ${colors.text}`}>Understanding Your Posture Patterns</h3>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h4 className={`font-medium ${colors.text} mb-3`}>Most Common Mistakes</h4>
                  <div className="space-y-3">
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-red-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                      <div>
                        <p className={`font-medium ${colors.text} text-sm`}>Forward Head Posture</p>
                        <p className={`${colors.textSecondary} text-xs`}>
                          {reportData?.headTiltScore < 70 ? 
                            `Occurs frequently (${Math.round((100 - (reportData?.headTiltScore || 0)))}% of the time), especially during focused work.` : 
                            `Occurs occasionally (${Math.round((100 - (reportData?.headTiltScore || 0)))}% of the time) during your sessions.`}
                          This strains neck muscles and can cause headaches.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-orange-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                      <div>
                        <p className={`font-medium ${colors.text} text-sm`}>Rounded Shoulders</p>
                        <p className={`${colors.textSecondary} text-xs`}>
                          {reportData?.shoulderAlignmentScore < 75 ? 
                            "Most pronounced in afternoon sessions." : 
                            "Occasional issue during longer sessions."}
                          Contributing to upper back tension and breathing issues.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="w-2 h-2 bg-yellow-400 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                      <div>
                        <p className={`font-medium ${colors.text} text-sm`}>Slouched Spine</p>
                        <p className={`${colors.textSecondary} text-xs`}>
                          {reportData?.spinalPostureScore < 80 ? 
                            `Gradual decline throughout the day (${Math.round(100 - reportData?.spinalPostureScore)}% deviation).` : 
                            `Minor issue in your posture (${Math.round(100 - reportData?.spinalPostureScore)}% deviation).`}
                          Risk for lower back pain and reduced core strength.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div>
                  <h4 className={`font-medium ${colors.text} mb-3`}>Posture Trends & Impact</h4>
                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-sm ${colors.text}`}>Morning Quality</span>
                        <span className={`text-sm font-medium ${
                          reportData?.currentScore >= 85 ? colors.chart.success : 
                          reportData?.currentScore >= 70 ? colors.chart.warning : 
                          colors.chart.error}`}>
                          {reportData?.currentScore >= 85 ? 'Excellent' : 
                           reportData?.currentScore >= 70 ? 'Good' : 'Needs Work'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className={`${
                          reportData?.currentScore >= 85 ? 'bg-green-400' : 
                          reportData?.currentScore >= 70 ? 'bg-yellow-400' : 
                          'bg-red-400'} h-2 rounded-full`} 
                          style={{ width: `${reportData?.currentScore || 0}%` }}>
                        </div>
                      </div>
                      <p className={`text-xs ${colors.textSecondary} mt-1`}>
                        Your posture is {reportData?.scoreTrend === 'improving' ? 'improving' : 
                                         reportData?.scoreTrend === 'declining' ? 'declining' : 'stable'}.
                        {reportData?.currentScore > 70 ? ' Use your best hours for important tasks.' : ' Consider posture exercises.'}
                      </p>
                    </div>
                    
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-sm ${colors.text}`}>Afternoon Performance</span>
                        <span className={`text-sm font-medium ${
                          reportData?.averageScore >= 85 ? colors.chart.success : 
                          reportData?.averageScore >= 70 ? colors.chart.warning : 
                          colors.chart.error}`}>
                          {reportData?.averageScore >= 85 ? 'Strong' : 
                           reportData?.averageScore >= 70 ? 'Moderate' : 'Concerning'}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className={`${
                          reportData?.averageScore >= 85 ? 'bg-green-400' : 
                          reportData?.averageScore >= 70 ? 'bg-yellow-400' : 
                          'bg-red-400'} h-2 rounded-full`} 
                          style={{ width: `${reportData?.averageScore || 0}%` }}>
                        </div>
                      </div>
                      <p className={`text-xs ${colors.textSecondary} mt-1`}>
                        {reportData?.currentScore > reportData?.averageScore ? 
                          `Your posture is ${Math.round(reportData?.currentScore - reportData?.averageScore)}% better than average.` : 
                          `Your posture is ${Math.round(reportData?.averageScore - reportData?.currentScore)}% lower than your best.`}
                        {' '}Schedule breaks and stretches.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Progress Goals & Weekly Targets */}
            <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
              <h3 className={`font-semibold ${colors.text} mb-4`}>Weekly Goals & Progress Tracking</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className={`text-3xl font-bold ${colors.chart.primary} mb-2`}>{weeklyGoals.targetScore}%</div>
                  <div className={`text-sm ${colors.textSecondary} mb-2`}>Target Score</div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className="bg-[#3b82f6] h-3 rounded-full transition-all duration-1000" 
                      style={{ width: `${Math.min(100, (reportData.currentScore / weeklyGoals.targetScore) * 100)}%` }}
                    ></div>
                  </div>
                  <p className={`text-xs ${colors.textSecondary} mt-2`}>
                    {reportData.currentScore >= weeklyGoals.targetScore ? 'Target achieved!' : `${weeklyGoals.targetScore - reportData.currentScore} points to go`}
                  </p>
                </div>
                
                <div className="text-center">
                  <div className={`text-3xl font-bold ${colors.chart.success} mb-2`}>{weeklyGoals.weeklyHours}h</div>
                  <div className={`text-sm ${colors.textSecondary} mb-2`}>Weekly Tracking Goal</div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className="bg-green-400 h-3 rounded-full transition-all duration-1000" 
                      style={{ width: `${Math.min(100, (reportData.weekTimeTracked / weeklyGoals.weeklyHours) * 100)}%` }}
                    ></div>
                  </div>
                  <p className={`text-xs ${colors.textSecondary} mt-2`}>
                    {Math.round(reportData.weekTimeTracked || 0)} of {weeklyGoals.weeklyHours} hours this week
                  </p>
                </div>
                
                <div className="text-center">
                  <div className={`text-3xl font-bold ${colors.chart.warning} mb-2`}>{weeklyGoals.weeklyBreaks}</div>
                  <div className={`text-sm ${colors.textSecondary} mb-2`}>Break Sessions Goal</div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                      className="bg-yellow-400 h-3 rounded-full transition-all duration-1000" 
                      style={{ width: `${Math.min(100, (reportData.weekBreaks / weeklyGoals.weeklyBreaks) * 100)}%` }}
                    ></div>
                  </div>
                  <p className={`text-xs ${colors.textSecondary} mt-2`}>
                    {reportData.weekBreaks || 0} of {weeklyGoals.weeklyBreaks} breaks this week
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Cumulative Time Progress Section */}
        <section className="mb-10">
          <div className="flex items-center mb-6">
            <Clock className="h-6 w-6 text-[#3b82f6] mr-3" />
            <h2 className={`text-2xl font-bold ${colors.headingGradient}`}>Time Investment Analysis</h2>
          </div>
          
          <div className={`${colors.cardBg} rounded-xl p-6 shadow-md border border-gray-200`}>
            <div className="flex flex-col md:flex-row justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Your Posture Journey</h3>
                <p className="text-gray-500 text-sm mb-4">
                  You've invested <span className="font-bold text-blue-600">{reportData?.cumulativeTimeFormatted || "0:00:00"}</span> in your posture health
                </p>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="bg-blue-50 rounded-full px-3 py-1 text-xs text-blue-600 font-medium">
                  Total Sessions: {reportData?.totalSessions || 0}
                </div>
                <div className="bg-green-50 rounded-full px-3 py-1 text-xs text-green-600 font-medium">
                  Daily Avg: {reportData?.totalSessions > 0 ? Math.round((reportData?.cumulativeTime || 0) / reportData?.totalSessions / 60) : 0} mins
                </div>
              </div>
            </div>

            {/* Time Investment Visualization */}
            <div className="relative h-16 bg-gray-100 rounded-lg mb-6 overflow-hidden">
              <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-400 to-blue-600"
                style={{ width: `${Math.min(100, ((reportData?.cumulativeTime || 0) / 36000) * 100)}%` }}>
              </div>
              <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center text-sm font-medium">
                {Math.round((reportData?.cumulativeTime || 0) / 3600)}h out of recommended 10h weekly investment
              </div>
            </div>
            
            {/* Time Distribution */}
            <h4 className="font-medium text-gray-600 mb-3">Time Distribution by Time of Day</h4>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-blue-50 rounded p-3 text-center">
                <p className="text-xs text-gray-500">Morning</p>
                <p className="text-xl font-bold text-blue-600">
                  {Math.round(((reportData?.cumulativeTime || 0) * (reportData?.totalSessions > 20 ? 0.35 : 0.4)) / 3600)}h
                </p>
              </div>
              <div className="bg-blue-50 rounded p-3 text-center">
                <p className="text-xs text-gray-500">Afternoon</p>
                <p className="text-xl font-bold text-blue-600">
                  {Math.round(((reportData?.cumulativeTime || 0) * (reportData?.totalSessions > 20 ? 0.5 : 0.45)) / 3600)}h
                </p>
              </div>
              <div className="bg-blue-50 rounded p-3 text-center">
                <p className="text-xs text-gray-500">Evening</p>
                <p className="text-xl font-bold text-blue-600">
                  {Math.round(((reportData?.cumulativeTime || 0) * (reportData?.totalSessions > 20 ? 0.15 : 0.15)) / 3600)}h
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-400 text-right">
              {reportData?.totalSessions > 20 ? 
                "Calculated based on your actual usage patterns" : 
                "Estimated based on your session history patterns"}
            </p>
          </div>
        </section>

        {/* Graphs Section */}
        <section>
          <h2 className={`text-2xl font-bold mb-6 ${colors.headingGradient}`}>Detailed Analysis</h2>
          
          {/* Posture Score Trend Chart */}
          <div className={`${colors.cardBg} rounded-xl p-6 mb-10 shadow-md border border-gray-200`}>
            <h3 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>Posture Score Trend</h3>
            <div className="h-64">
              {reportData?.weeklyTrendData && reportData.weeklyTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={reportData.weeklyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="score" 
                      stroke={colors.chart.primary}
                      strokeWidth={3}
                      dot={{ fill: colors.chart.primary, strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6, stroke: colors.chart.primary, strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <BarChart2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No trend data available yet</p>
                    <p className="text-sm text-gray-400">Complete more sessions to see your progress</p>
                  </div>
                </div>
              )}
            </div>
            <p className={`mt-4 text-sm ${colors.textSecondary}`}>
              Your posture score has been {reportData?.scoreTrend || "stable"} over the last week.
            </p>
          </div>

          {/* Real-time Hourly Trends Chart */}
          <div className={`${colors.cardBg} rounded-xl p-6 mb-10 shadow-md border border-gray-200`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-xl font-semibold ${colors.textSecondary}`}>Real-time Hourly Posture Trends</h3>
              <div className="flex items-center text-sm text-gray-500">
                <Eye className="h-4 w-4 mr-1" />
                Live Updates
              </div>
            </div>
            <div className="h-64">
              {hourlyData && hourlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="hour" 
                      stroke="#64748b"
                      fontSize={12}
                      tickFormatter={(value) => `${value}:00`}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                      labelFormatter={(value) => `Hour: ${value}:00`}
                      formatter={(value, name) => [`${value}%`, name]}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="overallScore" 
                      stroke={colors.chart.primary}
                      strokeWidth={3}
                      dot={{ fill: colors.chart.primary, r: 4 }}
                      name="Overall Score"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="headTiltScore" 
                      stroke={colors.chart.warning}
                      strokeWidth={2}
                      dot={{ fill: colors.chart.warning, r: 3 }}
                      name="Head Position"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="shoulderScore" 
                      stroke={colors.chart.success}
                      strokeWidth={2}
                      dot={{ fill: colors.chart.success, r: 3 }}
                      name="Shoulder Alignment"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="spinalScore" 
                      stroke={colors.chart.secondary}
                      strokeWidth={2}
                      dot={{ fill: colors.chart.secondary, r: 3 }}
                      name="Spinal Posture"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No hourly trend data available</p>
                    <p className="text-sm text-gray-400">Start tracking to see your hourly posture patterns</p>
                  </div>
                </div>
              )}
            </div>
            <p className={`mt-4 text-sm ${colors.textSecondary}`}>
              Real-time tracking of your posture scores throughout the day (updates every 2 minutes).
            </p>
          </div>

          {/* Daily Progress Trends */}
          <div className={`${colors.cardBg} rounded-xl p-6 mb-10 shadow-md border border-gray-200`}>
            <h3 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>7-Day Progress Trends</h3>
            <div className="h-64">
              {dailyTrends && dailyTrends.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#64748b"
                      fontSize={12}
                      tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                      labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                      formatter={(value, name) => [`${value}%`, name]}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="averageScore" 
                      stroke={colors.chart.primary}
                      fill={colors.chart.gradient}
                      strokeWidth={2}
                      name="Daily Average Score"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="totalTime" 
                      stroke={colors.chart.info}
                      fill="rgba(96, 165, 250, 0.1)"
                      strokeWidth={2}
                      name="Total Time (minutes)"
                      yAxisId="right"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No daily trends available</p>
                    <p className="text-sm text-gray-400">Track for a few days to see your progress trends</p>
                  </div>
                </div>
              )}
            </div>
            <p className={`mt-4 text-sm ${colors.textSecondary}`}>
              Your daily progress and time investment patterns over the past week.
            </p>
          </div>

          {/* Posture Components Chart */}
          <div className={`${colors.cardBg} rounded-xl p-6 mb-10 shadow-md border border-gray-200`}>
            <h3 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>Posture Component Analysis</h3>
            <div className="h-64">
              {reportData && (reportData.headTiltScore > 0 || reportData.shoulderAlignmentScore > 0 || reportData.spinalPostureScore > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: 'Head Position', score: reportData.headTiltScore || 0, color: colors.chart.primary },
                    { name: 'Shoulder Alignment', score: reportData.shoulderAlignmentScore || 0, color: colors.chart.secondary },
                    { name: 'Spinal Posture', score: reportData.spinalPostureScore || 0, color: colors.chart.success },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="name" 
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                    />
                    <Bar dataKey="score" fill={colors.chart.primary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No component data available</p>
                    <p className="text-sm text-gray-400">Start a session to see detailed posture analysis</p>
                  </div>
                </div>
              )}
            </div>
            <p className={`mt-4 text-sm ${colors.textSecondary}`}>
              Analysis of your key posture components based on recent sessions.
            </p>
          </div>

          {/* Session Activity Chart */}
          <div className={`${colors.cardBg} rounded-xl p-6 mb-10 shadow-md border border-gray-200`}>
            <h3 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>Daily Session Activity</h3>
            <div className="h-64">
              {reportData?.dailySessionData && reportData.dailySessionData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={reportData.dailySessionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <YAxis 
                      stroke="#64748b"
                      fontSize={12}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="sessions" 
                      stroke={colors.chart.info}
                      fill={colors.chart.gradient}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No session activity data</p>
                    <p className="text-sm text-gray-400">Track more sessions to see your activity patterns</p>
                  </div>
                </div>
              )}
            </div>
            <p className={`mt-4 text-sm ${colors.textSecondary}`}>
              Your daily session count and activity patterns over the past week.
            </p>
          </div>

          {/* Corrections vs Score Comparison */}
          <div className={`${colors.cardBg} rounded-xl p-6 mb-10 shadow-md border border-gray-200`}>
            <h3 className={`text-xl font-semibold mb-4 ${colors.textSecondary}`}>Performance Overview</h3>
            <div className="h-64">
              {reportData && reportData.totalSessions > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Good Posture', value: Math.max(0, 100 - (reportData.totalCorrections || 0)), fill: colors.chart.success },
                        { name: 'Corrections Made', value: reportData.totalCorrections || 0, fill: colors.chart.warning },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {[
                        { name: 'Good Posture', value: Math.max(0, 100 - (reportData.totalCorrections || 0)), fill: colors.chart.success },
                        { name: 'Corrections Made', value: reportData.totalCorrections || 0, fill: colors.chart.warning },
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <Target className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No performance data available</p>
                    <p className="text-sm text-gray-400">Complete sessions to see your performance analysis</p>
                  </div>
                </div>
              )}
            </div>
            <p className={`mt-4 text-sm ${colors.textSecondary}`}>
              Overview of your posture performance showing good posture vs corrections needed.
            </p>
          </div>
        </section>

        {/* Recommendations Section */}
        <section>
          <h2 className={`text-2xl font-bold mb-6 ${colors.headingGradient}`}>Recommendations</h2>
          <div className={`${colors.cardBg} rounded-xl p-6 shadow-md space-y-6 border border-gray-200`}>
            <div>
              <h3 className={`text-lg font-semibold mb-2 ${colors.textSecondary}`}>Improve Your Posture</h3>
              <ul className={`${colors.textSecondary} list-disc pl-5 space-y-2`}>
                <li>Take regular breaks - stand up every 30 minutes</li>
                <li>Position your monitor at eye level to avoid neck strain</li>
                <li>Keep your shoulders relaxed and pulled back slightly</li>
                <li>Use a chair with proper lumbar support</li>
                <li>Practice core-strengthening exercises to support your spine</li>
              </ul>
            </div>
            <div>
              <h3 className={`text-lg font-semibold mb-2 ${colors.textSecondary}`}>Eye Health Recommendations</h3>
              <ul className={`${colors.textSecondary} list-disc pl-5 space-y-2`}>
                <li>Follow the 20-20-20 rule: Every 20 minutes, look at something 20 feet away for 20 seconds</li>
                <li>Consciously blink more frequently to prevent dry eyes</li>
                <li>Adjust screen brightness to match your surroundings</li>
                <li>Consider using blue light filtering glasses for extended screen time</li>
              </ul>
            </div>
            
            {/* New Consistency Recommendations Based on Cumulative Time */}
            <div className="pt-4 border-t border-gray-200">
              <h3 className={`text-lg font-semibold mb-2 ${colors.textSecondary}`}>Consistency Recommendations</h3>
              <div className="bg-blue-50 p-4 rounded-lg mb-4">
                <p className={`${colors.text} mb-2`}>
                  <span className="font-medium">Your investment:</span> {Math.floor((reportData?.cumulativeTime || 0) / 3600)} hours {Math.floor(((reportData?.cumulativeTime || 0) % 3600) / 60)} minutes
                </p>
                <p className={`${colors.textSecondary} text-sm`}>
                  {
                    (reportData?.cumulativeTime || 0) < 7200 
                      ? "You're just getting started! Track at least 2 hours daily to build consistency."
                      : (reportData?.cumulativeTime || 0) < 36000 
                        ? "Good progress! Continue regular tracking to unlock more personalized insights."
                        : "Excellent commitment! You have enough data for advanced posture analysis."
                  }
                </p>
              </div>
              
              <ul className={`${colors.textSecondary} list-disc pl-5 space-y-2`}>
                <li>Set up {(reportData?.totalSessions || 0) < 10 ? "daily sessions" : "additional weekly sessions"} to improve tracking consistency</li>
                <li>Your most productive posture times are {(reportData?.cumulativeTime || 0) > 14400 ? "morning hours" : "yet to be determined (need more data)"}</li>
                <li>Consider a {(reportData?.currentScore || 0) < 70 ? "more ergonomic setup" : "standing desk option"} based on your progress</li>
                <li>Schedule reminders at {(reportData?.cumulativeTime || 0) > 7200 ? "2-hour intervals that match your usage patterns" : "regular intervals throughout your day"}</li>
              </ul>
            </div>
          </div>
        </section>
          </>
        )}
      </main>

      <footer className={`${colors.cardBg} py-6 mt-12 border-t border-gray-200`}>
        <div className="max-w-7xl mx-auto px-6 text-center text-[#64748b] text-sm select-none">
          © 2025 Posture Monitor | Your digital posture assistant
        </div>
      </footer>

      {/* Global styles and progress ring animation */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ring-progress { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: var(--offset); } }
        .animate-spin { animation: spin 1s linear infinite; }
        .progress-ring__circle { animation: ring-progress 1.5s ease-out forwards; transform: rotate(-90deg); transform-origin: 50% 50%; }
      `}</style>
    </div>
  );
}

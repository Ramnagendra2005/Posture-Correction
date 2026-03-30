import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { AlertCircle, ChevronDown, Camera, Check, Info, BarChart2, Clock, RefreshCw, Coffee } from "lucide-react";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { useInView } from "react-intersection-observer";
import useAuth from "../hooks/useAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const Analysis = () => {
  const [feedback, setFeedback] = useState([]);
  const [, setOverview] = useState({
    postureScore: 0,
    timeTracked: "0:00:00",
    corrections: 0,
    breaksTaken: 0,
  });
  const [scores, setScores] = useState({
    headTilt: 0,
    shoulderAlignment: 0,
    spinalPosture: 0,
    hipBalance: 0,
    legPosition: 0,
    overallScore: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showFeedback, setShowFeedback] = useState(true);
  const [cameraError, setCameraError] = useState(false);
  const [, setAnimateScore] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isStoppingAnalysis, setIsStoppingAnalysis] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [correctionsCount, setCorrectionsCount] = useState(0);
  const [lastFeedbackCount, setLastFeedbackCount] = useState(0);
  const [, setPerformanceMetrics] = useState({
    fps: 30,
    latency: 45,
    accuracy: 98.5,
    dataPoints: 0
  });
  // --- Appended: tracked time from DB (via Node) ---
  const [trackedTime, setTrackedTime] = useState({
    todays_time_tracked_seconds: 0,
    current_session_time_seconds: 0,
    synced_at_ms: Date.now(),
  });
  const [clockTick, setClockTick] = useState(Date.now());
  // Frozen display values captured at stop-time to prevent post-stop drift.
  const frozenDisplayRef = useRef(null);
  const videoRef = useRef(null);
  const [videoFeedNonce, setVideoFeedNonce] = useState(Date.now());
  const backendSessionIdRef = useRef(null);
  const latestScoresRef = useRef(scores);
  const latestCorrectionsRef = useRef(correctionsCount);
  const elapsedTimeRef = useRef(0);
  const lastFeedbackCountRef = useRef(0);
  const isSessionActiveRef = useRef(false);
  // Guard: when the user explicitly stops, block auto-reactivation from
  // backend polls until they explicitly click Start again.
  const stoppedByUserRef = useRef(false);
  const controls = useAnimation();
  const { token, user } = useAuth();
  const [ref, inView] = useInView({
    threshold: 0.2,
    triggerOnce: false
  });

  // Updated color palette to match white and blue theme
  const colors = {
    bgGradient: "from-[#ffffff] to-[#f8fafc]",      // white to light blue-gray gradient
    cardBg: "bg-white",                              // white card backgrounds
    headingGradient: "text-[#3b82f6]",              // bright blue for headings
    buttonGradient: "bg-gradient-to-r from-[#3b82f6] to-[#2563eb]", // blue button gradient
    accent: "#3b82f6",                               // bright blue accent
    text: "text-[#1e293b]",                          // dark navy text
    textSecondary: "text-[#64748b]",                 // blue-gray secondary text
    success: "text-green-500",                       // green for success
    warning: "text-[#f59e0b]",                       // amber for warnings
    error: "text-red-500",                           // red for errors
  };

  // Format time in hr:min:sec format
  const formatTime = useCallback((seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const reloadVideoFeed = useCallback(() => {
    setCameraError(false);
    setIsLoading(true);
    setVideoFeedNonce(Date.now());
  }, []);

  const toSeconds = useCallback((value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, []);

  const applyTrackedSnapshot = useCallback(
    (nextTodaySeconds, nextCurrentSeconds, options = {}) => {
      const allowTodayRegression = Boolean(options.allowTodayRegression);
      const allowCurrentRegression = Boolean(options.allowCurrentRegression);
      // Force a synced_at_ms reset (used on start/stop to re-anchor the clock).
      const forceResync = Boolean(options.forceResync);

      setTrackedTime((prev) => {
        const prevToday = toSeconds(prev.todays_time_tracked_seconds);
        const prevCurrent = toSeconds(prev.current_session_time_seconds);
        const incomingToday = toSeconds(nextTodaySeconds);
        const incomingCurrent = toSeconds(nextCurrentSeconds);

        const resolvedToday = allowTodayRegression
          ? incomingToday
          : Math.max(prevToday, incomingToday);
        const resolvedCurrent = allowCurrentRegression
          ? incomingCurrent
          : Math.max(prevCurrent, incomingCurrent);

        // Only reset the sync anchor when the base value actually grew or
        // when explicitly asked (start / stop).  This prevents the
        // "sawtooth" pattern where a stale backend poll resets synced_at_ms
        // back to now, zeroing the tick delta and making the timer jump.
        const baseGrew =
          resolvedToday > prevToday || resolvedCurrent > prevCurrent;
        const newSyncedAt =
          forceResync || baseGrew ? Date.now() : prev.synced_at_ms;

        return {
          todays_time_tracked_seconds: resolvedToday,
          current_session_time_seconds: resolvedCurrent,
          synced_at_ms: newSyncedAt,
        };
      });
    },
    [toSeconds]
  );

  const displayedTrackedTime = useMemo(() => {
    // If the session was stopped, return the frozen snapshot.
    if (!isSessionActive && frozenDisplayRef.current) {
      return frozenDisplayRef.current;
    }

    const baseToday = toSeconds(trackedTime.todays_time_tracked_seconds);
    const baseCurrent = toSeconds(trackedTime.current_session_time_seconds);

    if (!isSessionActive) {
      return {
        todays_time_tracked_seconds: baseToday,
        current_session_time_seconds: baseCurrent,
      };
    }

    const syncedAtMs = Number(trackedTime.synced_at_ms) || Date.now();
    const deltaSeconds = Math.max(
      0,
      Math.floor((clockTick - syncedAtMs) / 1000)
    );

    return {
      todays_time_tracked_seconds: baseToday + deltaSeconds,
      current_session_time_seconds: baseCurrent + deltaSeconds,
    };
  }, [trackedTime, isSessionActive, clockTick, toSeconds]);

  // Function to update backend with real-time data (optimized)
  const updateBackendRealtime = useCallback(async (scores, corrections) => {
    if (!token || !user?.id) return;

    if (!backendSessionIdRef.current) {
      backendSessionIdRef.current = `session_${user.id}_${Date.now()}`;
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/posture/update-realtime`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: user.id,
          session_id: backendSessionIdRef.current,
          scores,
          feedback: corrections,
          timestamp: new Date().toISOString(),
          duration_seconds: elapsedTimeRef.current
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Backend updated successfully:', data);
    } catch (error) {
      console.error("Error updating backend with real-time data:", error);
      // Don't logout on API errors, just log them
    }
  }, [token, user?.id]);

  // Function to fetch feedback directly from Python service (OPTIMIZED)
  const fetchFeedback = useCallback(async () => {
    if (!isSessionActive) return; // Only fetch when session is active
    
    try {
      const response = await fetch("http://localhost:5001/feedback");
      if (response.ok) {
        const data = await response.json();
        
        // Update feedback and detect new corrections
        const newFeedback = data.feedback || [];
        const previousFeedbackCount = lastFeedbackCountRef.current;
        if (newFeedback.length > previousFeedbackCount) {
          // New feedback received, count as correction
          const newCorrections = newFeedback.length - previousFeedbackCount;
          setCorrectionsCount(prev => {
            const next = prev + newCorrections;
            latestCorrectionsRef.current = next;
            return next;
          });
          lastFeedbackCountRef.current = newFeedback.length;
          setLastFeedbackCount(newFeedback.length);
        }
        setFeedback(newFeedback);
        
        if (data.scores) {
          const previousOverallScore = latestScoresRef.current?.overallScore || 0;
          latestScoresRef.current = data.scores;
          setScores(data.scores);
          // Trigger score animation when score changes significantly
          if (Math.abs(data.scores.overallScore - previousOverallScore) > 5) {
            setAnimateScore(true);
            setTimeout(() => setAnimateScore(false), 2000);
          }
          
          // Update overview with dynamic score
          setOverview(prev => ({
            ...prev,
            postureScore: Math.round(data.scores.overallScore),
            corrections: latestCorrectionsRef.current
          }));
        }

        // Update performance metrics dynamically
        setPerformanceMetrics(prev => ({
          fps: 25 + Math.floor(Math.random() * 10), // Simulate FPS between 25-35
          latency: 30 + Math.floor(Math.random() * 30), // Simulate latency between 30-60ms
          accuracy: 95 + Math.random() * 4, // Simulate accuracy between 95-99%
          dataPoints: prev.dataPoints + 1
        }));
        
        setIsLoading(false);
        setCameraError(false); // Clear any previous camera errors
      } else {
        console.error("Failed to fetch feedback:", response.status);
        setIsLoading(false);
      }
    } catch (error) {
      console.error("Error fetching feedback:", error);
      setIsLoading(false);
      setCameraError(true); // Set camera error if service is unreachable
    }
  }, [isSessionActive]);

  // Function to fetch session overview from Node.js backend
  const fetchOverview = useCallback(async () => {
    if (!token) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/posture/today-overview`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const overviewData = data.data || {};

        const overviewTodaySeconds = Number(
          overviewData.todaysTimeTrackedSeconds ?? overviewData.totalTimeTrackedSeconds ?? 0
        );
        const overviewSessionSeconds = Number(
          overviewData.currentSessionTimeSeconds ?? 0
        );
        const backendActive = Boolean(
          overviewData.hasActiveSession || overviewData.isActiveSession
        );

        if (
          Number.isFinite(overviewTodaySeconds) ||
          Number.isFinite(overviewSessionSeconds)
        ) {
          applyTrackedSnapshot(
            Number.isFinite(overviewTodaySeconds) ? overviewTodaySeconds : 0,
            Number.isFinite(overviewSessionSeconds) ? overviewSessionSeconds : 0,
            {
              allowTodayRegression: false,
              allowCurrentRegression: !backendActive,
            }
          );
        }

        if (overviewData.lastReset) {
          const currentDate = new Date().toDateString();
          const lastResetDate = new Date(overviewData.lastReset).toDateString();

          if (currentDate !== lastResetDate) {
            // Reset daily counters
            setCorrectionsCount(0);
            setLastFeedbackCount(0);
            lastFeedbackCountRef.current = 0;
            setSessionStartTime(null);
            setElapsedTime(0);
          }
        }

        setOverview({
          postureScore: overviewData.averageScore || scores.overallScore,
          timeTracked: formatTime(
            Math.round(
              Number(overviewData.todaysTimeTrackedSeconds ?? overviewData.totalTimeTrackedSeconds)
            ) || Math.round((overviewData.totalTimeTracked || 0) * 60)
          ),
          corrections: overviewData.totalCorrections || 0,
          breaksTaken: overviewData.breaksTaken || 0,
          cumulativeTime: overviewData.cumulativeTime || "0:00:00"
        });

        const syncedCorrections = overviewData.totalCorrections || 0;
        setCorrectionsCount(syncedCorrections);
        latestCorrectionsRef.current = syncedCorrections;

        // Only *activate* from backend — never deactivate.
        // Deactivation is exclusively handled by stopAnalysis to prevent
        // transient backend responses from flipping the session off/on and
        // causing timer flicker.
        if (backendActive && !isSessionActiveRef.current && !stoppedByUserRef.current) {
          frozenDisplayRef.current = null; // clear any frozen snapshot
          setIsSessionActive(true);
        }
      }
    } catch (error) {
      console.error("Error fetching overview:", error);
    }
  }, [token, scores.overallScore, formatTime, applyTrackedSnapshot]);

  useEffect(() => {
    latestScoresRef.current = scores;
  }, [scores]);

  useEffect(() => {
    latestCorrectionsRef.current = correctionsCount;
  }, [correctionsCount]);

  useEffect(() => {
    elapsedTimeRef.current = elapsedTime;
  }, [elapsedTime]);

  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
  }, [isSessionActive]);

  useEffect(() => {
    lastFeedbackCountRef.current = lastFeedbackCount;
  }, [lastFeedbackCount]);

  useEffect(() => {
    if (!isSessionActive) return;
    setClockTick(Date.now());
    const timer = setInterval(() => {
      setClockTick(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isSessionActive]);

  // Poll feedback every 2 seconds from Python service (reduced frequency for performance)
  useEffect(() => {
    if (!isSessionActive) return;

    fetchFeedback(); // Initial fetch
    const intervalId = setInterval(fetchFeedback, 2000); // Increased to 2 seconds to reduce lag
    return () => clearInterval(intervalId);
  }, [fetchFeedback, isSessionActive]);

  // Separate effect for backend updates every 30 seconds
  useEffect(() => {
    if (!isSessionActive || !user?.id) return;

    const updateBackend = () => {
      updateBackendRealtime(latestScoresRef.current, latestCorrectionsRef.current);
    };

    updateBackend(); // Initial update
    const intervalId = setInterval(updateBackend, 30000); // Every 30 seconds
    return () => clearInterval(intervalId);
  }, [isSessionActive, user?.id, updateBackendRealtime]);

  // Poll overview every 5 seconds from Node.js backend  
  useEffect(() => {
    if (user && token) {
      fetchOverview();
      const overviewInterval = setInterval(fetchOverview, 5000);
      return () => clearInterval(overviewInterval);
    }
  }, [user, token, fetchOverview]);

  // Keep session metadata in sync with active/inactive transitions.
  useEffect(() => {
    if (isSessionActive && !sessionStartTime) {
      setSessionStartTime(Date.now());
    } else if (!isSessionActive) {
      backendSessionIdRef.current = null;
      setSessionStartTime(null);
    }
  }, [isSessionActive, sessionStartTime]);

  // Drive elapsed timer from the tracked snapshot clock for smooth increments.
  useEffect(() => {
    if (isSessionActive) {
      const currentSeconds = displayedTrackedTime.current_session_time_seconds;
      setElapsedTime(currentSeconds);
      setOverview((prev) => ({
        ...prev,
        timeTracked: formatTime(currentSeconds),
      }));
    } else {
      setElapsedTime(0);
    }
  }, [isSessionActive, displayedTrackedTime.current_session_time_seconds, formatTime]);

  // Start animations when components come into view
  useEffect(() => {
    if (inView) {
      controls.start("visible");
    }
  }, [controls, inView]);

  // Function to determine feedback item color based on content
  const getFeedbackColor = (item) => {
    if (item.toLowerCase().includes("correct") || item.toLowerCase().includes("good")) {
      return colors.success;   // green for success
    } else if (item.toLowerCase().includes("warning") || item.toLowerCase().includes("caution")) {
      return colors.warning;   // amber for warnings
    } else if (item.toLowerCase().includes("error") || item.toLowerCase().includes("incorrect")) {
      return colors.error;     // red for errors
    }
    return colors.accent;      // blue accent for others
  };

  const getFeedbackBgColor = (item) => {
    if (item.toLowerCase().includes("correct") || item.toLowerCase().includes("good")) {
      return "bg-green-50"; // light green background
    } else if (item.toLowerCase().includes("warning") || item.toLowerCase().includes("caution")) {
      return "bg-amber-50"; // light amber background
    } else if (item.toLowerCase().includes("error") || item.toLowerCase().includes("incorrect")) {
      return "bg-red-50"; // light red background
    }
    return "bg-blue-50";  // light blue background
  };

  // Function to stop posture analysis
  const stopAnalysis = async () => {
    if (isStoppingAnalysis) return;
    
    setIsStoppingAnalysis(true);
    try {
      // Capture the displayed values *before* any state changes so the
      // UI freezes on exactly what the user sees right now.
      const finalSessionSeconds =
        displayedTrackedTime.current_session_time_seconds;
      const finalTodaySeconds =
        displayedTrackedTime.todays_time_tracked_seconds;

      // Freeze the display immediately so no further ticks change it.
      frozenDisplayRef.current = {
        todays_time_tracked_seconds: finalTodaySeconds,
        current_session_time_seconds: finalSessionSeconds,
      };

      // Mark inactive *immediately* — stops the clockTick interval.
      setIsSessionActive(false);
      stoppedByUserRef.current = true;

      // Stop the Python posture detection service
      const response = await fetch("http://localhost:5001/stop_analysis", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = await response.json();
        
        // Stop session in backend and save cumulative time
        if (token) {
          const backendResponse = await fetch(`${API_BASE}/api/sessions/stop`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              sessionDuration: finalSessionSeconds,
              finalScores: scores
            })
          });

          // Save complete session data including cumulative time
          if (result.session_summary && backendResponse.ok) {
            await fetch(`${API_BASE}/api/posture/save-session`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                sessionId: result.session_summary.session_id || 'manual-session-' + Date.now(),
                duration: result.session_summary.duration || finalSessionSeconds,
                durationMinutes: result.session_summary.duration_minutes || Math.floor(finalSessionSeconds / 60),
                averageScores: result.session_summary.average_scores || {
                  headTilt: scores.headTilt,
                  shoulderAlignment: scores.shoulderAlignment,
                  spinalPosture: scores.spinalPosture,
                  overallScore: scores.overallScore
                },
                totalFeedbackCount: result.session_summary.total_feedback_count || correctionsCount,
                blinkRate: result.session_summary.blink_rate || 0,
                scoresHistory: [],
                feedbackHistory: feedback,
                // Add cumulative time tracking
                sessionTimeSeconds: finalSessionSeconds,
                updateCumulativeTime: true
              })
            });
          }
        }

        // Fire one final realtime update so the backend persists the
        // exact final session duration into TrackedTime via $max.
        // This must happen before clearing backendSessionIdRef.
        elapsedTimeRef.current = finalSessionSeconds;
        await updateBackendRealtime(latestScoresRef.current, latestCorrectionsRef.current);

        // Persist the frozen values into trackedTime state so future
        // backend polls see them as the minimum.
        backendSessionIdRef.current = null;
        setSessionStartTime(null);
        setElapsedTime(finalSessionSeconds);
        applyTrackedSnapshot(
          finalTodaySeconds,
          finalSessionSeconds,
          { allowTodayRegression: false, allowCurrentRegression: true, forceResync: true }
        );
        
        // Keep final overview data
        setOverview(prev => ({
          ...prev,
          timeTracked: formatTime(finalSessionSeconds),
          corrections: correctionsCount
        }));

        alert("Analysis stopped and session data saved!");
      } else {
        // Revert – the stop call failed, re-activate.
        frozenDisplayRef.current = null;
        stoppedByUserRef.current = false;
        setIsSessionActive(true);
        alert("Failed to stop analysis. Please try again.");
      }
    } catch (error) {
      console.error("Error stopping analysis:", error);
      frozenDisplayRef.current = null;
      stoppedByUserRef.current = false;
      setIsSessionActive(true);
      alert("Error stopping analysis. Please check your connection.");
    } finally {
      setIsStoppingAnalysis(false);
    }
  };

  // Function to start posture analysis
  const startAnalysis = async () => {
    try {
      // Start session in backend first
      if (token) {
  const backendResponse = await fetch(`${API_BASE}/api/sessions/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            cameraResolution: '1280x720',
            userAgent: navigator.userAgent,
            platform: navigator.platform
          })
        });

        if (!backendResponse.ok) {
          console.error("Failed to start backend session");
        }
      }

      // Start Python analysis service
      const response = await fetch("http://localhost:5001/start_analysis", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        backendSessionIdRef.current = `session_${user?.id || 'user'}_${Date.now()}`;
        frozenDisplayRef.current = null; // clear any prior frozen snapshot
        stoppedByUserRef.current = false; // allow backend polls to manage state again
        setIsSessionActive(true);
        setSessionStartTime(Date.now());
        applyTrackedSnapshot(trackedTime.todays_time_tracked_seconds, 0, {
          allowTodayRegression: false,
          allowCurrentRegression: true,
          forceResync: true,
        });
        setCorrectionsCount(0);
        setLastFeedbackCount(0);
        reloadVideoFeed();
        setOverview(prev => ({
          ...prev,
          postureScore: 100,
          timeTracked: "0:00:00",
          corrections: 0
        }));
        alert("Posture analysis started! Make sure your camera is properly positioned.");
      } else {
        alert("Failed to start analysis. Please check your camera and try again.");
      }
    } catch (error) {
      console.error("Error starting analysis:", error);
      alert("Error starting analysis. Please check your connection.");
    }
  };

  // Function to check camera status and session state
  const checkCameraStatus = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:5001/camera_status");
      if (response.ok) {
        const data = await response.json();
        if (data.camera_active && !stoppedByUserRef.current) {
          setIsSessionActive(true);
        }
        
        // Don't override sessionStartTime if already set - let the timer useEffect handle it
        // Only update elapsed time if we get duration from backend
        if (data.camera_active && !stoppedByUserRef.current && data.session_duration) {
          const seconds = Math.floor(data.session_duration);
          setSessionStartTime((prev) => prev || Date.now() - seconds * 1000);
          applyTrackedSnapshot(
            trackedTime.todays_time_tracked_seconds,
            seconds,
            { allowTodayRegression: false, allowCurrentRegression: false }
          );
        }
      }
    } catch (error) {
      console.error("Error checking camera status:", error);
    }
  }, [applyTrackedSnapshot, trackedTime.todays_time_tracked_seconds]);

  // Check camera status periodically
  useEffect(() => {
    if (user && token && !isSessionActive) {
      checkCameraStatus();
      const statusInterval = setInterval(checkCameraStatus, 5000);
      return () => clearInterval(statusInterval);
    }
  }, [user, token, checkCameraStatus, isSessionActive]);

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
  };

  const floatingAnimation = {
    initial: { y: 0 },
    animate: { 
      y: [-5, 5, -5],
      transition: {
        duration: 3,
        repeat: Infinity,
        repeatType: "loop",
        ease: "easeInOut"
      }
    }
  };

  const pulseAnimation = {
    initial: { scale: 1 },
    animate: { 
      scale: [1, 1.05, 1],
      transition: {
        duration: 2,
        repeat: Infinity,
        repeatType: "loop"
      }
    }
  };

  return (
    <div className="w-full overflow-x-hidden scroll-smooth">
      <div className={`min-h-screen bg-gradient-to-br ${colors.bgGradient} pt-24 pb-12`}>
        <div className="container mx-auto px-6">
          {/* Page Title with Animation */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h1 className={`text-3xl md:text-4xl font-bold ${colors.text} mb-2`}>
              Posture Analysis
            </h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 1 }}
              className={`text-xl bg-clip-text text-transparent bg-gradient-to-r from-[${colors.accent}] to-[#2563eb]`}
            >
              Real-time feedback to improve your sitting habits
            </motion.p>
          </motion.div>

          <div className="flex flex-col md:flex-row gap-8">
            {/* Camera Feed Section */}
            <motion.div 
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              className="flex-1"
            >
              <div className={`${colors.cardBg} rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 border border-gray-200`}>
                <div className="bg-gradient-to-r from-[#3b82f6] to-[#2563eb] p-4 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Camera className="h-5 w-5 text-white" />
                    <h2 className="text-white font-medium">Camera Feed</h2>
                   </div>
                   <motion.div 
                     {...pulseAnimation}
                     className="flex items-center"
                   >
                     <div className="h-2 w-2 rounded-full bg-green-400 mr-2"></div>
                     <span className="text-blue-100 text-sm">Live</span>
                   </motion.div>
                </div>
                <div className="relative aspect-video bg-blue-50 flex items-center justify-center overflow-hidden rounded-b-xl">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="w-full h-full relative"
                  >
                    <img 
                      ref={videoRef}
                      src={`http://localhost:5001/video_feed?t=${videoFeedNonce}`}
                      alt="Camera feed" 
                      className="w-full h-full object-contain"
                      onLoad={() => {
                        setCameraError(false);
                        setIsLoading(false);
                      }}
                      onError={() => {
                        setCameraError(true);
                        setIsLoading(false);
                      }}
                    />
                    {/* Position visualization overlay */}
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.5 }}
                      transition={{ delay: 1.2, duration: 0.8 }}
                      className="absolute top-0 left-0 w-full h-full pointer-events-none"
                    >
                      {!cameraError && !isLoading && (
                        <svg className="w-full h-full" viewBox="0 0 1000 800" xmlns="http://www.w3.org/2000/svg">
                          {/* Center vertical line for alignment */}
                          <motion.line 
                            x1="500" y1="0" x2="500" y2="800" 
                            stroke={colors.accent} strokeWidth="1" strokeDasharray="5,5"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 1.5, delay: 0.5 }}
                          />
                          
                          {/* Shoulder level guide */}
                          <motion.line 
                            x1="300" y1="200" x2="700" y2="200" 
                            stroke={colors.accent} strokeWidth="1" strokeDasharray="5,5"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 1, delay: 0.8 }}
                          />
                          
                          {/* Animated target area for head */}
                          <motion.circle 
                            cx="500" cy="100" r="80" 
                            fill="none" stroke={colors.accent} strokeWidth="2" strokeDasharray="5,5"
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 0.5 }}
                            transition={{ duration: 1, delay: 1 }}
                          />
                        </svg>
                      )}
                    </motion.div>
                  </motion.div>
                  
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-60 backdrop-blur-sm rounded-b-xl">
                      <motion.div
                        animate={{ 
                          rotate: 360,
                          borderRadius: ["20%", "20%", "50%", "50%", "20%"]
                        }}
                        transition={{ 
                          rotate: { duration: 1.5, repeat: Infinity, ease: "linear" },
                          borderRadius: { duration: 3, repeat: Infinity }
                        }}
                        className={`w-16 h-16 border-4 border-[${colors.accent}] border-t-transparent rounded-full`}
                      />
                    </div>
                  )}
                  
                  {cameraError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white bg-opacity-80 backdrop-blur-sm rounded-b-xl">
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.5 }}
                      >
                        <Camera className={`h-16 w-16 text-[${colors.accent}] mb-4`} />
                      </motion.div>
                      <motion.p 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3, duration: 0.5 }}
                        className={`text-[#3b82f6] text-xl font-medium mb-2`}
                      >
                        Camera feed unavailable
                      </motion.p>
                      <motion.p 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5, duration: 0.5 }}
                        className={`${colors.textSecondary} text-sm text-center max-w-xs`}
                      >
                        Please ensure the Python posture detector service is running at http://localhost:5001
                      </motion.p>
                      <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={reloadVideoFeed}
                        transition={{ delay: 0.7, duration: 0.5 }}
                        className={`mt-6 bg-[${colors.accent}] text-white px-6 py-2 rounded-lg font-medium flex items-center hover:bg-[#2563eb]`}
                      >
                        <RefreshCw size={16} className="mr-2" /> Try Again
                      </motion.button>
                    </div>
                  )}
                </div>
                <div className={`${colors.cardBg} p-4 border-t border-gray-200`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <motion.div 
                        animate={{
                          scale: [1, 1.2, 1],
                          backgroundColor: isSessionActive ? ["#10b981", colors.accent, "#10b981"] : ["#ef4444", "#dc2626", "#ef4444"]
                        }}
                        transition={{ 
                          duration: 2,
                          repeat: Infinity,
                          repeatType: "reverse" 
                        }}
                        className={`w-3 h-3 rounded-full ${isSessionActive ? 'bg-green-500' : 'bg-red-500'}`}
                      ></motion.div>
                      <span className={`${colors.textSecondary} text-sm`}>
                        {isSessionActive ? 'Analysis active' : 'Analysis stopped'}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {!isSessionActive ? (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={startAnalysis}
                          className="text-xs bg-green-500 hover:bg-green-600 text-white font-medium px-3 py-1 rounded-full transition-colors duration-200 flex items-center space-x-1"
                        >
                          <span>▶</span>
                          <span>Start Analysis</span>
                        </motion.button>
                      ) : (
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={stopAnalysis}
                          disabled={isStoppingAnalysis}
                          className={`text-xs ${isStoppingAnalysis ? 'bg-gray-400' : 'bg-red-500 hover:bg-red-600'} text-white font-medium px-3 py-1 rounded-full transition-colors duration-200 flex items-center space-x-1`}
                        >
                          {isStoppingAnalysis ? (
                            <>
                              <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                className="w-3 h-3 border border-white border-t-transparent rounded-full"
                              />
                              <span>Stopping...</span>
                            </>
                          ) : (
                            <>
                              <span>●</span>
                              <span>Stop Analysis</span>
                            </>
                          )}
                        </motion.button>
                      )}
                      <motion.span 
                        whileHover={{ scale: 1.05 }}
                        className={`text-xs text-[${colors.accent}] font-medium px-2 py-1 bg-blue-50 rounded-full`}
                      >
                        Auto-refresh enabled
                      </motion.span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Split layout: Left = Camera Feed, Right = Live Feedback */}
            <div className="flex flex-col md:flex-row gap-8">
              {/* Left: Camera Feed (50%) */}
              <div className="flex-1 min-w-0">
                {/* ...existing camera feed code... */}
              </div>
              {/* Right: Live Feedback (50%) */}
              <div className="flex-1 min-w-0">
                {/* ...existing feedback section code... */}
              </div>
            </div>

            {/* Right Side Panel */}
            <motion.div 
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="w-full md:w-96 flex flex-col gap-6"
              ref={ref}
            >
              {/* Feedback Section */}
              <motion.div 
                variants={containerVariants}
                initial="hidden"
                animate={controls}
                className={`${colors.cardBg} rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 border border-gray-200`}
              >
                <div 
                  className="bg-gradient-to-r from-[#3b82f6] to-[#2563eb] p-4 flex items-center justify-between cursor-pointer"
                  onClick={() => setShowFeedback(!showFeedback)}
                >
                  <div className="flex items-center">
                    <AlertCircle className="h-5 w-5 mr-3 text-white" />
                    <h2 className="text-white font-medium">Posture Feedback</h2>
                  </div>
                  <motion.div
                    animate={{ rotate: showFeedback ? 180 : 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <ChevronDown className="h-5 w-5 text-white" />
                  </motion.div>
                </div>
                
                <AnimatePresence>
                  {showFeedback && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      {feedback.length === 0 ? (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.2, duration: 0.5 }}
                          className={`${colors.cardBg} flex items-center justify-center py-16 text-center`}
                        >
                          <div className="flex flex-col items-center">
                            <motion.div
                              {...floatingAnimation}
                              className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-4"
                            >
                              <Camera className={`h-10 w-10 text-[${colors.accent}]`} />
                            </motion.div>
                            <p className={`${colors.text} font-medium mb-2`}>
                              No feedback available at the moment
                            </p>
                            <p className={`${colors.textSecondary} text-sm max-w-xs`}>
                              Please ensure you're in frame and your posture is visible
                            </p>
                          </div>
                        </motion.div>
                      ) : (
                        <div className="p-4 max-h-96 overflow-y-auto">
                          <ul className="space-y-3">
                            {feedback.map((item, index) => (
                              <motion.li
                                key={index}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5, delay: index * 0.1 }}
                                className={`flex items-start p-3 rounded-lg ${getFeedbackBgColor(item)} border border-opacity-20 ${item.toLowerCase().includes("correct") ? "border-green-200" : item.toLowerCase().includes("warning") ? "border-amber-200" : "border-red-200"}`}
                              >
                                <div className="mr-3 mt-0.5">
                                  {item.toLowerCase().includes("correct") || item.toLowerCase().includes("good") ? (
                                    <Check size={18} className={colors.success} />
                                  ) : (
                                    <Info size={18} className={getFeedbackColor(item)} />
                                  )}
                                </div>
                                <span className={`${colors.text}`}>{item}</span>
                              </motion.li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className={`${colors.cardBg} p-3 border-t border-gray-200 flex justify-between items-center`}>
                        <span className={`${colors.textSecondary} text-xs`}>
                          Last updated: {new Date().toLocaleTimeString()}
                        </span>
                        <motion.span 
                          animate={{ 
                            scale: feedback.length > 0 ? [1, 1.1, 1] : 1
                          }}
                          transition={{ 
                            duration: 0.5, 
                            repeat: feedback.length > 0 ? 1 : 0
                          }}
                          className={`text-xs font-medium px-2 py-1 rounded-full bg-blue-50 text-[${colors.accent}]`}
                        >
                          {feedback.length} items
                        </motion.span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
              
            {/* Today's Overview Section (connected to Flask backend) */}
            <motion.div 
              variants={containerVariants}
              initial="hidden"
              animate={controls}
              className={`${colors.cardBg} rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 overflow-hidden border border-gray-200 mt-8`}
            >
              <div className="bg-gradient-to-r from-[#3b82f6] to-[#2563eb] p-4 flex items-center justify-between">
                <div className="flex items-center">
                  <BarChart2 className="h-5 w-5 mr-3 text-white" />
                  <h3 className="text-white font-medium">Today's Overview</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <motion.div
                    animate={isSessionActive ? {
                      scale: [1, 1.2, 1],
                      opacity: [0.7, 1, 0.7]
                    } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className={`w-3 h-3 rounded-full ${isSessionActive ? 'bg-green-400' : 'bg-gray-300'}`}
                  />
                  <span className="text-white text-xs font-medium">
                    {isSessionActive ? 'LIVE' : 'OFFLINE'}
                  </span>
                </div>
              </div>
              {/* Fetch overview from Flask backend */}
              <div className="p-4 grid grid-cols-2 gap-4">
                {/* Example: fetch from Flask backend */}
                {/* Replace fetchOverview with Flask endpoint */}
                {/* ...existing overview UI code... */}
                {/* --- Appended: Tracked time from DB display --- */}
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className={`${colors.textSecondary} text-xs mb-1 flex items-center`}>
                    <Clock className={`h-3 w-3 mr-1 text-[${colors.accent}]`} /> Today's Time Tracked (DB)
                  </p>
                  <p className={`text-[${colors.accent}] text-xl font-bold`}>{formatTime(Math.floor(displayedTrackedTime.todays_time_tracked_seconds))}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-lg">
                  <p className={`${colors.textSecondary} text-xs mb-1 flex items-center`}>
                    <Clock className={`h-3 w-3 mr-1 text-[${colors.accent}]`} /> Current Session (DB)
                  </p>
                  <p className={`text-[${colors.accent}] text-xl font-bold`}>{formatTime(Math.floor(displayedTrackedTime.current_session_time_seconds))}</p>
                </div>
              </div>
            </motion.div>
              
            {/* Quick Tips Section (below overview) */}
            <motion.div 
              variants={containerVariants}
              initial="hidden"
              animate={controls}
              whileHover={{ y: -5 }}
              transition={{ duration: 0.3 }}
              className={`${colors.cardBg} rounded-xl shadow-lg overflow-hidden border border-gray-200 mt-8`}
            >
              <div className="bg-gradient-to-r from-[#2563eb] to-[#1d4ed8] p-4 flex items-center">
                <Info className="h-5 w-5 mr-3 text-white" />
                <h3 className="text-white font-medium">Posture Quick Tips</h3>
              </div>
              <div className="p-5">
                <ul className={`${colors.text} space-y-3`}>
                  {[
                    { tip: "Keep your head aligned with your spine", icon: "🧠" },
                    { tip: "Relax your shoulders and avoid hunching", icon: "💪" },
                    { tip: "Keep your screen at eye level", icon: "👁️" },
                    { tip: "Take breaks every 30 minutes", icon: "⏰" },
                    { tip: "Maintain 90° angle at your elbows", icon: "💻" }
                  ].map((item, i) => (
                      <motion.li 
                        key={i}
                        variants={itemVariants}
                        className={`flex items-center bg-blue-50 p-2 px-3 rounded-lg`}
                        whileHover={{ x: 5 }}
                      >
                        <motion.span 
                          className="mr-3 text-lg"
                          animate={{ rotate: [-5, 5, -5] }}
                          transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
                        >
                          {item.icon}
                        </motion.span>
                        {item.tip}
                      </motion.li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            </motion.div>
          </div>
          
          {/* Bottom Call to Action */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            viewport={{ once: true }}
            className="mt-12 text-center"
          >
            <motion.button
              whileHover={{ scale: 1.05, boxShadow: `0 10px 25px -5px rgba(59,130,246,0.5)` }}
              whileTap={{ scale: 0.95 }}
              className="bg-gradient-to-r from-[#3b82f6] to-[#2563eb] text-white px-8 py-4 rounded-lg font-bold text-lg shadow-lg inline-flex items-center"
            >
              View Detailed Report
              <motion.span
                animate={{ x: [0, 5, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, repeatType: "loop" }}
                className="ml-2"
              >
                →
              </motion.span>
            </motion.button>
            <motion.p 
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              viewport={{ once: true }}
              className={`${colors.textSecondary} mt-4`}
            >
              Get a comprehensive analysis of your posture habits and personalized recommendations
            </motion.p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Analysis;

import React, { useState, useEffect } from "react";
import "./ExercisePanel.css";

const API_BASE = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:3001"}/api`;

const BODY_AREA_EMOJIS = {
  neck: "🦒",
  shoulders: "💪",
  back: "🔙",
  eyes: "👁️",
  full_body: "🏃",
};

const DIFFICULTY_COLORS = {
  light: "#22c55e",
  moderate: "#f59e0b",
  intense: "#ef4444",
};

export default function ExercisePanel() {
  const [exercises, setExercises] = useState([]);
  const [detectedFlaws, setDetectedFlaws] = useState([]);
  const [severity, setSeverity] = useState("mild");
  const [safeMode, setSafeMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/exercises/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      if (json.success) {
        setExercises(json.data.exercises || []);
        setDetectedFlaws(json.data.detectedFlaws || []);
        setSeverity(json.data.severity || "mild");
        setSafeMode(json.data.safeMode || false);
      }
    } catch (err) {
      console.error("Error fetching exercises:", err);
    } finally {
      setLoading(false);
    }
  };

  const completeExercise = async (exercise) => {
    try {
      const token = localStorage.getItem("token");
      await fetch(`${API_BASE}/exercises/complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          exerciseName: exercise.name,
          flawType: exercise.flawType,
        }),
      });
      setCompletedIds((prev) => new Set([...prev, exercise.name]));
    } catch (err) {
      console.error("Error completing exercise:", err);
    }
  };

  const getFlawLabel = (flaw) => {
    const labels = {
      head_tilt: "Neck Tilt",
      shoulder_misalignment: "Shoulder Misalignment",
      forward_lean: "Forward Lean",
      too_close: "Too Close to Screen",
      general: "General Wellness",
    };
    return labels[flaw] || flaw;
  };

  if (loading) {
    return (
      <div className="exercise-panel exercise-panel--loading">
        <div className="exercise-panel__spinner" />
        <span>Analyzing your posture data...</span>
      </div>
    );
  }

  return (
    <div className="exercise-panel">
      <div
        className="exercise-panel__header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="exercise-panel__title">
          <span className="exercise-panel__icon">🧘</span>
          <h3>Exercise Recommendations</h3>
          {safeMode && <span className="exercise-panel__safe-badge">Safe Mode</span>}
        </div>
        <div className="exercise-panel__meta">
          {detectedFlaws.length > 0 && (
            <span className="exercise-panel__severity" data-severity={severity}>
              {severity} severity
            </span>
          )}
          <span className="exercise-panel__toggle">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="exercise-panel__body">
          {detectedFlaws.length > 0 && (
            <div className="exercise-panel__flaws">
              <span className="exercise-panel__flaws-label">Detected:</span>
              {detectedFlaws.map((flaw) => (
                <span key={flaw} className="exercise-panel__flaw-chip">
                  {getFlawLabel(flaw)}
                </span>
              ))}
            </div>
          )}

          <div className="exercise-panel__grid">
            {exercises.map((exercise) => {
              const isCompleted = completedIds.has(exercise.name);
              return (
                <div
                  key={`${exercise.flawType}-${exercise.name}`}
                  className={`exercise-card ${isCompleted ? "exercise-card--completed" : ""}`}
                >
                  <div className="exercise-card__header">
                    <span className="exercise-card__emoji">
                      {BODY_AREA_EMOJIS[exercise.bodyArea] || "🏋️"}
                    </span>
                    <div className="exercise-card__info">
                      <h4 className="exercise-card__name">{exercise.name}</h4>
                      <div className="exercise-card__tags">
                        <span
                          className="exercise-card__difficulty"
                          style={{ color: DIFFICULTY_COLORS[exercise.difficulty] }}
                        >
                          {exercise.difficulty}
                        </span>
                        <span className="exercise-card__duration">
                          {exercise.durationMinutes} min
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="exercise-card__desc">{exercise.description}</p>
                  <button
                    className="exercise-card__btn"
                    onClick={() => completeExercise(exercise)}
                    disabled={isCompleted}
                  >
                    {isCompleted ? "✓ Done" : "Mark Complete"}
                  </button>
                </div>
              );
            })}
          </div>

          {exercises.length === 0 && (
            <div className="exercise-panel__empty">
              <span>🎉</span>
              <p>Great posture! No exercises needed right now.</p>
            </div>
          )}

          <button className="exercise-panel__refresh" onClick={fetchRecommendations}>
            ↻ Refresh Recommendations
          </button>
        </div>
      )}
    </div>
  );
}

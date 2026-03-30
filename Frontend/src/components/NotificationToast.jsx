import React from "react";
import "./NotificationToast.css";

/**
 * NotificationToast Component
 * 
 * Renders a stack of toast notifications with smooth animations.
 * 
 * Props:
 *   notifications: Array of { id, type, title, message, timestamp }
 *   onDismiss: (id) => void
 */

const ICONS = {
  warning: "⚠️",
  info: "ℹ️",
  success: "✅",
  error: "❌",
};

export default function NotificationToast({ notifications = [], onDismiss }) {
  if (notifications.length === 0) return null;

  return (
    <div className="notification-toast-container">
      {notifications.map((notif) => (
        <div
          key={notif.id}
          className={`notification-toast notification-toast--${notif.type || "info"}`}
          role="alert"
          aria-live="polite"
        >
          <div className="notification-toast__icon">
            {ICONS[notif.type] || ICONS.info}
          </div>
          <div className="notification-toast__content">
            <div className="notification-toast__title">{notif.title}</div>
            <div className="notification-toast__message">{notif.message}</div>
          </div>
          <button
            className="notification-toast__close"
            onClick={() => onDismiss?.(notif.id)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
          <div className="notification-toast__progress" />
        </div>
      ))}
    </div>
  );
}

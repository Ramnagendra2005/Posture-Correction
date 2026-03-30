// src/AuthContext.js
import React, { createContext, useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      // Safely get token from localStorage
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      
      if (storedToken) {
        try {
          const res = await fetch(`${API_BASE}/api/auth/verify`, {
            headers: {
              'Authorization': `Bearer ${storedToken}`
            }
          });
          if (res.ok) {
            const userData = await res.json();
            setUser(userData.user);
            setToken(storedToken);
          } else if (res.status === 401 || res.status === 403) {
            // Only clear token for auth failures
            if (typeof window !== 'undefined') {
              localStorage.removeItem('token');
            }
            setToken(null);
          } else {
            // For transient errors (e.g., 429, 5xx), keep the token and try later
            console.warn(`Token verify transient failure: ${res.status}`);
            setToken(storedToken);
          }
        } catch (err) {
          console.error("Error verifying token (transient):", err);
          // Do not remove token on network/transient errors
          setToken(storedToken);
        }
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (credential, password) => {
    try {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ credential, password })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', data.data.token);
        }
        setToken(data.data.token);
        setUser(data.data.user);
        return { success: true };
      } else {
        const error = await res.json();
        let errorMsg = error.message;
        if (error.errors && Array.isArray(error.errors)) {
          errorMsg += ': ' + error.errors.map(e => e.msg).join(', ');
        }
        return { success: false, error: errorMsg };
      }
    } catch {
      return { success: false, error: "Network error" };
    }
  };

  const signup = async (username, email, password, name) => {
    // Split name into firstName and lastName
    let firstName = "";
    let lastName = "";
    if (name && name.trim()) {
      const parts = name.trim().split(" ");
      firstName = parts[0];
      lastName = parts.length > 1 ? parts.slice(1).join(" ") : "-";
    }
    try {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, email, password, firstName, lastName })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (typeof window !== 'undefined') {
          localStorage.setItem('token', data.data.token);
        }
        setToken(data.data.token);
        setUser(data.data.user);
        return { success: true };
      } else {
        const error = await res.json();
        let errorMsg = error.message;
        if (error.errors && Array.isArray(error.errors)) {
          errorMsg += ': ' + error.errors.map(e => e.msg).join(', ');
        }
        return { success: false, error: errorMsg };
      }
    } catch {
      return { success: false, error: "Network error" };
    }
  };

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      token, 
      login, 
      signup, 
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook for easy access to the AuthContext
export default AuthContext;

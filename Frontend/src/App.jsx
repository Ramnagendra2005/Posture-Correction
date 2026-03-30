import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from "react-router-dom";
import useAuth from "./hooks/useAuth"; // Custom hook for authentication
import Navbar from "./components/Navbar";
import Home from "./components/Home";
import Analysis from "./components/Analysis";
import Report from "./components/Report";
import ChatBot from "./components/Chatbot";
import SignInButton from "./components/SignInButton";
import SignIn from "./components/SignIn";
import PostureDashboard from "./components/PostureDashboard";
import Dashboard from "./components/Dashboard";
import ErrorBoundary from "./components/ErrorBoundary";

// ProtectedRoute wraps each route to check if the user is logged in.
// It uses the useAuth hook to grab the user and loading states, and redirects to signin if user is not authenticated.
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '18px'
      }}>
        Loading...
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/signin" replace />;
  }
  
  return children;
};


// PublicRoute for signin page - redirects to home if user is already authenticated
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        fontSize: '18px'
      }}>
        Loading...
      </div>
    );
  }
  
  if (user) {
    return <Navigate to="/" replace />;
  }
  
  return children;
};

function App() {
  return (
    <Router>
      <AppRoutesWithNavbar />
    </Router>
  );
}

function AppRoutesWithNavbar() {
  const location = useLocation();
  const { user } = useAuth();
  const showNavbar = location.pathname !== "/signin";
  return (
    <>
      {showNavbar && (
        <ProtectedRoute>
          <Navbar />
        </ProtectedRoute>
      )}
      <Routes>
        <Route path="/signin" element={
          <PublicRoute>
            <SignIn />
          </PublicRoute>
        } />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analysis"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <Analysis />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route
          path="/report"
          element={
            <ProtectedRoute>
              <Report />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <PostureDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/live"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
      {user && <ChatBot />}
    </>
  );
}

export default App;


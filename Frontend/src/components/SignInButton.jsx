import React from "react";
import useAuth from "../hooks/useAuth";

const SignInButton = () => {
  const { login } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        {/* Left side with illustration and branding */}
        <motion.div 
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
          className="w-full md:w-1/2 bg-indigo-600 p-8 flex flex-col justify-center items-center text-white"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.8 }}
            className="mb-8"
          >
            <PostureIllustration />
          </motion.div>
          
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
            className="text-3xl md:text-4xl font-bold mb-4 text-center"
          >
            Smart Posture
          </motion.h1>
          
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.8 }}
            className="text-lg italic text-center text-indigo-100"
          >
            "Good posture is a reflection of good health. Stand tall, sit right."
          </motion.p>
          
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 1, duration: 0.8, type: "spring" }}
            className="mt-6 text-center"
          >
            <p className="text-sm md:text-base">Real-time posture analysis to improve your well-being</p>
          </motion.div>
        </motion.div>
        
        {/* Right side with sign in button */}
        <motion.div 
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
          className="w-full md:w-1/2 p-8"
        >
          <div className="h-full flex flex-col justify-center">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.8 }}
              className="mb-6"
            >
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome Back</h2>
              <p className="text-gray-600">Sign in to track your posture progress</p>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.8 }}
              className="w-full"
            >
              {/* Google Sign In Button */}
              <motion.button
                onClick={login}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                transition={{ delay: 1.4, duration: 0.6 }}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-700 font-medium border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 mb-4"
              >
                <GoogleIcon />
                <span>Sign in with Google</span>
              </motion.button>
            </motion.div>
          </div>
        </motion.div>
      </div>
      
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.8 }}
        className="mt-8 text-sm text-gray-600"
      >
        © 2025 Smart Posture. All rights reserved.
      </motion.p>
    </div>
  );
};

// Google icon component
const GoogleIcon = () => (
  <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
    <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
    <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
    <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
  </svg>
);

// Custom SVG illustration of proper sitting posture
const PostureIllustration = () => {
  return (
    <svg width="280" height="240" viewBox="0 0 280 240" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Desk */}
      <motion.rect
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        x="40" y="140" width="200" height="10" fill="#e0e7ff"
      />
      <motion.rect
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.5 }}
        x="50" y="150" width="180" height="60" fill="#c7d2fe"
      />
      
      {/* Computer */}
      <motion.rect
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.7 }}
        x="110" y="100" width="60" height="40" rx="2" fill="#a5b4fc"
      />
      <motion.rect
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.7 }}
        x="130" y="140" width="20" height="5" fill="#818cf8"
      />
      
      {/* Chair */}
      <motion.rect
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.7 }}
        x="110" y="170" width="60" height="10" rx="2" fill="#6366f1"
      />
      <motion.rect
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.7 }}
        x="130" y="180" width="20" height="40" fill="#4f46e5"
      />
      
      {/* Person silhouette (with proper posture) */}
      {/* Head */}
      <motion.circle
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.7, type: "spring" }}
        cx="140" cy="80" r="15" fill="#eef2ff"
      />
      
      {/* Body with proper spine alignment */}
      <motion.path
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{ opacity: 1, pathLength: 1 }}
        transition={{ delay: 0.9, duration: 1.5 }}
        d="M140 95 L140 130 L140 160" 
        stroke="#eef2ff" 
        strokeWidth="6" 
        strokeLinecap="round"
      />
      
      {/* Arms */}
      <motion.path
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{ opacity: 1, pathLength: 1 }}
        transition={{ delay: 1.1, duration: 1 }}
        d="M140 110 L110 130 M140 110 L170 130" 
        stroke="#eef2ff" 
        strokeWidth="4" 
        strokeLinecap="round"
      />
      
      {/* Legs */}
      <motion.path
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{ opacity: 1, pathLength: 1 }}
        transition={{ delay: 1.3, duration: 1 }}
        d="M140 160 L120 200 M140 160 L160 200" 
        stroke="#eef2ff" 
        strokeWidth="4" 
        strokeLinecap="round"
      />
      
      {/* Posture guidelines - subtle alignment indicators */}
      <motion.path
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ delay: 1.5, duration: 0.7 }}
        d="M140 50 L140 220" 
        stroke="#a5b4fc" 
        strokeWidth="1" 
        strokeDasharray="4 4"
      />
      
      {/* Motion lines to indicate real-time analysis */}
      <motion.path
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{ opacity: 0.7, pathLength: 1 }}
        transition={{ delay: 1.7, duration: 0.7, repeat: Infinity, repeatType: "reverse", repeatDelay: 2 }}
        d="M95 80 L115 80 M165 80 L185 80" 
        stroke="#a5b4fc" 
        strokeWidth="2" 
        strokeLinecap="round"
      />
      <motion.path
        initial={{ opacity: 0, pathLength: 0 }}
        animate={{ opacity: 0.7, pathLength: 1 }}
        transition={{ delay: 1.9, duration: 0.7, repeat: Infinity, repeatType: "reverse", repeatDelay: 2 }}
        d="M100 130 L120 120 M160 120 L180 130" 
        stroke="#a5b4fc" 
        strokeWidth="2" 
        strokeLinecap="round"
      />
    </svg>
  );
};

export default SignInButton;
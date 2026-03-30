import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import Lottie from "lottie-react";
import postureAnim from "../assets/posture-3d.json";

const palette = {
  bg: "#f6f7fb",
  card: "#fff",
  accent: "#4285f4",
  accentDark: "#1a73e8",
  error: "#ef4444",
  text: "#22223b",
  border: "#e0e7ef",
  inputBg: "#f1f5fa",
};

// Animated Background Component
const AnimatedBackground = () => (
  <div className="absolute inset-0 overflow-hidden">
    {/* Solid Background */}
    <motion.div
      className="absolute inset-0 bg-blue-50"
      animate={{
        backgroundColor: [
          "#f0f9ff",
          "#eff6ff", 
          "#f0f9ff"
        ]
      }}
      transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
    />
    
    {/* Floating Particles */}
    {[...Array(20)].map((_, i) => (
      <motion.div
        key={i}
        className="absolute w-2 h-2 bg-blue-400 rounded-full opacity-20"
        initial={{
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
        }}
        animate={{
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          scale: [1, 1.5, 1],
          opacity: [0.2, 0.8, 0.2]
        }}
        transition={{
          duration: Math.random() * 10 + 10,
          repeat: Infinity,
          ease: "easeInOut",
          delay: Math.random() * 5
        }}
      />
    ))}
    
    {/* Geometric Shapes */}
    <motion.div
      className="absolute top-1/4 left-1/4 w-20 h-20 bg-blue-300 rounded-full opacity-10"
      animate={{
        scale: [1, 1.2, 1],
        rotate: [0, 180, 360],
        x: [0, 50, 0],
        y: [0, -30, 0]
      }}
      transition={{
        duration: 12,
        repeat: Infinity,
        ease: "easeInOut"
      }}
    />
    
    <motion.div
      className="absolute bottom-1/3 right-1/4 w-16 h-16 bg-indigo-300 opacity-15"
      style={{ clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" }}
      animate={{
        rotate: [0, -90, -180, -270, -360],
        scale: [1, 1.3, 1],
        x: [0, -25, 0],
        y: [0, 25, 0]
      }}
      transition={{
        duration: 15,
        repeat: Infinity,
        ease: "easeInOut"
      }}
    />
  </div>
);

// Left Side Info Component
const PostureInfo = () => (
  <motion.div
    className="flex-1 flex flex-col justify-center px-12 py-16 relative z-10"
    initial={{ opacity: 0, x: -100 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 1.2, ease: "easeOut" }}
  >
    {/* Logo and Animation */}
    <motion.div
      className="flex items-center mb-8"
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ duration: 1, delay: 0.3, type: "spring", stiffness: 200 }}
    >
      <motion.div
        className="w-16 h-16 mr-4"
        animate={{ 
          rotateY: [0, 180, 360],
          scale: [1, 1.1, 1]
        }}
        transition={{ 
          duration: 4, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        <Lottie animationData={postureAnim} loop={true} />
      </motion.div>
      <motion.h1
        className="text-4xl font-bold text-blue-600"
        animate={{ 
          color: ["#2563eb", "#1d4ed8", "#2563eb"]
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        SmartPosture
      </motion.h1>
    </motion.div>

    {/* Main Heading */}
    <motion.h2
      className="text-5xl font-extrabold text-gray-800 mb-6 leading-tight"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.6 }}
    >
      Transform Your
      <motion.span
        className="block text-blue-500"
        animate={{
          color: ["#3b82f6", "#6366f1", "#3b82f6"]
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      >
        Posture Journey
      </motion.span>
    </motion.h2>

    {/* Features List */}
    <div className="space-y-4 mb-8">
      {[
        { text: "AI-Powered Real-time Analysis", delay: 0.8 },
        { text: "Comprehensive Posture Analytics", delay: 1.0 },
        { text: "Personalized Improvement Tips", delay: 1.2 },
        { text: "Instant Correction Alerts", delay: 1.4 }
      ].map((feature, index) => (
        <motion.div
          key={index}
          className="p-4 bg-white/80 backdrop-blur-sm rounded-xl border border-blue-100 shadow-sm"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: feature.delay }}
          whileHover={{ 
            scale: 1.03, 
            x: 10,
            boxShadow: "0 10px 25px rgba(66, 133, 244, 0.15)",
            backgroundColor: "rgba(255, 255, 255, 0.95)",
            transition: { duration: 0.2 }
          }}
        >
          <motion.div
            className="flex items-center space-x-4"
            animate={{
              y: [0, -2, 0]
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              delay: index * 0.3,
              ease: "easeInOut"
            }}
          >
            <motion.div
              className="w-3 h-3 bg-blue-500 rounded-full"
              animate={{ 
                scale: [1, 1.3, 1],
                backgroundColor: ["#3b82f6", "#1d4ed8", "#3b82f6"]
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity,
                delay: index * 0.5,
                ease: "easeInOut"
              }}
            />
            <span className="text-lg font-semibold text-gray-700">{feature.text}</span>
          </motion.div>
        </motion.div>
      ))}
    </div>

    {/* Stats */}
    <motion.div
      className="grid grid-cols-2 gap-6"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 1.6 }}
    >
      {[
        { number: "98%", label: "Accuracy Rate" },
        { number: "24/7", label: "Monitoring" }
      ].map((stat, index) => (
        <motion.div
          key={index}
          className="text-center p-4 bg-white/70 backdrop-blur-sm rounded-2xl border border-blue-100"
          whileHover={{ 
            scale: 1.1,
            boxShadow: "0 20px 40px rgba(66, 133, 244, 0.2)"
          }}
          animate={{
            y: [0, -5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: index * 0.3,
            ease: "easeInOut"
          }}
        >
          <motion.div
            className="text-3xl font-bold text-blue-600"
            animate={{ 
              scale: [1, 1.1, 1],
              color: ["#2563eb", "#1d4ed8", "#2563eb"]
            }}
            transition={{ duration: 2, repeat: Infinity, delay: index * 0.5 }}
          >
            {stat.number}
          </motion.div>
          <div className="text-sm text-gray-600 font-medium">{stat.label}</div>
        </motion.div>
      ))}
    </motion.div>
  </motion.div>
);

const SignIn = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [credential, setCredential] = useState(""); // for login (email or username)
  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    
    try {
      if (isSignUp) {
        if (!name.trim()) {
          setError("Name is required");
          setIsLoading(false);
          return;
        }
        if (!signupUsername.trim()) {
          setError("Username is required");
          setIsLoading(false);
          return;
        }
        if (!signupEmail.trim()) {
          setError("Email is required");
          setIsLoading(false);
          return;
        }
        const result = await signup(signupUsername, signupEmail, password, name);
        if (result.success) {
          navigate("/");
        } else {
          setError(result.error || "Sign up failed. Please check your network and try again.");
        }
      } else {
        const result = await login(credential, password);
        if (result.success) {
          navigate("/");
        } else {
          setError(result.error || "Sign in failed. Please check your network and try again.");
        }
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Fix: Set body background for this page to avoid inherited dark/blank backgrounds
  useEffect(() => {
    const originalBg = document.body.style.background;
    document.body.style.background = palette.bg;
    return () => {
      document.body.style.background = originalBg;
    };
  }, []);

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      <AnimatedBackground />
      
      {/* Left Side - Info */}
      <PostureInfo />
      
      {/* Right Side - Form */}
      <motion.div
        className="flex-1 flex items-center justify-center px-8 py-16 relative z-10"
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
      >
        <motion.div
          className="w-full max-w-md relative"
          initial={{ scale: 0.9, rotateY: 90 }}
          animate={{ scale: 1, rotateY: 0 }}
          transition={{ duration: 1, delay: 0.6, type: "spring", stiffness: 100 }}
        >
          {/* Glowing Card Background */}
          <motion.div
            className="absolute inset-0 bg-white/90 backdrop-blur-xl rounded-3xl border border-white/50"
            animate={{
              boxShadow: [
                "0 25px 50px rgba(66, 133, 244, 0.15)",
                "0 35px 70px rgba(66, 133, 244, 0.25)",
                "0 25px 50px rgba(66, 133, 244, 0.15)"
              ]
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          
          {/* Card Content */}
          <div className="relative p-8 rounded-3xl border border-white/40">
            {/* Toggle Buttons */}
            <motion.div
              className="flex mb-8 bg-gray-100/80 p-1 rounded-2xl backdrop-blur-sm"
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.8 }}
            >
              <motion.button
                type="button"
                onClick={() => setIsSignUp(false)}
                className={`flex-1 py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-300 ${
                  !isSignUp
                    ? "bg-white text-blue-600 shadow-lg"
                    : "text-gray-600 hover:text-blue-600"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                animate={!isSignUp ? { 
                  boxShadow: ["0 4px 15px rgba(66, 133, 244, 0.2)", "0 8px 25px rgba(66, 133, 244, 0.3)", "0 4px 15px rgba(66, 133, 244, 0.2)"]
                } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                Sign In
              </motion.button>
              <motion.button
                type="button"
                onClick={() => setIsSignUp(true)}
                className={`flex-1 py-3 px-6 rounded-xl font-semibold text-sm transition-all duration-300 ${
                  isSignUp
                    ? "bg-white text-blue-600 shadow-lg"
                    : "text-gray-600 hover:text-blue-600"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                animate={isSignUp ? { 
                  boxShadow: ["0 4px 15px rgba(66, 133, 244, 0.2)", "0 8px 25px rgba(66, 133, 244, 0.3)", "0 4px 15px rgba(66, 133, 244, 0.2)"]
                } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                Sign Up
              </motion.button>
            </motion.div>

            {/* Form Title */}
            <motion.h2
              className="text-3xl font-bold text-center mb-8 text-gray-800"
              key={isSignUp ? "signup" : "signin"}
              initial={{ opacity: 0, y: 20, rotateX: -90 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ duration: 0.6, type: "spring", stiffness: 200 }}
            >
              {isSignUp ? "Create Your Account" : "Welcome Back"}
            </motion.h2>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              <AnimatePresence mode="wait">
                {isSignUp && (
                  <motion.div
                    className="space-y-4"
                    initial={{ opacity: 0, height: 0, y: -20 }}
                    animate={{ opacity: 1, height: "auto", y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -20 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                  >
                    {/* Name Input */}
                    <motion.div
                      initial={{ x: -50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.1 }}
                    >
                      <motion.input
                        type="text"
                        placeholder="Full Name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        required
                        className="w-full px-4 py-4 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl text-gray-800 font-medium placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:bg-white transition-all duration-300"
                        whileFocus={{ 
                          scale: 1.02,
                          boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.1)"
                        }}
                      />
                    </motion.div>

                    {/* Username Input */}
                    <motion.div
                      initial={{ x: -50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.2 }}
                    >
                      <motion.input
                        type="text"
                        placeholder="Username"
                        value={signupUsername}
                        onChange={e => setSignupUsername(e.target.value)}
                        required
                        className="w-full px-4 py-4 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl text-gray-800 font-medium placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:bg-white transition-all duration-300"
                        whileFocus={{ 
                          scale: 1.02,
                          boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.1)"
                        }}
                      />
                    </motion.div>

                    {/* Email Input */}
                    <motion.div
                      initial={{ x: -50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ duration: 0.5, delay: 0.3 }}
                    >
                      <motion.input
                        type="email"
                        placeholder="Email Address"
                        value={signupEmail}
                        onChange={e => setSignupEmail(e.target.value)}
                        required
                        className="w-full px-4 py-4 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl text-gray-800 font-medium placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:bg-white transition-all duration-300"
                        whileFocus={{ 
                          scale: 1.02,
                          boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.1)"
                        }}
                      />
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Login Credential Input */}
              {!isSignUp && (
                <motion.div
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.input
                    type="text"
                    placeholder="Email or Username"
                    value={credential}
                    onChange={e => setCredential(e.target.value)}
                    required
                    className="w-full px-4 py-4 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl text-gray-800 font-medium placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:bg-white transition-all duration-300"
                    whileFocus={{ 
                      scale: 1.02,
                      boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.1)"
                    }}
                  />
                </motion.div>
              )}

              {/* Password Input */}
              <motion.div
                initial={{ x: -50, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: isSignUp ? 0.4 : 0.1 }}
              >
                <motion.input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-4 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-xl text-gray-800 font-medium placeholder-gray-500 focus:outline-none focus:border-blue-400 focus:bg-white transition-all duration-300"
                  whileFocus={{ 
                    scale: 1.02,
                    boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.1)"
                  }}
                />
              </motion.div>

              {/* Submit Button */}
              <motion.button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 mt-8 bg-blue-500 hover:bg-blue-600 text-white font-bold text-lg rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden relative transition-colors duration-300"
                whileHover={{ 
                  scale: 1.02,
                  boxShadow: "0 15px 35px rgba(66, 133, 244, 0.4)",
                  backgroundColor: "#1d4ed8"
                }}
                whileTap={{ scale: 0.98 }}
              >
                {/* Button Background Animation */}
                <motion.div
                  className="absolute inset-0 bg-blue-600"
                  animate={{
                    x: ["-100%", "100%"]
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                />
                
                <span className="relative z-10 flex items-center justify-center">
                  {isLoading ? (
                    <motion.div
                      className="flex items-center space-x-2"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <motion.div
                        className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      />
                      <span>Processing...</span>
                    </motion.div>
                  ) : (
                    <motion.span
                      initial={{ y: 0 }}
                      whileHover={{ y: -2 }}
                      transition={{ duration: 0.2 }}
                    >
                      {isSignUp ? "Create Account" : "Sign In"}
                    </motion.span>
                  )}
                </span>
              </motion.button>

              {/* Error Message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="p-4 bg-red-50 border border-red-200 text-red-600 rounded-xl text-center font-medium"
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                  >
                    <motion.span
                      animate={{ x: [-2, 2, -2, 0] }}
                      transition={{ duration: 0.5 }}
                    >
                      {error}
                    </motion.span>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default SignIn;

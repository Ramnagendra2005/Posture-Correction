import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DOMPurify from "dompurify";
import useAuth from "../hooks/useAuth";

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// --- Custom Robot Logo ---
const RobotLogo = ({ size = 32 }) => (
  <motion.svg 
    width={size} 
    height={size} 
    viewBox="0 0 32 32" 
    fill="none"
    initial={{ rotate: 0 }}
    animate={{ rotate: [0, 10, -10, 0] }}
    transition={{ 
      duration: 2, 
      repeat: Infinity, 
      repeatDelay: 3,
      ease: "easeInOut"
    }}
  >
    <g transform="translate(16,16)">
      {/* Robot head */}
      <motion.rect 
        x="-8" y="-10" width="16" height="14" rx="3" 
        fill="#4285f4" stroke="#ffffff" strokeWidth="1.5"
        animate={{ 
          fill: ["#4285f4", "#5a9bff", "#4285f4"],
          scale: [1, 1.05, 1]
        }}
        transition={{ 
          duration: 2, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      {/* Robot eyes */}
      <motion.circle 
        cx="-3" cy="-6" r="2" fill="#ffffff"
        animate={{ 
          scaleY: [1, 0.2, 1],
          opacity: [1, 0.8, 1]
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.circle 
        cx="3" cy="-6" r="2" fill="#ffffff"
        animate={{ 
          scaleY: [1, 0.2, 1],
          opacity: [1, 0.8, 1]
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.1
        }}
      />
      
      {/* Eye pupils */}
      <motion.circle 
        cx="-3" cy="-6" r="0.8" fill="#4285f4"
        animate={{ x: [-3, -2.5, -3.5, -3] }}
        transition={{ 
          duration: 4, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.circle 
        cx="3" cy="-6" r="0.8" fill="#4285f4"
        animate={{ x: [3, 3.5, 2.5, 3] }}
        transition={{ 
          duration: 4, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      {/* Robot mouth */}
      <motion.rect 
        x="-4" y="-1" width="8" height="1.5" rx="0.75" 
        fill="#ffffff"
        animate={{ 
          width: [8, 6, 10, 8],
          scaleY: [1, 0.8, 1.2, 1]
        }}
        transition={{ 
          duration: 2.5, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      {/* Robot body */}
      <motion.rect 
        x="-6" y="4" width="12" height="8" rx="2" 
        fill="#5a9bff" stroke="#ffffff" strokeWidth="1"
        animate={{ 
          fill: ["#5a9bff", "#4285f4", "#5a9bff"]
        }}
        transition={{ 
          duration: 3, 
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5
        }}
      />
      
      {/* Robot antenna */}
      <motion.line 
        x1="0" y1="-10" x2="0" y2="-13" 
        stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round"
        animate={{ 
          y2: [-13, -15, -13],
          strokeWidth: [1.5, 2, 1.5]
        }}
        transition={{ 
          duration: 1.5, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      <motion.circle 
        cx="0" cy="-13" r="1.5" fill="#ffffff"
        animate={{ 
          r: [1.5, 2, 1.5],
          fill: ["#ffffff", "#4285f4", "#ffffff"],
          y: [-13, -15, -13]
        }}
        transition={{ 
          duration: 1.5, 
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      {/* Signal waves */}
      <motion.circle 
        cx="0" cy="-13" r="3" 
        fill="none" stroke="#4285f4" strokeWidth="0.5" opacity="0.6"
        animate={{ 
          r: [3, 6, 3],
          opacity: [0.6, 0, 0.6]
        }}
        transition={{ 
          duration: 2, 
          repeat: Infinity,
          ease: "easeOut"
        }}
      />
      <motion.circle 
        cx="0" cy="-13" r="4" 
        fill="none" stroke="#4285f4" strokeWidth="0.5" opacity="0.4"
        animate={{ 
          r: [4, 7, 4],
          opacity: [0.4, 0, 0.4]
        }}
        transition={{ 
          duration: 2, 
          repeat: Infinity,
          ease: "easeOut",
          delay: 0.3
        }}
      />
    </g>
  </motion.svg>
);

const ChatBot = () => {
  // --- State ---
  const [isHovered, setIsHovered] = useState(false);
  const [isClicked, setIsClicked] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const { token } = useAuth();

  // --- Hover handlers ---
  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);
  
  // --- Click handler ---
  const handleClick = () => setIsClicked(prev => !prev);

  // --- Determine if window should be shown ---
  const shouldShowWindow = isHovered || isClicked;

  // --- Blue & White Theme Markdown Formatter ---
  const formatMessage = (text) => {
    const html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#4285f4; font-weight:700;">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em style="color:#5a9bff; font-style:italic;">$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:#e8f0fe; color:#1a73e8; padding:2px 4px; border-radius:3px; font-family:monospace; font-size:11px;">$1</code>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['strong', 'em', 'code', 'br', 'p', 'span', 'ul', 'ol', 'li'],
      ALLOWED_ATTR: ['style'],
    });
  };

  // --- Scroll on new message ---
  useEffect(() => {
    if (shouldShowWindow) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [messages, shouldShowWindow]);

  // --- Message Send Handler ---
  const getCurrentTime = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    
    console.log("Sending message:", inputMessage);
    
    setMessages((prev) => [
      ...prev,
      { sender: "user", text: inputMessage, timestamp: getCurrentTime() },
    ]);
    setIsLoading(true);
    const userMessage = inputMessage;
    setInputMessage("");
    
    try {
      console.log("Making fetch request to /api/chat");
  const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        credentials: 'include',
        mode: 'cors',
        body: JSON.stringify({ message: userMessage }),
      });
      
      console.log("Response status:", response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("Response data:", data);
      
      const personalizedPrefix = data.personalized ? '<div style="display:inline-block;background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;margin-bottom:6px;">✨ Personalized</div><br/>' : '';
      
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: formatMessage(personalizedPrefix + (data.response || "Sorry, I couldn't process that request.")),
          timestamp: getCurrentTime(),
        },
      ]);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: DOMPurify.sanitize("🤖 <strong style='color:#4285f4'>Connection Error</strong>: Unable to reach the posture analysis system. Please check your connection and try again.", {
            ALLOWED_TAGS: ['strong', 'em', 'code', 'br', 'span'],
            ALLOWED_ATTR: ['style'],
          }),
          timestamp: getCurrentTime(),
        },
      ]);
    }
    setIsLoading(false);
  };

  // --- Enhanced Animations ---
  const containerVariants = {
    hidden: { 
      opacity: 0, 
      y: 30, 
      scale: 0.95,
      rotateX: -15
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      rotateX: 0,
      transition: { 
        type: "spring", 
        stiffness: 200, 
        damping: 20,
        staggerChildren: 0.1
      },
    },
    exit: { 
      opacity: 0, 
      y: 20, 
      scale: 0.95,
      rotateX: -10,
      transition: { duration: 0.25, ease: "easeOut" }
    },
  };

  const messageVariants = {
    hidden: { 
      opacity: 0, 
      x: 50, 
      scale: 0.9,
      rotateY: 15
    },
    visible: {
      opacity: 1,
      x: 0,
      scale: 1,
      rotateY: 0,
      transition: { 
        type: "spring", 
        stiffness: 300, 
        damping: 20,
        bounce: 0.3
      },
    },
  };

  const bubbleVariants = {
    hover: { 
      scale: 1.1,
      rotate: [0, -5, 5, 0],
      boxShadow: "0 10px 30px rgba(66, 133, 244, 0.4)",
      transition: {
        rotate: { duration: 0.6, ease: "easeInOut" },
        scale: { duration: 0.2 },
        boxShadow: { duration: 0.3 }
      }
    },
    tap: { 
      scale: 0.95,
      rotate: 0,
      transition: { duration: 0.1 }
    },
  };

  const inputVariants = {
    focus: {
      scale: 1.02,
      boxShadow: "0 0 0 3px rgba(66, 133, 244, 0.2)",
      transition: { duration: 0.2 }
    }
  };

  // Don't render if no token (user not authenticated)
  if (!token) {
    return null;
  }

  // --- Main Render ---
  return (
    <div 
      className="fixed bottom-5 right-5 z-50 pointer-events-none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ maxWidth: '400px', maxHeight: '500px' }}
    >
      {/* Floating Chat Button */}
      <motion.div
        onClick={handleClick}
        className="w-16 h-16 rounded-full bg-gradient-to-br from-[#4285f4] to-[#1a73e8] border-3 border-white shadow-xl flex items-center justify-center cursor-pointer overflow-hidden relative pointer-events-auto"
        variants={bubbleVariants}
        whileHover="hover"
        whileTap="tap"
        style={{
          marginBottom: shouldShowWindow ? 28 : 0,
          transition: 'margin-bottom 0.3s cubic-bezier(.77,0,.18,1)'
        }}
      >
        {/* Animated background pulse */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-[#5a9bff] to-[#4285f4] rounded-full"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.3, 0.6, 0.3]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <RobotLogo size={36} />
        
        {/* Notification dot */}
        <motion.div
          className="absolute -top-1 -right-1 w-4 h-4 bg-[#34a853] rounded-full border-2 border-white"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [1, 0.7, 1]
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </motion.div>

      {/* Chatbot Window */}
      <AnimatePresence>
        {shouldShowWindow && (
          <motion.div
            key="chatbot"
            className="absolute bottom-20 sm:bottom-[80px] right-0 sm:right-0 flex flex-col w-[340px] sm:w-[380px] h-[380px] sm:h-[420px]
              rounded-3xl shadow-2xl border-2 border-[#4285f4] bg-gradient-to-b from-white to-[#f8fbff] overflow-hidden backdrop-blur-sm pointer-events-auto"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={containerVariants}
            style={{ zIndex: 51 }}
          >
            {/* Header */}
            <motion.div 
              className="flex items-center gap-3 px-5 py-4 border-b-2 border-[#4285f4] bg-gradient-to-r from-[#4285f4] to-[#1a73e8] text-white"
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            >
              <motion.span 
                className="w-8 h-8"
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              >
                <RobotLogo size={26} />
              </motion.span>
              <div className="flex-1">
                <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <span className="font-bold text-white text-base">Posture Assistant</span>
                  <motion.span 
                    className="ml-3 px-2 py-1 bg-white text-[#4285f4] rounded-full text-xs font-bold"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    AI
                  </motion.span>
                </motion.div>
                <motion.div
                  className="flex items-center mt-1"
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <motion.div
                    className="w-2 h-2 bg-[#34a853] rounded-full mr-2"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <span className="text-xs text-blue-100">AI Agent Active • Personalized</span>
                </motion.div>
              </div>
              {isClicked && (
                <motion.button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsClicked(false);
                  }}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  initial={{ opacity: 0, rotate: -90 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M12 4L4 12M4 4l8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </motion.button>
              )}
            </motion.div>

            {/* Messages */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4" style={{background: "linear-gradient(to bottom, #ffffff, #f8fbff)"}}>
              <motion.div 
                className="text-center pt-2 pb-4"
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                <motion.span 
                  className="px-4 py-2 text-xs bg-gradient-to-r from-[#4285f4] to-[#1a73e8] text-white rounded-full font-medium shadow-lg"
                  animate={{ 
                    boxShadow: [
                      "0 4px 15px rgba(66, 133, 244, 0.3)",
                      "0 8px 25px rgba(66, 133, 244, 0.5)",
                      "0 4px 15px rgba(66, 133, 244, 0.3)"
                    ]
                  }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  Posture AI Agent v3.0 • Personalized Insights
                </motion.span>
              </motion.div>
              
              {messages.map((msg, index) => (
                <motion.div
                  key={index}
                  className={`
                    group relative px-4 py-3 rounded-2xl max-w-[88%] break-words shadow-lg
                    ${msg.sender === "user"
                      ? "ml-auto bg-gradient-to-br from-[#4285f4] to-[#1a73e8] text-white border border-[#5a9bff]"
                      : "mr-auto bg-white text-[#2d3748] border-2 border-[#e8f0fe] shadow-md"
                    }
                  `}
                  initial="hidden"
                  animate="visible"
                  variants={messageVariants}
                  whileHover={{ 
                    scale: 1.02,
                    boxShadow: msg.sender === "user" 
                      ? "0 8px 25px rgba(66, 133, 244, 0.4)"
                      : "0 8px 25px rgba(0, 0, 0, 0.1)"
                  }}
                  style={{
                    fontSize: "13px",
                    lineHeight: "1.5"
                  }}
                >
                  {/* Message content */}
                  {msg.sender === "user" ? (
                    <span className="font-medium">{msg.text}</span>
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{ __html: msg.text }}
                      style={{ wordBreak: "break-word" }}
                      className="prose prose-sm max-w-none"
                    />
                  )}
                  
                  {/* Timestamp */}
                  <motion.div 
                    className={`text-xs mt-2 flex items-center justify-end ${
                      msg.sender === "user" ? "text-blue-200" : "text-gray-500"
                    }`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.7 }}
                    transition={{ delay: 0.5 }}
                  >
                    <span>{msg.timestamp}</span>
                    {msg.sender === "user" && (
                      <motion.svg 
                        className="ml-2 w-3 h-3" 
                        viewBox="0 0 16 16" 
                        fill="currentColor"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.5, delay: 0.8 }}
                      >
                        <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                      </motion.svg>
                    )}
                  </motion.div>
                </motion.div>
              ))}
              
              {/* Loading animation */}
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center space-x-3 ml-4 p-3 bg-white rounded-2xl border-2 border-[#e8f0fe] shadow-md max-w-[60%]"
                >
                  <div className="flex space-x-1">
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-2.5 h-2.5 bg-[#4285f4] rounded-full"
                        animate={{
                          scale: [1, 1.4, 1],
                          opacity: [0.5, 1, 0.5]
                        }}
                        transition={{
                          duration: 1,
                          repeat: Infinity,
                          delay: i * 0.2,
                          ease: "easeInOut"
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-[#4285f4] font-medium">AI Agent analyzing your data...</span>
                </motion.div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <motion.form
              onSubmit={sendMessage}
              className="flex items-center space-x-3 p-4 border-t-2 border-[#e8f0fe] bg-white"
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6, type: "spring", stiffness: 200 }}
            >
              <motion.input
                type="text"
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Ask about your posture, exercises, or tips..."
                className="flex-1 px-4 py-3 text-sm rounded-2xl border-2 border-[#e8f0fe] focus:outline-none focus:border-[#4285f4] bg-[#f8fbff] text-[#2d3748] placeholder:text-[#718096] transition-all duration-200"
                disabled={isLoading}
                autoComplete="off"
                variants={inputVariants}
                whileFocus="focus"
              />
              <motion.button
                type="submit"
                disabled={isLoading || !inputMessage.trim()}
                className="px-4 py-3 bg-gradient-to-r from-[#4285f4] to-[#1a73e8] hover:from-[#1a73e8] hover:to-[#1557b0] text-white rounded-2xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: "0 8px 25px rgba(66, 133, 244, 0.4)"
                }}
                whileTap={{ scale: 0.95 }}
              >
                <motion.svg
                  width={18}
                  height={18}
                  className="inline-block"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  animate={{ 
                    rotate: isLoading ? 360 : 0,
                    x: [0, 2, 0]
                  }}
                  transition={{ 
                    rotate: { duration: 1, repeat: isLoading ? Infinity : 0 },
                    x: { duration: 0.6, repeat: Infinity, repeatType: "reverse" }
                  }}
                >
                  <path d="M4 20l16-8-16-8v6l10 2-10 2v6z" />
                </motion.svg>
              </motion.button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ChatBot;
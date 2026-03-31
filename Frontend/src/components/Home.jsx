import React, { useEffect, useMemo, useState } from "react";
import { motion, useAnimation } from "framer-motion";
import { useInView } from "react-intersection-observer";
import { ChevronDown, Monitor, Activity, Users, Award, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import screenImage from "../assets/screen.png";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const ACCENT = "#3b82f6";
const BG_LIGHT = "#ffffff";
const BG_LIGHTER = "#f8fafc";
const TEXT_DARK = "#1e293b";
const TEXT_FADED = "#64748b";

const normalizeScore = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const toTenScale = (value) => {
  const safe = normalizeScore(value);
  return Math.max(0, Math.min(10, Math.round(safe / 10)));
};

const getOverallColor = (score) => {
  if (score >= 85) return "#10b981";
  if (score >= 70) return "#f59e0b";
  return "#ef4444";
};

const getScoreChipStyle = (score) => {
  if (score >= 8) {
    return {
      background: "#dcfce7",
      border: "#86efac",
      text: "#14532d",
    };
  }
  if (score >= 6) {
    return {
      background: "#fef9c3",
      border: "#fde68a",
      text: "#713f12",
    };
  }
  return {
    background: "#fee2e2",
    border: "#fca5a5",
    text: "#7f1d1d",
  };
};

const Home = () => {
  return (
    <div className="w-full overflow-x-hidden scroll-smooth" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <BenefitsSection />
      <CTASection />
      <Footer />
    </div>
  );
};

const FloatingParticle = ({ delay, x, y, size }) => (
  <motion.div
    className="absolute rounded-full"
    style={{
      width: size,
      height: size,
      left: x,
      top: y,
      background: `radial-gradient(circle, ${ACCENT}25, ${ACCENT}08)`,
      filter: "blur(1px)",
    }}
    animate={{
      y: [0, -20, 0],
      opacity: [0.3, 0.7, 0.3],
      scale: [1, 1.2, 1],
    }}
    transition={{
      duration: 4 + Math.random() * 2,
      delay,
      repeat: Infinity,
      ease: "easeInOut",
    }}
  />
);

const HeroSection = () => {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [heroImageSrc, setHeroImageSrc] = useState(screenImage);
  const [heroData, setHeroData] = useState({
    todaySessions: 0,
    overall: 0,
    headTilt: 0,
    neckAngle: 0,
    spine: 0,
    shoulder: 0,
  });

  useEffect(() => {
    let disposed = false;

    const image = new Image();
    image.src = screenImage;

    image.onload = () => {
      if (disposed) return;

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      context.drawImage(image, 0, 0);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = frame.data;
      const keyColor = { r: 142, g: 119, b: 178 };

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        const distance = Math.sqrt(
          (r - keyColor.r) * (r - keyColor.r) +
            (g - keyColor.g) * (g - keyColor.g) +
            (b - keyColor.b) * (b - keyColor.b)
        );
        const isPurpleFamily = b > r && r > g;

        if (!isPurpleFamily) continue;

        if (distance < 58) {
          pixels[i + 3] = 0;
        } else if (distance < 90) {
          const alphaRatio = (distance - 58) / 32;
          pixels[i + 3] = Math.round(pixels[i + 3] * alphaRatio);
        }
      }

      context.putImageData(frame, 0, 0);
      setHeroImageSrc(canvas.toDataURL("image/png"));
    };

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;

    let isMounted = true;

    const fetchHeroData = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/reports/analytics`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) return;

        const payload = await response.json();
        const summary = payload?.summary || {};

        if (!isMounted) return;

        const headTilt = normalizeScore(summary.headTiltScore ?? summary.neckScore);
        const shoulder = normalizeScore(summary.shoulderAlignmentScore ?? summary.shoulderScore);
        const spine = normalizeScore(summary.spinalPostureScore ?? summary.backScore);

        setHeroData({
          todaySessions: Math.max(0, Number(summary.todaySessions || 0)),
          overall: normalizeScore(summary.currentScore ?? summary.todayAvgScore ?? 0),
          headTilt,
          neckAngle: headTilt,
          spine,
          shoulder,
        });
      } catch (error) {
        // Keep hero in empty state if analytics are unavailable.
      }
    };

    fetchHeroData();
    return () => {
      isMounted = false;
    };
  }, [token]);

  const hasAnalyzedToday = heroData.todaySessions > 0;

  const callouts = useMemo(
    () => [
      {
        id: "head-tilt",
        label: "Head Tilt",
        value: toTenScale(heroData.headTilt),
        anchorX: 46,
        anchorY: 23,
        rowY: 34,
        color: "#f43f5e",
      },
      {
        id: "neck-angle",
        label: "Neck Angle",
        value: toTenScale(heroData.neckAngle),
        anchorX: 55,
        anchorY: 29,
        rowY: 45,
        color: "#f59e0b",
      },
      {
        id: "spine",
        label: "Spine",
        value: toTenScale(heroData.spine),
        anchorX: 73,
        anchorY: 46,
        rowY: 56,
        color: "#10b981",
      },
      {
        id: "shoulder",
        label: "Shoulder",
        value: toTenScale(heroData.shoulder),
        anchorX: 60,
        anchorY: 38,
        rowY: 67,
        color: "#3b82f6",
      },
    ],
    [heroData.headTilt, heroData.neckAngle, heroData.shoulder, heroData.spine]
  );

  const overallProgress = normalizeScore(heroData.overall);
  const circumference = 2 * Math.PI * 41;
  const dashOffset = circumference - (overallProgress / 100) * circumference;
  const overallColor = getOverallColor(overallProgress);

  /* Floating particles for ambient background effect */
  const particles = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        delay: i * 0.6,
        x: `${10 + Math.random() * 80}%`,
        y: `${10 + Math.random() * 80}%`,
        size: 6 + Math.random() * 14,
      })),
    []
  );

  return (
    <section
      className="relative flex items-center min-h-screen overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${BG_LIGHT} 0%, #eef2ff 50%, ${BG_LIGHTER} 100%)`,
      }}
    >
      {/* Decorative background elements */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: "600px",
          height: "600px",
          top: "-200px",
          right: "-200px",
          background: `radial-gradient(circle, ${ACCENT}08, transparent 70%)`,
          borderRadius: "50%",
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: "400px",
          height: "400px",
          bottom: "-100px",
          left: "-100px",
          background: `radial-gradient(circle, #818cf808, transparent 70%)`,
          borderRadius: "50%",
        }}
      />

      {/* Floating ambient particles */}
      {particles.map((p, i) => (
        <FloatingParticle key={i} {...p} />
      ))}

      <div className="w-full max-w-7xl mx-auto px-6 lg:px-8">
        <div
          className="grid items-center gap-6 lg:gap-4"
          style={{
            gridTemplateColumns: "1fr",
          }}
        >
          {/* ─── MOBILE: stacked layout ─── */}
          {/* ─── DESKTOP: 3-column layout ─── */}
          <div className="hidden md:grid items-center" style={{ gridTemplateColumns: "1fr minmax(0, 520px) 200px", gap: "2rem" }}>
            {/* Left – Text Content */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              className="text-left"
            >


              <motion.h1
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.1 }}
                className="font-extrabold"
                style={{
                  color: ACCENT,
                  letterSpacing: "1.5px",
                  fontSize: "clamp(2.8rem, 4vw, 4rem)",
                  lineHeight: 1.1,
                }}
              >
                Smart{" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(135deg, #2563eb, #7c3aed)",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  Posture
                </span>
              </motion.h1>

              <motion.h2
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="font-semibold mt-5 mb-6"
                style={{
                  color: TEXT_DARK,
                  fontWeight: 700,
                  fontSize: "clamp(1.25rem, 1.8vw, 1.75rem)",
                  lineHeight: 1.45,
                  maxWidth: "540px",
                }}
              >
                A Real-Time <span style={{ color: ACCENT }}>ML-Driven System</span> for Posture Detection,{" "}
                <span style={{ color: ACCENT }}>Analysis</span> and Personalized Exercise Recommendations
              </motion.h2>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.8 }}
                style={{
                  color: TEXT_FADED,
                  fontSize: "1.05rem",
                  lineHeight: 1.7,
                  maxWidth: "440px",
                }}
              >
                Improve your posture, <span style={{ color: ACCENT, fontWeight: 500 }}>reduce pain</span>,
                and boost productivity with our <span style={{ color: ACCENT, fontWeight: 500 }}>AI-powered</span> posture
                analysis system.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.6 }}
                className="flex items-center gap-4 mt-8"
              >
                <button
                  onClick={() => navigate("/analysis")}
                  className="font-bold transition-all duration-300"
                  style={{
                    backgroundColor: ACCENT,
                    color: "white",
                    padding: "14px 32px",
                    borderRadius: "12px",
                    fontSize: "1.05rem",
                    boxShadow: `0 4px 14px ${ACCENT}40`,
                    border: "none",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#2563eb";
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = `0 6px 20px ${ACCENT}50`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = ACCENT;
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = `0 4px 14px ${ACCENT}40`;
                  }}
                >
                  Start Your Analysis
                </button>
                <motion.div
                  animate={{ x: [0, 6, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                >
                  <ArrowRight size={22} color={ACCENT} />
                </motion.div>
              </motion.div>
            </motion.div>

            {/* Center – Image with SVG overlay & score badge */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="flex justify-center"
            >
              <div className="relative w-full">
                <div
                  className="rounded-2xl overflow-hidden bg-white/80"
                  style={{
                    border: "1px solid #dbeafe",
                    boxShadow: "0 8px 32px rgba(59,130,246,0.10), 0 2px 8px rgba(0,0,0,0.04)",
                  }}
                >
                  <img
                    src={heroImageSrc}
                    alt="Posture analysis preview"
                    className="w-full h-auto object-contain"
                  />
                </div>

                {/* SVG callout lines */}
                <svg
                  viewBox="0 0 100 100"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ overflow: "visible" }}
                >
                  {callouts.map((item, index) => (
                    <motion.path
                      key={`${item.id}-path`}
                      d={`M${item.anchorX} ${item.anchorY} C ${item.anchorX + 10} ${item.anchorY + 2}, 84 ${item.rowY}, 99 ${item.rowY}`}
                      fill="none"
                      stroke={item.color}
                      strokeWidth="0.8"
                      strokeDasharray="none"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={hasAnalyzedToday ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
                      transition={{ duration: 0.8, delay: 0.1 + index * 0.12, ease: "easeOut" }}
                    />
                  ))}

                  {callouts.map((item, index) => (
                    <motion.circle
                      key={`${item.id}-dot`}
                      cx={item.anchorX}
                      cy={item.anchorY}
                      r="1.2"
                      fill={item.color}
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={hasAnalyzedToday ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
                      transition={{ duration: 0.3, delay: 0.35 + index * 0.1 }}
                    />
                  ))}
                </svg>

                {/* Overall score badge */}
                <motion.div
                  className="absolute"
                  style={{ right: "4%", top: "4%" }}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={hasAnalyzedToday ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.45, delay: 0.95 }}
                >
                  <svg width="80" height="80" viewBox="0 0 108 108" role="img" aria-label="Overall posture score">
                    <circle cx="54" cy="54" r="41" fill="none" stroke="rgba(226,232,240,0.95)" strokeWidth="7" />
                    <circle
                      cx="54"
                      cy="54"
                      r="41"
                      fill="none"
                      stroke={overallColor}
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      transform="rotate(-90 54 54)"
                    />
                    <text x="54" y="50" textAnchor="middle" style={{ fill: "#0f172a", fontWeight: 800, fontSize: "30px" }}>
                      {overallProgress}
                    </text>
                    <text x="54" y="70" textAnchor="middle" style={{ fill: "#0f172a", fontWeight: 600, fontSize: "14px" }}>
                      / 100
                    </text>
                  </svg>
                </motion.div>

                {/* Overlay for when no session is analyzed yet */}
                <motion.div
                  className="absolute inset-0 flex items-center justify-center px-6 rounded-2xl"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(239,246,255,0.92))",
                    backdropFilter: "blur(6px)",
                  }}
                  animate={{
                    opacity: hasAnalyzedToday ? 0 : 1,
                    pointerEvents: hasAnalyzedToday ? "none" : "auto",
                  }}
                  transition={{ duration: 0.4 }}
                >
                  <div className="text-center max-w-sm">
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}
                    >
                      🎯
                    </motion.div>
                    <div className="font-bold" style={{ color: "#1e40af", fontSize: "1.15rem" }}>
                      Start Analysis To Reveal Your Live Posture Map
                    </div>
                    <p className="mt-2" style={{ color: "#475569", fontSize: "0.9rem", lineHeight: 1.6 }}>
                      Your arrows and scores animate in automatically after your first completed session.
                    </p>
                  </div>
                </motion.div>
              </div>
            </motion.div>

            {/* Right – Score Callout Cards */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="flex flex-col gap-3"
            >
              {callouts.map((item, index) => {
                const chipStyle = getScoreChipStyle(item.value);
                return (
                  <motion.div
                    key={`${item.id}-card`}
                    initial={{ opacity: 0, x: 20, scale: 0.95 }}
                    animate={
                      hasAnalyzedToday
                        ? { opacity: 1, x: 0, scale: 1 }
                        : { opacity: 0.35, x: 0, scale: 1 }
                    }
                    transition={{ duration: 0.5, delay: 0.6 + index * 0.12, ease: "easeOut" }}
                    whileHover={{ scale: 1.04, boxShadow: `0 4px 16px ${ACCENT}20` }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "12px 16px",
                      borderRadius: "12px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "rgba(255,255,255,0.95)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                      cursor: "default",
                      transition: "box-shadow 0.2s, transform 0.2s",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.95rem",
                        fontWeight: 600,
                        color: "#1e293b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.label}
                    </span>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 800,
                        borderRadius: "9999px",
                        padding: "4px 12px",
                        border: `1px solid ${chipStyle.border}`,
                        backgroundColor: chipStyle.background,
                        color: chipStyle.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.value}/10
                    </span>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>

          {/* ─── MOBILE only layout ─── */}
          <div className="md:hidden flex flex-col gap-8">
            {/* Text Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-left pt-8"
            >



              <h1
                className="text-3xl font-extrabold"
                style={{ color: ACCENT, letterSpacing: "1px", lineHeight: 1.15 }}
              >
                Smart{" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(135deg, #2563eb, #7c3aed)",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  Posture
                </span>
              </h1>

              <h2
                className="font-semibold mt-4 mb-5"
                style={{ color: TEXT_DARK, fontWeight: 700, fontSize: "1.15rem", lineHeight: 1.5 }}
              >
                A Real-Time <span style={{ color: ACCENT }}>ML-Driven System</span> for Posture Detection,{" "}
                <span style={{ color: ACCENT }}>Analysis</span> and Personalized Exercise Recommendations
              </h2>

              <p style={{ color: TEXT_FADED, fontSize: "0.95rem", lineHeight: 1.65, maxWidth: "400px" }}>
                Improve your posture, <span style={{ color: ACCENT, fontWeight: 500 }}>reduce pain</span>,
                and boost productivity with our <span style={{ color: ACCENT, fontWeight: 500 }}>AI-powered</span> posture
                analysis system.
              </p>

              <button
                onClick={() => navigate("/analysis")}
                className="font-bold mt-6"
                style={{
                  backgroundColor: ACCENT,
                  color: "white",
                  padding: "12px 28px",
                  borderRadius: "12px",
                  fontSize: "1rem",
                  boxShadow: `0 4px 14px ${ACCENT}40`,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Start Your Analysis
              </button>
            </motion.div>

            {/* Image */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <div
                className="relative rounded-2xl overflow-hidden"
                style={{
                  border: "1px solid #dbeafe",
                  boxShadow: "0 8px 32px rgba(59,130,246,0.10)",
                }}
              >
                <img src={heroImageSrc} alt="Posture analysis preview" className="w-full h-auto object-contain" />

                <motion.div
                  className="absolute inset-0 flex items-center justify-center px-6 rounded-2xl"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(239,246,255,0.92))",
                    backdropFilter: "blur(6px)",
                  }}
                  animate={{
                    opacity: hasAnalyzedToday ? 0 : 1,
                    pointerEvents: hasAnalyzedToday ? "none" : "auto",
                  }}
                  transition={{ duration: 0.4 }}
                >
                  <div className="text-center">
                    <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎯</div>
                    <div className="font-bold" style={{ color: "#1e40af", fontSize: "1rem" }}>
                      Start Analysis To Reveal Your Posture Map
                    </div>
                    <p className="mt-1" style={{ color: "#475569", fontSize: "0.85rem" }}>
                      Scores appear after your first session.
                    </p>
                  </div>
                </motion.div>
              </div>
            </motion.div>

            {/* Score cards – mobile grid */}
            <div className="grid grid-cols-2 gap-3">
              {callouts.map((item, index) => {
                const chipStyle = getScoreChipStyle(item.value);
                return (
                  <motion.div
                    key={`${item.id}-mobile`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={hasAnalyzedToday ? { opacity: 1, y: 0 } : { opacity: 0.35, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: "12px",
                      border: "1px solid #e2e8f0",
                      backgroundColor: "rgba(255,255,255,0.95)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                    }}
                  >
                    <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1e293b" }}>{item.label}</span>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        fontWeight: 800,
                        borderRadius: "9999px",
                        padding: "2px 8px",
                        border: `1px solid ${chipStyle.border}`,
                        backgroundColor: chipStyle.background,
                        color: chipStyle.text,
                      }}
                    >
                      {item.value}/10
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.7 }}
        transition={{ delay: 2, duration: 1, repeat: Infinity, repeatType: "reverse" }}
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2"
        style={{ color: ACCENT }}
      >
        <ChevronDown size={32} />
      </motion.div>
    </section>
  );
};

const FeaturesSection = () => {
  const controls = useAnimation();
  const [ref, inView] = useInView({
    threshold: 0.25,
    triggerOnce: false,
  });

  useEffect(() => {
    if (inView) controls.start("visible");
  }, [controls, inView]);

  const features = [
    {
      icon: <Monitor size={48} color={ACCENT} />,
      title: "Real-Time Detection",
      description: (
        <>
          Instantly analyze your sitting posture through your webcam with{" "}
          <span style={{ color: ACCENT }}>advanced ML algorithms</span>
        </>
      ),
    },
    {
      icon: <Activity size={48} color={ACCENT} />,
      title: "Detailed Analysis",
      description: (
        <>
          Get <span style={{ color: ACCENT }}>comprehensive insights</span> about your posture patterns and potential improvements
        </>
      ),
    },
    {
      icon: <Users size={48} color={ACCENT} />,
      title: "Personalized Recommendations",
      description: (
        <>
          Receive <span style={{ color: ACCENT }}>customized exercise suggestions</span> based on your unique posture profile
        </>
      ),
    },
  ];

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.3,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 60 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } },
  };

  return (
    <section
      className="py-24 px-6"
      style={{ backgroundColor: BG_LIGHTER, color: TEXT_DARK }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: ACCENT }}>
            Our <span style={{ color: "#2563eb" }}>Powerful Features</span>
          </h2>
          <p className="text-lg max-w-3xl mx-auto" style={{ color: TEXT_FADED }}>
            Smart Posture uses <span style={{ color: ACCENT }}>cutting-edge technology</span> to monitor and improve your sitting habits
          </p>
        </motion.div>

        <motion.div
          ref={ref}
          variants={containerVariants}
          initial="hidden"
          animate={controls}
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          {features.map((feature, index) => (
            <motion.div
              key={index}
              variants={itemVariants}
              className="p-8 rounded-xl cursor-pointer bg-white transition duration-300 border shadow-sm"
              style={{
                color: TEXT_DARK,
                border: "1.5px solid #e2e8f0",
                boxShadow: "none",
              }}
              whileHover={{
                scale: 1.06,
                boxShadow: `0 0 0 4px ${ACCENT}20, 0 0 16px 2px ${ACCENT}30`,
                borderColor: ACCENT,
              }}
            >
              <div className="mb-5">{feature.icon}</div>
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p style={{ color: TEXT_FADED }}>{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

const HowItWorksSection = () => {
  const steps = [
    {
      number: "01",
      title: "Enable Camera",
      description: <>Grant camera access to begin <span style={{ color: ACCENT }}>posture detection</span></>,
    },
    {
      number: "02",
      title: "Get Analyzed",
      description: <>Our ML model <span style={{ color: ACCENT }}>evaluates</span> your sitting position in real-time</>,
    },
    {
      number: "03",
      title: "View Results",
      description: <>Receive <span style={{ color: ACCENT }}>detailed feedback</span> on your posture and potential issues</>,
    },
    {
      number: "04",
      title: "Follow Recommendations",
      description: <>Practice <span style={{ color: ACCENT }}>suggested exercises</span> to correct and strengthen</>,
    },
  ];

  return (
    <section
      className="py-24 px-6"
      style={{ background: `linear-gradient(135deg, ${BG_LIGHT}, ${BG_LIGHTER})`, color: TEXT_DARK }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: ACCENT }}>
            How <span style={{ color: "#2563eb" }}>It Works</span>
          </h2>
          <p className="text-lg max-w-3xl mx-auto" style={{ color: TEXT_FADED }}>
            Four simple steps to <span style={{ color: ACCENT }}>better posture</span> and improved well-being
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.08 }}
              viewport={{ once: true }}
              whileHover={{
                scale: 1.09,
                borderColor: ACCENT,
                boxShadow: `0 0 0 3px ${ACCENT}20, 0 0 12px 2px ${ACCENT}30`,
              }}
              className="relative px-6 py-4 border-2 rounded-lg cursor-pointer bg-white transition duration-200 hover:-translate-y-2 shadow-sm"
              style={{
                borderColor: "#e2e8f0",
                boxShadow: "0 0 0 0 transparent",
              }}
            >
              <div
                className="text-3xl font-extrabold rounded-full w-14 h-14 flex items-center justify-center mb-5"
                style={{ backgroundColor: ACCENT, color: "white" }}
              >
                {step.number.slice(-1)}
              </div>
              <h3 className="text-lg font-bold mb-2">{step.title}</h3>
              <p style={{ color: TEXT_FADED }}>{step.description}</p>
              {index < steps.length - 1 && (
                <div
                  className="hidden md:block absolute top-8 left-full w-10 h-0.5"
                  style={{ backgroundColor: ACCENT, opacity: 0.3 }}
                />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const BenefitsSection = () => {
  const benefits = [
    {
      metric: "70%",
      title: "Reduction in Back Pain",
      description: <>Users report <span style={{ color: ACCENT }}>significant decreases in discomfort</span> after 4 weeks</>,
    },
    {
      metric: "83%",
      title: "Improved Productivity",
      description: <>Better posture leads to <span style={{ color: ACCENT }}>better focus</span> and energy levels</>,
    },
    {
      metric: "2x",
      title: "Better Awareness",
      description: <>Users become <span style={{ color: ACCENT }}>twice as aware</span> of their posture habits</>,
    },
  ];

  return (
    <section
      className="py-24 px-6"
      style={{
        background: `linear-gradient(135deg, ${ACCENT}10, ${ACCENT}05)`,
        color: TEXT_DARK,
      }}
    >
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: ACCENT }}>
            Transform <span style={{ color: "#2563eb" }}>Your Health</span>
          </h2>
          <p className="text-lg max-w-3xl mx-auto" style={{ color: TEXT_FADED }}>
            The benefits of <span style={{ color: ACCENT }}>good posture</span> extend beyond just sitting correctly
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {benefits.map((benefit, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              viewport={{ once: true }}
              whileHover={{
                scale: 1.08,
                borderColor: ACCENT,
                boxShadow: `0 0 0 4px ${ACCENT}20, 0 0 16px 2px ${ACCENT}30`,
                transition: { duration: 0.12 },
              }}
              className="p-8 rounded-xl text-center bg-white cursor-pointer transition duration-100 hover:shadow-lg hover:-translate-y-3 border shadow-sm"
              style={{
                borderColor: "#e2e8f0",
              }}
            >
              <div
                className="text-5xl font-extrabold mb-4"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${ACCENT}, #2563eb)`,
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                }}
              >
                {benefit.metric}
              </div>
              <h3 className="text-xl font-bold mb-3" style={{ color: TEXT_DARK }}>{benefit.title}</h3>
              <p style={{ color: TEXT_FADED }}>{benefit.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

const CTASection = () => {
  const navigate = useNavigate();

  return (
    <section className="py-24 px-6" style={{ background: BG_LIGHTER }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="max-w-5xl mx-auto rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-xl"
        style={{ background: `linear-gradient(125deg, ${ACCENT}, #2563eb)` }}
      >
        <div className="md:w-2/3 p-12 text-white flex flex-col justify-center">
          <h2 className="text-4xl font-extrabold mb-4" style={{ letterSpacing: "2px" }}>
            Ready to <span style={{ color: "#93c5fd" }}>improve your posture?</span>
          </h2>
          <p className="text-lg mb-8" style={{ color: "#dbeafe" }}>
            Start your journey to better health and comfort with Smart Posture's advanced analysis
          </p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="inline-flex items-center px-8 py-4 rounded-lg font-bold text-white bg-white/20 hover:bg-white/30"
            style={{ letterSpacing: "1.2px" }}
            onClick={() => navigate("/analysis")}
          >
            Start Analysis <ArrowRight size={22} className="ml-3" />
          </motion.button>
        </div>
        <div className="md:w-1/3 p-8 bg-white/10 flex items-center justify-center">
          <PostureIllustration />
        </div>
      </motion.div>
    </section>
  );
};

const Footer = () => {
  return (
    <footer className="py-12 px-6" style={{ backgroundColor: BG_LIGHT, color: TEXT_FADED, borderTop: "1px solid #e2e8f0" }}>
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10">
        <div>
          <h3 style={{ color: ACCENT, fontWeight: "700", fontSize: "1.4rem", marginBottom: "1rem" }}>
            Smart <span style={{ color: "#2563eb" }}>Posture</span>
          </h3>
          <p>
            Improving health through <span style={{ color: ACCENT }}>better sitting habits</span>
          </p>
        </div>
        <div>
          <h4 style={{ color: ACCENT, fontWeight: "700", marginBottom: "1rem" }}>Features</h4>
          <ul style={{ lineHeight: 1.75 }}>
            <li><span style={{ color: ACCENT }}>Real-time Detection</span></li>
            <li>Posture Analysis</li>
            <li>Exercise Recommendations</li>
            <li>Progress Tracking</li>
          </ul>
        </div>
        <div>
          <h4 style={{ color: ACCENT, fontWeight: "700", marginBottom: "1rem" }}>Resources</h4>
          <ul style={{ lineHeight: 1.75 }}>
            <li>Blog</li>
            <li>Research</li>
            <li>Help Center</li>
            <li>Privacy Policy</li>
          </ul>
        </div>
        <div>
          <h4 style={{ color: ACCENT, fontWeight: "700", marginBottom: "1rem" }}>Contact</h4>
          <ul style={{ lineHeight: 1.75 }}>
            <li>Email: hello@smartposture.app</li>
            <li>Phone: (123) 456-7890</li>
            <li>Address: 123 Health St, Wellness City</li>
          </ul>
        </div>
      </div>
      <div style={{ borderTop: "1px solid #e2e8f0", marginTop: "3rem", paddingTop: "2rem", textAlign: "center", color: TEXT_FADED }}>
        &copy; 2025 <span style={{ color: ACCENT }}>Smart Posture</span>. All rights reserved.
      </div>
    </footer>
  );
};

const PostureIllustration = () => {
  return (
    <svg width="200" height="200" viewBox="0 0 280 240" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of correct posture">
      {/* Desk */}
      <rect x="40" y="140" width="200" height="10" fill="#3b82f6" />
      <rect x="50" y="150" width="180" height="60" fill="#2563eb" />
      {/* Computer */}
      <rect x="110" y="100" width="60" height="40" rx="2" fill="#1d4ed8" />
      <rect x="130" y="140" width="20" height="5" fill="#1e3a8a" />
      {/* Chair */}
      <rect x="110" y="170" width="60" height="10" rx="2" fill="#312e81" />
      <rect x="130" y="180" width="20" height="40" fill="#1e1b4b" />
      {/* Head */}
      <circle cx="140" cy="80" r="15" fill="#fbbf24" />
      {/* Spine */}
      <path d="M140 95 L140 130 L140 160" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" />
      {/* Arms */}
      <path d="M140 110 L110 130 M140 110 L170 130" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
      {/* Legs */}
      <path d="M140 160 L120 200 M140 160 L160 200" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" />
      {/* Spine guideline */}
      <path d="M140 50 L140 220" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 4" opacity="0.3" />
    </svg>
  );
};

export default Home;

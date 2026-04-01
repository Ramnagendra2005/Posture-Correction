import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import useAuth from "../hooks/useAuth";

const ACCENT = "#3b82f6";
const BG_LIGHT = "#ffffff";
const BG_LIGHTER = "#f8fafc";
const TEXT_DARK = "#1e293b";
const TEXT_LIGHT = "#ffffff";
const FADED = "#64748b";

// NavLink component definition
const NavLink = ({ to, label, active }) => (
  <Link
    to={to}
    className={`nav-link${active ? " active" : ""}`}
    tabIndex={0}
    aria-current={active ? "page" : undefined}
  >
    {label}
  </Link>
);

const Navbar = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const [profileImageError, setProfileImageError] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => setProfileImageError(false), [user]);

  const getUserDisplayName = () => {
    if (!user) return "User";
    return (
      user.name ||
      user.username ||
      user.firstName ||
      user.displayName ||
      user.email?.split("@")[0] ||
      "User"
    );
  };

  const getUserInitial = () => {
    const name = getUserDisplayName();
    return name.charAt(0).toUpperCase();
  };
  

  return (
    <>
      <style>{`
        * { font-family: 'Inter', system-ui, sans-serif; }
        .nav-blur { /* reserved if blur wanted in future */ }
        .logo-container {
          display: flex;
          align-items: center;
          gap: 6px;
          user-select: none;
          cursor: pointer;
        }
        .logo-brand {
          font-weight: 900;
          letter-spacing: 1px;
          font-size: 1.5rem;
          color: ${ACCENT};
          text-shadow: 0 2px 14px ${ACCENT}20;
          transition: color 0.18s, text-shadow 0.18s;
        }
        .logo-container:hover .logo-brand {
          color: #2563eb;
          text-shadow: 0 4px 26px ${ACCENT}44;
        }
        /* Nav Links */
        .nav-link {
          position: relative;
          font-size: 1rem;
          font-weight: 600;
          color: ${TEXT_DARK};
          padding: 0.6em 1em;
          border-radius: 10px;
          transition: 
            color 0.18s,
            background 0.16s,
            box-shadow 0.22s;
        }
        .nav-link:not(.active):hover,
        .nav-link:not(.active):focus {
          color: ${ACCENT};
          background: #e0e7ff;
          text-shadow: 0 2px 6px ${ACCENT}30;
        }
        .nav-link.active {
          color: ${ACCENT};
          background: #c7d2fe;
          box-shadow: 0 2px 14px ${ACCENT}33;
        }
        .nav-link::after {
          content: "";
          position: absolute;
          left: 1em; right: 1em; bottom: .34em;
          height: 2px;
          background: linear-gradient(90deg, ${ACCENT}, transparent 100%);
          border-radius: 1px;
          opacity: 0;
          transform: scaleX(0.5);
          transition: opacity 0.2s, transform 0.22s;
        }
        .nav-link.active::after,
        .nav-link:hover::after,
        .nav-link:focus::after {
          opacity: 1;
          transform: scaleX(1);
        }
        /* Auth Buttons */
        .btn-accent {
          background: ${ACCENT};
          color: ${TEXT_LIGHT} !important;
          box-shadow: 0 2px 10px ${ACCENT}22, 0 1.5px 0 #0002;
          font-size: 1rem;
          font-weight: 700;
          border-radius: 11px;
          border: none;
          padding: 0.57em 1.25em;
          transition: background 0.15s, box-shadow 0.17s, color 0.18s;
        }
        .btn-accent:hover, .btn-accent:focus {
          background: #2563eb;
          color: ${TEXT_LIGHT} !important;
          box-shadow: 0 4px 18px ${ACCENT}4a;
        }
        .btn-outline-accent {
          background: none;
          border: 2px solid ${ACCENT};
          color: ${ACCENT};
          font-weight: 600;
          border-radius: 10px;
          padding: 0.54em 1.18em;
          font-size: 1rem;
          transition: 
            background 0.15s, color 0.17s, border-color 0.18s;
        }
        .btn-outline-accent:hover, .btn-outline-accent:focus {
          background: ${ACCENT};
          color: ${TEXT_LIGHT};
          border-color: #2563eb;
        }
        /* Avatar animation */
        .avatar {
          background: ${BG_LIGHTER};
          border: 2.5px solid #cbd5e1;
          box-shadow: 0 0 0px #000;
          width: 36px; height: 36px;
          border-radius: 40px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: border 0.18s, box-shadow 0.17s;
        }
        .avatar svg {
          width: 20px; height: 20px;
        }
        .avatar:hover, .avatar:focus {
          border-color: ${ACCENT};
          box-shadow: 0 0 0 3px ${ACCENT}22, 0 0 12px ${ACCENT}44;
          transform: scale(1.05);
        }
        /* Transitions for Mobile */
        .mobile-menu {
          background: ${BG_LIGHT};
          min-height: 100vh;
          animation: fadeInMobile 0.13s;
        }
        @keyframes fadeInMobile {
          from { opacity: 0; transform: translateY(30px);}
          to   { opacity: 1; transform: translateY(0);}
        }
        .mobile-item {
          opacity: 0;
          animation: fadeInMobile 0.36s cubic-bezier(.4,0,.2,1) .06s forwards;
        }
        .mobile-item + .mobile-item { animation-delay: .13s; }
        .mobile-auth { animation-delay: .28s !important; }
        /* Fancy Close Button */
        .close-btn svg {
          transition: color 0.2s;
        }
        .close-btn:hover svg, .close-btn:focus svg {
          color: ${ACCENT};
        }
      `}</style>
      <nav
        style={{
          background: BG_LIGHT,
          borderBottom: scrolled ? `1.25px solid #e2e8f0` : "none",
          boxShadow: scrolled
            ? `0 8px 16px -10px ${ACCENT}14`
            : "none",
        }}
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 ease-out"
      >
        <div className={`max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between transition-all duration-300 ${scrolled ? "py-3" : "py-5"}`}>
          {/* Logo */}
          <Link to="/" className="logo-container">
            <span className="logo-brand">SmartPosture</span>
          </Link>
          {/* Desktop Navigation */}
          <div className="hidden md:flex gap-6 m-auto">
            {[
              { path: "/", label: "Home" },
              { path: "/analysis", label: "Analysis" },
              { path: "/report", label: "Report" },
              { path: "/dashboard", label: "Dashboard" },
            ].map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                label={item.label}
                active={location.pathname === item.path}
              />
            ))}
          </div>
          {/* Auth Section - Desktop */}
          <div className="hidden md:block">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="avatar" tabIndex={0}>
                  <svg viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <span 
                  style={{
                    fontWeight: 500,
                    fontSize: "1rem",
                    letterSpacing: ".01em",
                    color: TEXT_DARK,
                  }}
                >
                  {getUserDisplayName()}
                </span>
                <button
                  onClick={logout}
                  className="btn-outline-accent"
                  style={{ marginLeft: ".2em" }}
                >Sign out</button>
              </div>
            ) : (
              <Link to="/signin" className="btn-accent">Sign In</Link>
            )}
          </div>
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-2xl hover:bg-blue-50 transition-all duration-200 close-btn"
            aria-label="Toggle menu"
          >
            <svg
              className="w-7 h-7"
              style={{ color: TEXT_DARK }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"/>
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"/>
              )}
            </svg>
          </button>
        </div>
        {/* Mobile Menu Overlay */}
        <div
          className={`fixed inset-0 mobile-menu flex flex-col items-center justify-center transition-all z-50
          ${mobileMenuOpen ? "opacity-100 visible" : "opacity-0 invisible pointer-events-none"}
          md:hidden`}
        >
          <div className="flex flex-col items-center space-y-7 mb-10">
            {[
              { path: "/", label: "Home" },
              { path: "/analysis", label: "Analysis" },
              { path: "/report", label: "Report" },
              { path: "/dashboard", label: "Dashboard" },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.path}
                onClick={() => setMobileMenuOpen(false)}
                className="mobile-item text-2xl font-extrabold relative"
                style={{
                  color: location.pathname === item.path ? ACCENT : TEXT_DARK,
                  letterSpacing: ".03em",
                  textShadow: location.pathname === item.path
                    ? `0 4px 20px ${ACCENT}44`
                    : `0 2px 10px #0009`,
                }}
              >
                <span
                  style={{
                    position: "relative",
                    paddingBottom: "0.08em",
                    borderBottom: location.pathname === item.path
                      ? `2.5px solid ${ACCENT}`
                      : `2.5px solid transparent`,
                    transition: "border .17s",
                  }}
                >
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
          <div className="mobile-item mobile-auth">
            {user ? (
              <div className="flex flex-col items-center space-y-4">
                <div className="avatar" tabIndex={0} style={{ width: 52, height: 52 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 28, height: 28 }}>
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <span className="font-semibold text-lg" style={{ letterSpacing: ".014em", color: TEXT_DARK }}>
                  {getUserDisplayName()}
                </span>
                <button
                  onClick={() => {
                    logout();
                    setMobileMenuOpen(false);
                  }}
                  className="btn-outline-accent"
                  style={{ width: 140, marginTop: ".3em" }}
                >Sign out</button>
              </div>
            ) : (
              <Link
                to="/signin"
                onClick={() => setMobileMenuOpen(false)}
                className="btn-accent"
                style={{ width: 150 }}
              >
                Sign In
              </Link>
            )}
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-blue-50 close-btn"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" style={{ color: TEXT_DARK }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </nav>
    </>
  );
};

export default Navbar;

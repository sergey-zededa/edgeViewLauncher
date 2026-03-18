import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';
import './TokenGuide.css';

const STEP_COUNT = 6;
const AUTO_ADVANCE_MS = 4000;

const STEPS = [
  { title: 'Log in to ZedControl', description: 'Open ZedControl in your browser and sign in with your credentials.' },
  { title: 'Click your user avatar', description: 'Find the avatar icon in the top-right corner of the dashboard.' },
  { title: 'Select "User Details"', description: 'Choose "User Details" from the dropdown menu.' },
  { title: 'Find "Session Information"', description: 'Scroll down to the Session Information section on the profile page.' },
  { title: 'Click "Request Token"', description: 'Click the "Request Token" button to generate a new API token.' },
  { title: 'Copy your token', description: 'Copy the generated token and paste it into the API Token field.' },
];

// Orange accent for ZedControl UI elements (external UI, not app theme)
const ZEDORANGE = '#E8734A';

function Scene0() {
  return (
    <svg viewBox="0 0 760 380" className="token-guide-svg">
      {/* Browser frame */}
      <rect x="30" y="10" width="700" height="360" rx="8" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1.5" />
      <rect x="30" y="10" width="700" height="32" rx="8" fill="var(--bg-tertiary)" />
      <rect x="30" y="34" width="700" height="8" fill="var(--bg-tertiary)" />
      <circle cx="52" cy="26" r="5" fill="#FF5F57" />
      <circle cx="70" cy="26" r="5" fill="#FEBC2E" />
      <circle cx="88" cy="26" r="5" fill="#28C840" />
      <rect x="200" y="18" width="360" height="16" rx="8" fill="var(--bg-secondary)" />
      <text x="380" y="30" textAnchor="middle" fontSize="9" fill="var(--text-tertiary)">zedcontrol.zededa.net</text>

      {/* Login card */}
      <rect x="250" y="90" width="260" height="240" rx="10" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" />
      <text x="380" y="125" textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--text-primary)">Sign In</text>

      <text x="275" y="158" fontSize="11" fill="var(--text-secondary)">Username</text>
      <rect x="275" y="163" width="210" height="28" rx="4" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1" />

      <text x="275" y="210" fontSize="11" fill="var(--text-secondary)">Password</text>
      <rect x="275" y="215" width="210" height="28" rx="4" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1" />

      {/* Log In button with pulse */}
      <rect x="275" y="265" width="210" height="34" rx="6" fill={ZEDORANGE} className="token-guide-pulse" />
      <text x="380" y="286" textAnchor="middle" fontSize="13" fontWeight="600" fill="white">Log In</text>
    </svg>
  );
}

function Scene1() {
  return (
    <svg viewBox="0 0 760 380" className="token-guide-svg">
      {/* Browser frame */}
      <rect x="30" y="10" width="700" height="360" rx="8" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1.5" />
      <rect x="30" y="10" width="700" height="32" rx="8" fill="var(--bg-tertiary)" />
      <rect x="30" y="34" width="700" height="8" fill="var(--bg-tertiary)" />
      <circle cx="52" cy="26" r="5" fill="#FF5F57" />
      <circle cx="70" cy="26" r="5" fill="#FEBC2E" />
      <circle cx="88" cy="26" r="5" fill="#28C840" />

      {/* Top bar */}
      <rect x="30" y="42" width="700" height="40" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="0.5" />
      <text x="60" y="67" fontSize="14" fontWeight="700" fill={ZEDORANGE}>ZEDEDA</text>
      <text x="200" y="67" fontSize="11" fill="var(--text-secondary)">Dashboard</text>
      <text x="280" y="67" fontSize="11" fill="var(--text-secondary)">Devices</text>
      <text x="350" y="67" fontSize="11" fill="var(--text-secondary)">Projects</text>

      {/* Avatar with pulse ring */}
      <circle cx="690" cy="62" r="14" fill={ZEDORANGE} />
      <text x="690" y="67" textAnchor="middle" fontSize="12" fontWeight="600" fill="white">U</text>
      <circle cx="690" cy="62" r="20" fill="none" stroke={ZEDORANGE} strokeWidth="2" className="token-guide-ring" />

      {/* Sidebar */}
      <rect x="30" y="82" width="140" height="288" fill="var(--bg-tertiary)" />
      <rect x="45" y="100" width="110" height="10" rx="3" fill="var(--border-color)" />
      <rect x="45" y="125" width="90" height="10" rx="3" fill="var(--border-color)" />
      <rect x="45" y="150" width="100" height="10" rx="3" fill="var(--border-color)" />

      {/* Content cards */}
      <rect x="190" y="100" width="240" height="120" rx="6" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" />
      <rect x="450" y="100" width="240" height="120" rx="6" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" />
      <rect x="190" y="240" width="240" height="120" rx="6" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" />
      <rect x="450" y="240" width="240" height="120" rx="6" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" />
    </svg>
  );
}

function Scene2() {
  return (
    <svg viewBox="0 0 760 380" className="token-guide-svg">
      {/* Browser frame */}
      <rect x="30" y="10" width="700" height="360" rx="8" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1.5" />
      <rect x="30" y="10" width="700" height="32" rx="8" fill="var(--bg-tertiary)" />
      <rect x="30" y="34" width="700" height="8" fill="var(--bg-tertiary)" />
      <circle cx="52" cy="26" r="5" fill="#FF5F57" />
      <circle cx="70" cy="26" r="5" fill="#FEBC2E" />
      <circle cx="88" cy="26" r="5" fill="#28C840" />

      {/* Top bar */}
      <rect x="30" y="42" width="700" height="40" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="0.5" />
      <text x="60" y="67" fontSize="14" fontWeight="700" fill={ZEDORANGE}>ZEDEDA</text>

      {/* Avatar */}
      <circle cx="690" cy="62" r="14" fill={ZEDORANGE} />
      <text x="690" y="67" textAnchor="middle" fontSize="12" fontWeight="600" fill="white">U</text>

      {/* Dropdown menu */}
      <rect x="590" y="82" width="140" height="168" rx="6" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" filter="url(#shadow2)" />

      {/* Menu items */}
      <rect x="594" y="86" width="132" height="28" rx="4" fill={ZEDORANGE} opacity="0.15" />
      <text x="610" y="105" fontSize="11" fontWeight="600" fill={ZEDORANGE}>User Details</text>
      {/* Cursor */}
      <g className="token-guide-cursor">
        <path d="M640 98 l0 14 l4 -4 l6 0 z" fill="var(--text-primary)" stroke="var(--bg-primary)" strokeWidth="0.5" />
      </g>

      <text x="610" y="133" fontSize="11" fill="var(--text-secondary)">Change Password</text>
      <text x="610" y="161" fontSize="11" fill="var(--text-secondary)">Enterprise</text>
      <text x="610" y="189" fontSize="11" fill="var(--text-secondary)">Terms &amp; Policies</text>
      <rect x="594" y="200" width="132" height="1" fill="var(--border-color)" />
      <text x="610" y="220" fontSize="11" fill="var(--text-secondary)">Log Out</text>

      {/* Dimmed background content */}
      <rect x="30" y="82" width="560" height="288" fill="var(--bg-secondary)" opacity="0.5" />

      <defs>
        <filter id="shadow2" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.15" />
        </filter>
      </defs>
    </svg>
  );
}

function Scene3() {
  return (
    <svg viewBox="0 0 760 380" className="token-guide-svg">
      {/* Browser frame */}
      <rect x="30" y="10" width="700" height="360" rx="8" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1.5" />
      <rect x="30" y="10" width="700" height="32" rx="8" fill="var(--bg-tertiary)" />
      <rect x="30" y="34" width="700" height="8" fill="var(--bg-tertiary)" />
      <circle cx="52" cy="26" r="5" fill="#FF5F57" />
      <circle cx="70" cy="26" r="5" fill="#FEBC2E" />
      <circle cx="88" cy="26" r="5" fill="#28C840" />

      {/* Top bar */}
      <rect x="30" y="42" width="700" height="40" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="0.5" />
      <text x="60" y="67" fontSize="14" fontWeight="700" fill={ZEDORANGE}>ZEDEDA</text>

      {/* Profile page content - scrolling up */}
      <g className="token-guide-scroll">
        {/* User info section */}
        <text x="80" y="110" fontSize="15" fontWeight="600" fill="var(--text-primary)">User Profile</text>
        <rect x="80" y="125" width="600" height="80" rx="6" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1" />
        <text x="100" y="150" fontSize="11" fill="var(--text-secondary)">Name</text>
        <rect x="180" y="139" width="150" height="14" rx="3" fill="var(--bg-tertiary)" />
        <text x="100" y="175" fontSize="11" fill="var(--text-secondary)">Email</text>
        <rect x="180" y="164" width="200" height="14" rx="3" fill="var(--bg-tertiary)" />

        {/* Session Information section */}
        <text x="80" y="240" fontSize="15" fontWeight="600" fill="var(--text-primary)">Session Information</text>
        <rect x="80" y="255" width="600" height="100" rx="6" fill="var(--bg-primary)" stroke={ZEDORANGE} strokeWidth="1.5" />
        <text x="100" y="280" fontSize="11" fill="var(--text-secondary)">Token Expiry</text>
        <rect x="200" y="269" width="120" height="14" rx="3" fill="var(--bg-tertiary)" />
        <text x="100" y="310" fontSize="11" fill="var(--text-secondary)">API Token</text>
        <rect x="200" y="299" width="200" height="14" rx="3" fill="var(--bg-tertiary)" />
        <rect x="500" y="295" width="120" height="28" rx="6" fill={ZEDORANGE} />
        <text x="560" y="313" textAnchor="middle" fontSize="11" fontWeight="600" fill="white">Request Token</text>
      </g>
    </svg>
  );
}

function Scene4() {
  return (
    <svg viewBox="0 0 760 380" className="token-guide-svg">
      {/* Zoomed view of Session Information */}
      <rect x="60" y="30" width="640" height="320" rx="10" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1.5" />

      <text x="100" y="70" fontSize="18" fontWeight="600" fill="var(--text-primary)">Session Information</text>
      <rect x="100" y="80" width="520" height="1" fill="var(--border-color)" />

      <text x="100" y="120" fontSize="12" fill="var(--text-secondary)">Token Expiry</text>
      <text x="250" y="120" fontSize="12" fill="var(--text-primary)">2026-03-25 14:30:00 UTC</text>

      <text x="100" y="160" fontSize="12" fill="var(--text-secondary)">Token Status</text>
      <text x="250" y="160" fontSize="12" fill="var(--text-primary)">Active</text>

      <rect x="100" y="190" width="520" height="1" fill="var(--border-color)" />

      <text x="100" y="225" fontSize="13" fill="var(--text-primary)">Generate a new API token for external integrations:</text>

      {/* Request Token button with pulse */}
      <rect x="100" y="250" width="180" height="42" rx="8" fill={ZEDORANGE} className="token-guide-pulse" />
      <text x="190" y="276" textAnchor="middle" fontSize="14" fontWeight="600" fill="white">Request Token</text>
    </svg>
  );
}

function Scene5() {
  return (
    <svg viewBox="0 0 760 380" className="token-guide-svg">
      {/* Zoomed view of Session Information - token generated */}
      <rect x="60" y="30" width="640" height="320" rx="10" fill="var(--bg-primary)" stroke="var(--border-color)" strokeWidth="1.5" />

      <text x="100" y="70" fontSize="18" fontWeight="600" fill="var(--text-primary)">Session Information</text>
      <rect x="100" y="80" width="520" height="1" fill="var(--border-color)" />

      <text x="100" y="120" fontSize="12" fill="var(--text-secondary)">Token Expiry</text>
      <text x="250" y="120" fontSize="12" fill="var(--text-primary)">2026-03-25 14:30:00 UTC</text>

      <rect x="100" y="145" width="520" height="1" fill="var(--border-color)" />

      <text x="100" y="180" fontSize="13" fontWeight="500" fill="var(--text-primary)">Your API Token</text>

      {/* Token display */}
      <rect x="100" y="195" width="520" height="60" rx="6" fill="var(--bg-tertiary)" stroke="var(--border-color)" strokeWidth="1" />
      <text x="115" y="222" fontSize="10" fontFamily="monospace" fill="var(--text-secondary)">eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...</text>
      <text x="115" y="240" fontSize="10" fontFamily="monospace" fill="var(--text-secondary)">dFlMjk2OGU4LTRkNzItNDc1YS04YWQxLTQ2...</text>

      {/* Copy button */}
      <rect x="540" y="270" width="80" height="30" rx="6" fill={ZEDORANGE} />
      <text x="580" y="290" textAnchor="middle" fontSize="12" fontWeight="600" fill="white">Copy</text>

      {/* Checkmark */}
      <g className="token-guide-check">
        <circle cx="380" y="320" r="16" fill="#28C840" opacity="0.15" />
        <circle cx="380" cy="320" r="16" fill="#28C840" opacity="0.15" />
        <path d="M370 320 l6 6 l14 -14" stroke="#28C840" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="405" y="325" fontSize="12" fontWeight="500" fill="#28C840">Copied!</text>
      </g>
    </svg>
  );
}

const SCENES = [Scene0, Scene1, Scene2, Scene3, Scene4, Scene5];

function TokenGuide({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [isOpen]);

  // Auto-advance
  useEffect(() => {
    if (!isOpen || !isPlaying) return;

    const timer = setTimeout(() => {
      setCurrentStep((prev) => {
        if (prev >= STEP_COUNT - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, AUTO_ADVANCE_MS);

    return () => clearTimeout(timer);
  }, [isOpen, isPlaying, currentStep]);

  const goTo = useCallback((step) => {
    setCurrentStep(step);
    setIsPlaying(false);
  }, []);

  const prev = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
    setIsPlaying(false);
  }, []);

  const next = useCallback(() => {
    setCurrentStep((s) => Math.min(STEP_COUNT - 1, s + 1));
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (!p && currentStep >= STEP_COUNT - 1) {
        setCurrentStep(0);
      }
      return !p;
    });
  }, [currentStep]);

  const SceneComponent = SCENES[currentStep];

  return (
    <Modal title="How to Get Your API Token" isOpen={isOpen} onDismiss={onClose} size="large">
      <div className="token-guide-content">
        <div className="token-guide-scene" key={currentStep}>
          <SceneComponent />
        </div>

        <div className="token-guide-caption">
          <span className="token-guide-step-number">Step {currentStep + 1} of {STEP_COUNT}</span>
          <span className="token-guide-step-title">{STEPS[currentStep].title}</span>
          <span className="token-guide-step-desc">{STEPS[currentStep].description}</span>
        </div>

        <div className="token-guide-nav">
          <button className="token-guide-nav-btn" onClick={prev} disabled={currentStep === 0} title="Previous step">
            <ChevronLeft size={18} />
          </button>
          <button className="token-guide-nav-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="token-guide-nav-btn" onClick={next} disabled={currentStep === STEP_COUNT - 1} title="Next step">
            <ChevronRight size={18} />
          </button>

          <div className="token-guide-dots">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <button
                key={i}
                className={`token-guide-dot ${i === currentStep ? 'active' : ''}`}
                onClick={() => goTo(i)}
                title={`Step ${i + 1}: ${STEPS[i].title}`}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default TokenGuide;

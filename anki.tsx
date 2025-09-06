import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, Download, RotateCcw, Play, Pause, SkipForward, Eye, Check, X, ThumbsUp, Repeat, Settings, Clock, Clipboard, HardDrive, Edit, Plus, Trash2, Search, Moon, Sun, BookOpen, Filter, BarChart3, FileText, HelpCircle, Brain, Zap, Target, Type, User, Menu, ChevronDown } from "lucide-react";
import jsPDF from 'jspdf';

// ---------- Utilities ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000);
const daysFromNow = (d) => new Date(Date.now() + d * 86_400_000);
const isDue = (c, ref = new Date()) => !c.dueAt || new Date(c.dueAt) <= ref;
const uid = (prefix = "c") => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
const formatDaysFromNow = (days) => days < 1 ? "in < 1 day" : days === 1 ? "tomorrow" : `in ${Math.round(days)} days`;
const previewScheduling = (card, rating) => {
  const simulated = applyRating(card, rating);
  if (!simulated.dueAt) return "Now";
  const daysUntil = (new Date(simulated.dueAt) - Date.now()) / 86_400_000;
  return formatDaysFromNow(daysUntil);
};

// Custom hook for localStorage 
function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

// CSV helpers (quoted, comma-safe)
function csvToCards(csv) {
  const rows = csv.trim().split(/\r?\n/);
  const header = rows.shift()?.split(",").map((h) => h.trim().toLowerCase()) || [];
  const fi = header.indexOf("front");
  const bi = header.indexOf("back");
  const ti = header.indexOf("tags");
  if (fi === -1 || bi === -1) throw new Error("CSV must include headers: front, back[, tags]");

  const splitCSV = (line) => {
    const out = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur); return out;
  };

  return rows.map((r) => {
    const cols = splitCSV(r).map((x) => x.replace(/^\"|\"$/g, "").trim());
    return { front: cols[fi] || "", back: cols[bi] || "", tags: (cols[ti] || "").split(";").map((t) => t.trim()).filter(Boolean) };
  });
}

function parseJSONDeck(text) {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.cards)) throw new Error("Invalid JSON deck");
  return obj;
}

function bootstrapDeck(raw, nameFallback = "My Deck") {
  const id = uid("d");
  return {
    id,
    name: raw.name || nameFallback,
    cards: raw.cards.map((c) => ({ id: uid("c"), front: c.front, back: c.back, tags: c.tags || [], ease: 2.5, reps: 0, intervalDays: 0, dueAt: null, lapses: 0, lastReviewedAt: null })),
  };
}

function sampleDeck() {
  return bootstrapDeck({
    name: "Prompt Engineering Basics",
    cards: [
      { front: "Define 'system prompt'.", back: "A high-priority instruction that sets model behavior and boundaries.", tags: ["roles"] },
      { front: "Zero-shot vs Few-shot?", back: "Zero-shot: no examples; Few-shot: with examples to steer style/format.", tags: ["technique"] },
      { front: "Purpose of temperature?", back: "Controls randomness/creativity; higher = more diverse outputs.", tags: ["params"] },
      { front: "When to use CoT?", back: "When tasks involve multi-step reasoning; ask to 'think step by step'.", tags: ["reasoning"] },
      { front: "What is Top-p?", back: "Probability mass cutoff; sample from tokens with cumulative prob ≤ p.", tags: ["params"] },
      { front: "Role vs instruction?", back: "Role sets persona; instruction is the task request.", tags: ["roles"] },
      { front: "Best time for few-shot?", back: "When enforcing output format/style with examples.", tags: ["technique"] },
      { front: "Why manage tokens?", back: "Context is limited; budget prevents truncation and drift.", tags: ["memory"] },
      { front: "Prompt injection?", back: "Malicious attempt to override system instructions via input.", tags: ["safety"] },
      { front: "One framework?", back: "OODA (Observe, Orient, Decide, Act).", tags: ["framework"] },
    ],
  });
}

// ---------- Scheduling (SM-2 lite) ----------
function applyRating(card, rating, ref = new Date()) {
  if (rating === "RepeatNow") return { ...card, dueAt: ref.toISOString() };
  const q = { Again: 1, Hard: 2, Good: 3, Easy: 4 }[rating];
  let { reps, intervalDays: interval, ease, lapses } = card;
  if (q < 3) {
    return { ...card, reps: 0, intervalDays: 0, lapses: (lapses || 0) + 1, dueAt: minutesFromNow(10).toISOString(), lastReviewedAt: ref.toISOString() };
  } else {
    if (reps === 0) interval = 1; else if (reps === 1) interval = 3; else interval = Math.round(interval * ease);
    reps += 1; ease = clamp(ease + (0.1 - (4 - q) * (0.08 + (4 - q) * 0.02)), 1.3, 2.8);
    return { ...card, reps, intervalDays: interval, ease, dueAt: daysFromNow(interval).toISOString(), lastReviewedAt: ref.toISOString() };
  }
}

// ---------- Enhanced Component with proper dark mode ----------
export default function EnhancedFlashcardsApp({ 
  initialDeck, 
  sessionLimit = 30, 
  newPerSession = 20, 
  shuffle = true, 
  storageKey = "flashcards_widget_state_canvas_v1" 
}) {
  // Theme using the accident version's approach
  const [theme, setTheme] = useLocalStorage("fc_theme", "light");
  const [lightBrightness, setLightBrightness] = useLocalStorage("fc_light_brightness", 100);
  const [darkBrightness, setDarkBrightness] = useLocalStorage("fc_dark_brightness", 100);
  const [transparencyEnabled, setTransparencyEnabled] = useLocalStorage("fc_transparency_enabled", true);
  const [transparencyLevel, setTransparencyLevel] = useLocalStorage("fc_transparency_level", 70);

  // Custom styles for candy glass effect and animations (dynamic with transparency)
  const opacity = transparencyEnabled ? (transparencyLevel / 100) : 0.15;
  const customStyles = `
    .candy-glass-text {
      filter: drop-shadow(2px 2px 0 black) drop-shadow(4px 4px 8px rgba(255,165,132,0.3));
    }
    
    .block-letters {
      font-family: 'Impact', 'Arial Black', sans-serif;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      position: relative;
    }
    
    .block-letters::before {
      content: attr(data-text);
      position: absolute;
      top: 2px;
      left: 2px;
      z-index: -1;
      color: black;
      text-shadow: none;
    }
    
    .glass-effect {
      backdrop-filter: blur(${transparencyEnabled ? '8' : '2'}px);
      background: linear-gradient(135deg, 
        rgba(59,130,246,${opacity}) 0%, 
        rgba(139,69,193,${opacity}) 25%, 
        rgba(236,72,153,${opacity}) 50%, 
        rgba(251,146,60,${opacity}) 75%, 
        rgba(34,197,94,${opacity}) 100%);
      border: 2px solid black;
      box-shadow: inset 0 1px 0 rgba(255,255,255,${opacity * 1.5}), 
                  0 8px 16px rgba(0,0,0,${opacity * 1.5});
    }
    
    .shimmer-dark:hover {
      animation: shimmer 1.5s ease-in-out infinite;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%);
      background-size: 200% 100%;
    }
    
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    
    .bordered-section {
      border: 2px solid black;
      border-radius: 8px;
      padding: 12px;
      margin: 8px 0;
      background: rgba(255,255,255,0.8);
      backdrop-filter: blur(5px);
    }
  `;

  // Core state (enhanced persistence like accident version)
  const [persist, setPersist] = useLocalStorage("fc_persist_enabled", false);
  const [decks, setDecks] = useLocalStorage("fc_decks", [initialDeck || sampleDeck()]);
  const [currentDeckId, setCurrentDeckId] = useLocalStorage("fc_current_deck_id", 0);
  const [userProfile, setUserProfile] = useLocalStorage("fc_user_profile", {
    name: "",
    avatar: "🎓",
    studyLevel: "Beginner",
    interests: [],
    preferredStudyTime: "Evening",
    motivationStyle: "Encouraging",
    theme: "Auto"
  });
  
  // Current deck derived from decks array
  const deck = decks[currentDeckId] || decks[0] || sampleDeck();
  const setDeck = (newDeck) => {
    const newDecks = [...decks];
    newDecks[currentDeckId] = newDeck;
    setDecks(newDecks);
  };
  const [stats, setStats] = useLocalStorage("fc_stats", { 
    reviewed: 0, 
    correct: 0, 
    sessionsCompleted: 0, 
    totalStudyTime: 0, 
    dailyReviews: {},
    monthlyReviews: {},
    weeklyProgress: {},
    monthlyStats: {},
    studyStreak: 0,
    streakDays: 0,
    longestStreak: 0,
    perfectDays: 0,
    averageAccuracy: 0,
    avgSessionTime: 0,
    cardsPerHour: 0,
    lastStudyDate: null,
    motivationalMilestones: []
  });
  const [options, setOptions] = useLocalStorage("fc_options", {
    sessionLimit,
    newPerSession,
    shuffle,
    autoReveal: false,
    frontTimerSec: 10,
    autoAdvance: true,
    advanceDelaySec: 0.6,
    sessionMinutes: 15,
    soundEffects: true,
    goalType: "cards", // "cards" | "time"
    goalCards: 20,
    goalMinutes: 15,
    studyMode: "normal", // "normal" | "cramming" | "test"
    showNextCard: false,
    enableUndo: true,
    weeklyGoal: 100,
    monthlyGoal: 500,
    targetAccuracy: 80,
    perfectDays: 0,
    studyReminder: true,
    reminderTime: "19:00",
    streakTarget: 7,
    difficultyTarget: "normal"
  });

  // View state
  const [currentView, setCurrentView] = useState("study"); // "study" | "deck-editor" | "stats" | "reports" | "profile" | "goals"
  
  // Session state
  const [queue, setQueue] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [frontPhase, setFrontPhase] = useState(true);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sessionRemaining, setSessionRemaining] = useState(null);
  const [isFlippingBack, setIsFlippingBack] = useState(false);
  const [studySearchQuery, setStudySearchQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [cardNotes, setCardNotes] = useLocalStorage("fc_card_notes", {});
  const [showNotes, setShowNotes] = useState(false);

  // Options state
  const [showOptions, setShowOptions] = useState(false);
  const [optTab, setOptTab] = useState("session");
  const [showHelp, setShowHelp] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [showUserProfile, setShowUserProfile] = useState(false);
  const [hoveredButton, setHoveredButton] = useState(null);
  
  // Undo state
  const [lastRatedCard, setLastRatedCard] = useState(null);
  const [lastRating, setLastRating] = useState(null);

  // Export/Import Buffers
  const [deckImportType, setDeckImportType] = useState("json");
  const [deckImportText, setDeckImportText] = useState("");
  const [deckExportJSON, setDeckExportJSON] = useState("");
  const [deckExportCSV, setDeckExportCSV] = useState("");
  const [progressImportText, setProgressImportText] = useState("");
  const [progressExportJSON, setProgressExportJSON] = useState("");

  // File input ref
  const fileInputRef = useRef();
  
  // Session refs
  const sessionEndAtRef = useRef(null);
  const sessionTickRef = useRef(null);
  
  // Audio refs for sound effects
  const correctSoundRef = useRef(null);
  const incorrectSoundRef = useRef(null);
  
  // Initialize audio
  useEffect(() => {
    if (options.soundEffects) {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      const createBeep = (frequency, duration) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration);
      };
      
      correctSoundRef.current = () => createBeep(880, 0.15); // A5 note
      incorrectSoundRef.current = () => createBeep(220, 0.3); // A3 note
    }
  }, [options.soundEffects]);

  // Deck editor state
  const [editingCardId, setEditingCardId] = useState(null);
  const [editingDeckId, setEditingDeckId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Apply theme and custom styles to document
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    
    // Apply brightness filter to the main container
    const brightness = theme === "dark" ? darkBrightness : lightBrightness;
    
    // Clear existing filters first
    const appContainer = document.querySelector('.app-main-container');
    if (appContainer) {
      // Force update the filter
      appContainer.style.filter = `brightness(${brightness}%)`;
      appContainer.style.transition = 'filter 0.3s ease';
    }
    
    // Also apply to body as additional fallback
    document.body.style.filter = `brightness(${brightness}%)`;
    document.body.style.transition = 'filter 0.3s ease';
    
    // Debug log
    console.log(`Applied brightness: ${brightness}% in ${theme} mode`);
    
    // Inject custom styles
    let styleEl = document.getElementById('custom-app-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-app-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = customStyles;
    
    return () => {
      const el = document.getElementById('custom-app-styles');
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    };
  }, [theme, lightBrightness, darkBrightness, transparencyEnabled, transparencyLevel]);

  // Keyboard shortcuts - FIXED
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (currentView !== "study" || showOptions) return;
      
      e.preventDefault();
      
      if (e.code === "Space") {
        if (frontPhase && current) {
          setFrontPhase(false);
        } else if (!frontPhase && current) {
          handleRate("Good"); // Space advances with "Good" rating, even on last card to show celebration
        }
      }
      if (e.code === "Escape") {
        setPaused(true);
      }
      if (e.code === "KeyH") {
        setShowHelp(true);
      }
      // Dev/Testing shortcut: Shift+N to quickly go to next card without rating
      if (e.code === "KeyN" && e.shiftKey && current) {
        e.preventDefault();
        nextCard();
      }
      // Dev/Testing shortcut: Shift+E to instantly end session (mark all as done)
      if (e.code === "KeyE" && e.shiftKey) {
        e.preventDefault();
        setQueue([]);
        setCurrentId(null);
        setStats(s => ({ ...s, sessionsCompleted: s.sessionsCompleted + 1 }));
      }
      if (e.code === "KeyS" && e.ctrlKey) {
        e.preventDefault();
        setShowOptions(true);
        setOptTab("session");
      }
      if (!frontPhase && current) {
        if (e.code === "Digit1") handleRate("Again");
        if (e.code === "Digit2") handleRate("Hard"); 
        if (e.code === "Digit3") handleRate("Good");
        if (e.code === "Digit4") handleRate("Easy");
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [frontPhase, currentView, showOptions, currentId, queue]);

  // Queue generation (enhanced with study modes)
  useEffect(() => {
    let cards;
    
    if (options.studyMode === "cramming") {
      // Cramming: all cards, prioritize difficult ones
      cards = [...deck.cards].sort((a, b) => (a.ease || 2.5) - (b.ease || 2.5));
    } else if (options.studyMode === "test") {
      // Test: all cards in random order
      cards = [...deck.cards].sort(() => Math.random() - 0.5);
    } else {
      // Normal: due cards + new cards
      const due = deck.cards.filter((c) => isDue(c));
      const newOnes = deck.cards.filter((c) => c.reps === 0 && c.dueAt === null).slice(0, options.newPerSession);
      cards = [...due, ...newOnes];
    }
    
    const ids = cards.map(c => c.id);
    const arr = (options.shuffle && options.studyMode === "normal") ? ids.sort(() => Math.random() - 0.5) : ids;
    setQueue(arr.slice(0, options.sessionLimit));
    setCurrentId(arr[0] || null);
    setFrontPhase(true);
  }, [deck.id, options.sessionLimit, options.newPerSession, options.shuffle, options.studyMode]);

  const current = useMemo(() => deck.cards.find((c) => c.id === currentId) || null, [deck.cards, currentId]);
  const position = useMemo(() => (currentId ? queue.indexOf(currentId) + 1 : 0), [queue, currentId]);
  const accuracy = stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0;

  // Enhanced statistics
  const sessionProgress = useMemo(() => {
    if (queue.length === 0) return 100;
    const completed = queue.indexOf(currentId) === -1 ? queue.length : queue.indexOf(currentId);
    return Math.round((completed / queue.length) * 100);
  }, [queue, currentId]);

  const deckStats = useMemo(() => {
    const total = deck.cards.length;
    const dueCount = deck.cards.filter(c => isDue(c)).length;
    const newCount = deck.cards.filter(c => c.reps === 0 && !c.dueAt).length;
    const learned = deck.cards.filter(c => c.reps >= 3).length;
    const struggling = deck.cards.filter(c => (c.lapses || 0) > 2).length;
    return { total, dueCount, newCount, learned, struggling };
  }, [deck.cards]);

  // Session timer - FIXED to not auto-start
  const startSession = () => {
    setSessionStarted(true);
    setPaused(false);
    const endAt = Date.now() + options.sessionMinutes * 60_000;
    sessionEndAtRef.current = endAt;
    setSessionRemaining(endAt - Date.now());
    
    sessionTickRef.current = window.setInterval(() => {
      const left = (sessionEndAtRef.current ?? Date.now()) - Date.now();
      setSessionRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(sessionTickRef.current);
        sessionTickRef.current = null;
        setPaused(true);
      }
    }, 250);
  };

  const pauseSession = () => {
    setPaused(true);
    if (sessionTickRef.current) {
      clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  const resumeSession = () => {
    setPaused(false);
    if (sessionEndAtRef.current && !sessionTickRef.current) {
      sessionTickRef.current = window.setInterval(() => {
        const left = (sessionEndAtRef.current ?? Date.now()) - Date.now();
        setSessionRemaining(Math.max(0, left));
        if (left <= 0) {
          clearInterval(sessionTickRef.current);
          sessionTickRef.current = null;
          setPaused(true);
        }
      }, 250);
    }
  };

  useEffect(() => () => { 
    if (sessionTickRef.current) clearInterval(sessionTickRef.current); 
  }, []);

  // Auto-reveal timer (keep existing)
  const revealTimerRef = useRef(null);
  const scheduleRevealTimer = () => {
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    if (!options.autoReveal || paused || !frontPhase) return;
    revealTimerRef.current = window.setTimeout(() => setFrontPhase(false), Math.max(0.25, options.frontTimerSec) * 1000);
  };
  useEffect(() => { scheduleRevealTimer(); }, [currentId, frontPhase, paused, options.autoReveal, options.frontTimerSec]);
  useEffect(() => () => { if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current); }, []);

  // Actions
  function nextCard(){ 
    if (!currentId) return; 
    const idx = queue.indexOf(currentId); 
    const next = queue[idx+1]; 
    if (next){ 
      setCurrentId(next); 
      setFrontPhase(true); 
    } else { 
      setCurrentId(null);
      setStats(s => ({ ...s, sessionsCompleted: s.sessionsCompleted + 1 }));
      if (sessionTickRef.current) {
        clearInterval(sessionTickRef.current);
        sessionTickRef.current = null;
      }
    } 
  }

  function handleReveal(){ 
    setFrontPhase(false); 
    if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current); 
  }

  function handleRate(r){ 
    if (!current) return; 
    
    // Save for undo before applying the rating
    setLastRatedCard({...current}); // Save the state before rating
    setLastRating(r);
    
    const updated = applyRating(current, r); 
    setDeck({ ...deck, cards: deck.cards.map((c)=>c.id===updated.id?updated:c) }); 
    const today = new Date().toISOString().split('T')[0];
    setStats((s)=>({ 
      reviewed: s.reviewed+1, 
      correct: s.correct + (r==="Good"||r==="Easy"?1:0),
      sessionsCompleted: s.sessionsCompleted,
      totalStudyTime: s.totalStudyTime,
      dailyReviews: { ...s.dailyReviews, [today]: (s.dailyReviews[today] || 0) + 1 }
    }));
    
    // Play sound effect
    if (options.soundEffects) {
      if (r === "Good" || r === "Easy") {
        correctSoundRef.current?.();
      } else if (r === "Again" || r === "Hard") {
        incorrectSoundRef.current?.();
      }
    } 
    
    if (r==="RepeatNow"){ 
      const rest = queue.filter((id)=>id!==current.id); 
      setQueue([...rest, current.id]); 
      setFrontPhase(true); 
      return; 
    } 
    
    // Start flip-back animation
    setIsFlippingBack(true);
    setTimeout(() => {
      setFrontPhase(true);
      setTimeout(() => {
        setIsFlippingBack(false);
        if (options.autoAdvance){ 
          setTimeout(()=>nextCard(), Math.max(0.2, options.advanceDelaySec)*1000); 
        } else { 
          nextCard(); 
        }
      }, 150); // Brief pause on front before next card
    }, 300); // Flip back duration
  }

  function handleUndo() {
    if (!lastRatedCard) return;
    
    // Restore the card's previous state
    setDeck({ ...deck, cards: deck.cards.map((c) => c.id === lastRatedCard.id ? lastRatedCard : c) });
    
    // Add the card back to the queue if it was removed
    if (!queue.includes(lastRatedCard.id)) {
      setQueue([...queue, lastRatedCard.id]);
    }
    
    // Go back to that card
    setCurrentId(lastRatedCard.id);
    setFrontPhase(false); // Show the back since they already saw it
    
    // Adjust stats
    const today = new Date().toISOString().split('T')[0];
    setStats((s) => ({
      reviewed: Math.max(0, s.reviewed - 1),
      correct: s.correct - (lastRating === "Good" || lastRating === "Easy" ? 1 : 0),
      sessionsCompleted: s.sessionsCompleted,
      totalStudyTime: s.totalStudyTime,
      dailyReviews: { ...s.dailyReviews, [today]: Math.max(0, (s.dailyReviews[today] || 1) - 1) }
    }));
    
    // Clear undo history
    setLastRatedCard(null);
    setLastRating(null);
  }
  
  function handleSkip(){ nextCard(); }
  
  function resetProgress() {
    if (confirm("Reset all card progress? This will clear scheduling data but keep the cards.")) {
      // Reset all card progress but keep the cards
      const resetCards = deck.cards.map(card => ({
        ...card,
        due: new Date().toISOString(),
        interval: 1,
        ease: 2.5,
        reps: 0,
        lapses: 0
      }));
      setDeck({ ...deck, cards: resetCards });
      
      // Reset stats
      setStats({ reviewed: 0, correct: 0, sessionsCompleted: 0, totalStudyTime: 0, dailyReviews: {} });
      
      // Clear current session
      setQueue([]);
      setCurrentId(null);
      setFrontPhase(true);
      setSessionStarted(false);
      sessionEndAtRef.current = null;
      setSessionRemaining(null);
      
      // Clear undo history
      setLastRatedCard(null);
      setLastRating(null);
    }
  }
  
  function resetAll() {
    if (confirm("Reset everything? This will replace the deck with sample cards and clear all progress.")) {
      setDeck(sampleDeck());
      setQueue([]);
      setCurrentId(null);
      setFrontPhase(true);
      setSessionStarted(false);
      setStats({ reviewed: 0, correct: 0, sessionsCompleted: 0, totalStudyTime: 0, dailyReviews: {} });
      sessionEndAtRef.current = null;
      setSessionRemaining(null);
      setLastRatedCard(null);
      setLastRating(null);
    }
  }

  function handleStart(){
    if (!sessionStarted) startSession();
    else resumeSession();
  }

  // Theme toggle
  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  // Reset function for brightness and other settings
  const resetSettings = () => {
    if (confirm("Reset brightness, transparency, and other visual settings? This cannot be undone.")) {
      setLightBrightness(100);
      setDarkBrightness(100);
      setTransparencyEnabled(true);
      setTransparencyLevel(70);
    }
  };

  // PDF Export functionality
  const exportProgressToPDF = () => {
    const doc = new jsPDF();
    
    // Title
    doc.setFontSize(20);
    doc.text('Flashcards Progress Report', 20, 30);
    
    // Date
    doc.setFontSize(12);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 45);
    
    // Deck Information
    doc.setFontSize(16);
    doc.text('Deck Information', 20, 65);
    doc.setFontSize(12);
    doc.text(`Name: ${deck.name}`, 20, 80);
    doc.text(`Total Cards: ${deck.cards.length}`, 20, 95);
    
    // Study Statistics
    doc.setFontSize(16);
    doc.text('Study Statistics', 20, 115);
    doc.setFontSize(12);
    doc.text(`Total Reviews: ${stats.reviewed}`, 20, 130);
    doc.text(`Accuracy: ${accuracy}%`, 20, 145);
    doc.text(`Sessions Completed: ${stats.sessionsCompleted}`, 20, 160);
    
    // Deck Stats
    doc.text(`Due Cards: ${deckStats.dueCount}`, 20, 175);
    doc.text(`New Cards: ${deckStats.newCount}`, 20, 190);
    doc.text(`Learned Cards: ${deckStats.learned}`, 20, 205);
    doc.text(`Struggling Cards: ${deckStats.struggling}`, 20, 220);
    
    // Daily Activity (last 7 days)
    doc.setFontSize(16);
    doc.text('Recent Activity', 20, 240);
    doc.setFontSize(12);
    let yPos = 255;
    const last7Days = Array.from({length: 7}, (_, i) => {
      const date = new Date(Date.now() - i * 86_400_000);
      const dateStr = date.toISOString().split('T')[0];
      const reviews = stats.dailyReviews?.[dateStr] || 0;
      return { date: date.toLocaleDateString(), reviews };
    });
    
    last7Days.reverse().forEach(day => {
      doc.text(`${day.date}: ${day.reviews} reviews`, 20, yPos);
      yPos += 15;
    });
    
    // Save the PDF
    doc.save(`flashcards-progress-${new Date().toISOString().split('T')[0]}.pdf`);
  };

  // Import/Export helpers (enhanced with file support)
  const copyText = async (s) => { 
    try{ 
      await navigator.clipboard.writeText(s); 
      alert("Copied to clipboard."); 
    }catch{ 
      alert("Copy failed. Use the textarea."); 
    } 
  };

  function generateDeckJSON(){ setDeckExportJSON(JSON.stringify(deck, null, 2)); }
  function generateDeckCSV(){
    const header = "front,back,tags\n";
    const rows = deck.cards.map(c=>{ 
      const tags=(c.tags||[]).join(";"); 
      const q=s=>`"${(s||"").replace(/"/g,'""')}"`; 
      return `${q(c.front)},${q(c.back)},${q(tags)}`; 
    }).join("\n");
    const BOM = "\uFEFF"; 
    setDeckExportCSV(BOM + header + rows);
  }
  function generateProgressJSON(){ setProgressExportJSON(JSON.stringify({ deck, stats, options }, null, 2)); }

  function importDeckFromText(){
    try{
      let deckObj;
      if (deckImportType === "json"){
        deckObj = bootstrapDeck(parseJSONDeck(deckImportText), "Imported Deck");
      } else {
        deckObj = bootstrapDeck({ name:"Imported Deck", cards: csvToCards(deckImportText) });
      }
      
      // Add the new deck to the decks array instead of replacing
      const newDecks = [...decks, deckObj];
      setDecks(newDecks);
      setCurrentDeckId(newDecks.length - 1); // Switch to the new deck
      
      setQueue([]);
      setCurrentId(null); 
      setFrontPhase(true);
      setSessionStarted(false);
      setDeckImportText("");
      sessionEndAtRef.current=null; 
      setSessionRemaining(null);
      alert(`Deck "${deckObj.name}" imported and activated!`);
    }catch(e){ 
      alert(e?.message || "Failed to import deck"); 
    }
  }
  
  // Add deck management functions
  function createNewDeck() {
    const newDeck = {
      name: `New Deck ${decks.length + 1}`,
      cards: []
    };
    const newDecks = [...decks, newDeck];
    setDecks(newDecks);
    setCurrentDeckId(newDecks.length - 1);
  }
  
  function deleteDeck(deckIndex) {
    if (decks.length <= 1) {
      alert("Cannot delete the last deck!");
      return;
    }
    const newDecks = decks.filter((_, index) => index !== deckIndex);
    setDecks(newDecks);
    if (currentDeckId >= newDecks.length) {
      setCurrentDeckId(newDecks.length - 1);
    } else if (currentDeckId === deckIndex) {
      setCurrentDeckId(0);
    }
  }

  function renameDeck(deckIndex, newName) {
    if (!newName.trim()) return;
    const newDecks = [...decks];
    newDecks[deckIndex] = { ...newDecks[deckIndex], name: newName.trim() };
    setDecks(newDecks);
  }
  
  function switchToDeck(deckIndex) {
    setCurrentDeckId(deckIndex);
    setQueue([]);
    setCurrentId(null);
    setFrontPhase(true);
    setSessionStarted(false);
  }

  // File import
  const handleFileUpload = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const deckObj = bootstrapDeck(parseJSONDeck(text), "Imported from File");
      setDeck(deckObj);
      setQueue([]);
      setCurrentId(null); 
      setFrontPhase(true);
      setSessionStarted(false);
      sessionEndAtRef.current = null; 
      setSessionRemaining(null);
      alert("Deck imported from file!");
      setCurrentView("study");
    } catch (error) {
      alert(`File import failed: ${error.message}`);
    }
  };

  function importProgressFromText(){
    try{
      const obj = JSON.parse(progressImportText);
      if (!obj || typeof obj !== 'object') throw new Error('Invalid progress JSON');
      if (!obj.deck || !obj.stats || !obj.options) throw new Error('Progress JSON must include deck, stats, options');
      setDeck(obj.deck); 
      setStats(obj.stats); 
      setOptions(obj.options);
      setQueue([]);
      setCurrentId(null); 
      setFrontPhase(true);
      setSessionStarted(false);
      sessionEndAtRef.current=null; 
      setSessionRemaining(null);
      setProgressImportText("");
      alert("Progress imported.");
    }catch(e){ 
      alert(e?.message || "Failed to import progress"); 
    }
  }

  // Deck editing functions
  const updateCard = (updatedCard) => {
    setDeck(prevDeck => ({
      ...prevDeck,
      cards: prevDeck.cards.map(c => c.id === updatedCard.id ? updatedCard : c)
    }));
  };

  const deleteCard = (cardId) => {
    if (!confirm("Delete this card?")) return;
    
    // If we're deleting the currently active card, reset session
    if (currentId === cardId) {
      setCurrentId(null);
      setQueue([]);
      setFrontPhase(true);
      setSessionStarted(false);
    }
    
    // Remove card from deck
    setDeck(prevDeck => ({
      ...prevDeck,
      cards: prevDeck.cards.filter(c => c.id !== cardId)
    }));
    
    // Update queue to remove deleted card
    setQueue(prevQueue => prevQueue.filter(id => id !== cardId));
    setEditingCardId(null);
  };

  const addCard = () => {
    const newCard = {
      id: uid("c"),
      front: "New question",
      back: "New answer", 
      tags: [],
      ease: 2.5,
      reps: 0,
      intervalDays: 0,
      dueAt: null,
      lapses: 0,
      lastReviewedAt: null
    };
    setDeck(prevDeck => ({
      ...prevDeck,
      cards: [newCard, ...prevDeck.cards]
    }));
    setEditingCardId(newCard.id);
  };

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return deck.cards;
    const query = searchQuery.toLowerCase();
    return deck.cards.filter(card => 
      card.front.toLowerCase().includes(query) ||
      card.back.toLowerCase().includes(query) ||
      card.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }, [deck.cards, searchQuery]);

  const fmtMs = (ms) => { 
    const total = Math.max(0, Math.floor(ms/1000)); 
    const m = String(Math.floor(total/60)).padStart(2,"0"); 
    const s = String(total%60).padStart(2,"0"); 
    return `${m}:${s}`; 
  };

  // UI helpers
  const Stat = ({ label, value, color = "slate" }) => (
    <div className="flex flex-col items-center p-3 rounded-xl bg-white dark:bg-slate-900 border-2 border-black">
      <div className={`text-2xl font-bold text-${color}-600 dark:text-${color}-400`}>{value}</div>
      <div className="text-xs text-slate-600 dark:text-slate-400">{label}</div>
    </div>
  );

  // DECK EDITOR VIEW
  const DeckEditorView = () => (
    <div className="rounded-2xl border-2 border-black shadow-lg bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 bordered-section">
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5" />
          <div>
            <h2 className="text-xl font-semibold">Edit Deck</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{deck.name} • {filteredCards.length} cards</p>
          </div>
        </div>
        <button
          onClick={() => setCurrentView('study')}
          className="px-4 py-2 rounded-xl bg-gradient-to-br from-orange-200 via-orange-100 to-orange-50 dark:from-orange-300 dark:via-orange-200 dark:to-orange-100 border-2 border-black shadow-md hover:shadow-lg transition-all shimmer-dark glass-effect flex items-center gap-2"
        >
          <div className="text-lg">🏠</div>
          <span className="font-medium text-slate-600 dark:text-slate-700">Home</span>
        </button>
      </div>

      <div className="p-4">
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              className="w-full pl-10 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              placeholder="Search cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button
            onClick={addCard}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 shadow-md hover:shadow-lg transition-all shimmer-dark border-2 border-black"
          >
            <Plus className="w-4 h-4" /> Add Card
          </button>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          {filteredCards.map((card) => (
            <div key={card.id} className="rounded-xl border-2 border-black p-4 bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-all">
              {editingCardId === card.id ? (
                <div className="space-y-3">
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-all"
                    placeholder="Front (question)"
                    value={card.front}
                    onChange={(e) => updateCard({ ...card, front: e.target.value })}
                  />
                  <textarea
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 min-h-[80px] resize-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    placeholder="Back (answer)"
                    value={card.back}
                    onChange={(e) => updateCard({ ...card, back: e.target.value })}
                  />
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 transition-all"
                    placeholder="Tags (comma separated)"
                    value={card.tags.join(", ")}
                    onChange={(e) => updateCard({ 
                      ...card, 
                      tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean)
                    })}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingCardId(null)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark border border-black"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingCardId(null)}
                      className="px-4 py-2 rounded-lg bg-slate-500 hover:bg-slate-600 text-white shadow-md hover:shadow-lg transition-all shimmer-dark border border-black"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteCard(card.id)}
                      className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark border border-black"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="font-medium mb-2">{card.front}</div>
                    <div className="text-slate-600 dark:text-slate-400 mb-3">{card.back}</div>
                    <div className="flex gap-2 flex-wrap">
                      {card.tags.map(tag => (
                        <span key={tag} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded-full text-xs">
                          {tag}
                        </span>
                      ))}
                      <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded-full text-xs">
                        Ease {card.ease?.toFixed(1) || "2.5"}
                      </span>
                      <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 rounded-full text-xs">
                        {card.reps || 0} reviews
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setEditingCardId(card.id)}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 shadow-sm hover:shadow-md transition-all shimmer-dark"
                  >
                    <Edit className="w-4 h-4" /> Edit
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // STATS VIEW - ENHANCED
  const StatsView = () => {
    // Calculate weekly activity
    const weeklyActivity = Array.from({length: 7}, (_, i) => {
      const date = new Date(Date.now() - i * 86_400_000);
      const dateStr = date.toISOString().split('T')[0];
      const reviews = stats.dailyReviews?.[dateStr] || 0;
      return { date: date.toLocaleDateString('en', { weekday: 'short' }), reviews, dateStr };
    }).reverse();
    
    const maxReviews = Math.max(...weeklyActivity.map(d => d.reviews), 1);
    
    return (
    <div className="rounded-2xl border-2 border-black shadow-lg bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5" />
          <div>
            <h2 className="text-xl font-semibold">Study Statistics</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">Your learning progress</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center gap-2" 
            onClick={exportProgressToPDF}
          >
            <FileText className="w-4 h-4"/>
            Export Report
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Overall Progress */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Total Cards" value={deckStats.total} color="slate" />
          <Stat label="Learned" value={deckStats.learned} color="emerald" />
          <Stat label="Due Now" value={deckStats.dueCount} color="amber" />
          <Stat label="New Cards" value={deckStats.newCount} color="blue" />
        </div>

        {/* Session Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Stat label="Reviews" value={stats.reviewed} color="indigo" />
          <Stat label="Accuracy" value={`${accuracy}%`} color="emerald" />
          <Stat label="Sessions" value={stats.sessionsCompleted} color="purple" />
        </div>

        {/* Learning Distribution */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-4">
          <h3 className="font-semibold mb-4">Card Distribution by Ease</h3>
          <div className="space-y-3">
            {[
              { range: "1.3-1.8", label: "Struggling", color: "red" },
              { range: "1.8-2.3", label: "Difficult", color: "orange" },
              { range: "2.3-2.8", label: "Moderate", color: "yellow" },
              { range: "2.8+", label: "Easy", color: "emerald" }
            ].map(({ range, label, color }) => {
              const [min, max] = range.includes('+') ? [2.8, 5] : range.split('-').map(Number);
              const count = deck.cards.filter(c => {
                const ease = c.ease || 2.5;
                return max ? ease >= min && ease < max : ease >= min;
              }).length;
              const percent = deckStats.total > 0 ? Math.round((count / deckStats.total) * 100) : 0;
              
              return (
                <div key={range} className="flex items-center gap-4">
                  <div className="w-20 text-sm text-slate-600 dark:text-slate-400">{label}</div>
                  <div className="flex-1 h-4 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-${color}-500 transition-all duration-500`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="w-16 text-sm text-slate-600 dark:text-slate-400">{count} cards</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Weekly Activity Chart */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-4">
          <h3 className="font-semibold mb-4">Weekly Activity</h3>
          <div className="h-40 flex items-end gap-2">
            {weeklyActivity.map((day, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                <div className="relative w-full flex justify-center">
                  <div 
                    className="w-full max-w-[40px] bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-lg transition-all duration-500 hover:from-indigo-700 hover:to-indigo-500"
                    style={{ height: `${(day.reviews / maxReviews) * 120 || 4}px` }}
                  >
                    {day.reviews > 0 && (
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                        {day.reviews}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400">{day.date}</div>
              </div>
            ))}
          </div>
        </div>

        {/* If there are struggling cards */}
        {deckStats.struggling > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <h4 className="font-medium text-red-800 dark:text-red-200 mb-2">Cards Needing Attention</h4>
            <p className="text-sm text-red-700 dark:text-red-300">
              {deckStats.struggling} cards have 3+ lapses. Consider reviewing the content or breaking them into smaller concepts.
            </p>
          </div>
        )}

        {/* Study Heatmap */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border-2 border-black">
          <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-4">Study Activity (Last 30 Days)</h4>
          <div className="grid grid-cols-10 gap-1">
            {Array.from({length: 30}, (_, i) => {
              const date = new Date(Date.now() - (29 - i) * 86_400_000).toISOString().split('T')[0];
              const reviews = stats.dailyReviews?.[date] || 0;
              const intensity = reviews === 0 ? 0 : Math.min(4, Math.ceil(reviews / 5));
              return (
                <div 
                  key={date} 
                  className={`w-3 h-3 rounded-sm ${
                    intensity === 0 ? 'bg-slate-100 dark:bg-slate-800' :
                    intensity === 1 ? 'bg-emerald-200 dark:bg-emerald-800' :
                    intensity === 2 ? 'bg-emerald-400 dark:bg-emerald-600' :
                    intensity === 3 ? 'bg-emerald-600 dark:bg-emerald-500' :
                    'bg-emerald-800 dark:bg-emerald-400'
                  }`}
                  title={`${date}: ${reviews} reviews`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-slate-500 dark:text-slate-400">
            <span>30 days ago</span>
            <span>Today</span>
          </div>
        </div>
      </div>
    </div>
  )
  };

  // REPORTS VIEW - COMPLETELY REBUILT FOR FULL FUNCTIONALITY
  const ReportsView = () => {
    const [selectedReportType, setSelectedReportType] = useState("overview");
    
    // Generate sample daily data for the last 30 days if none exists
    const generateSampleDailyData = () => {
      const sampleData = {};
      for (let i = 29; i >= 0; i--) {
        const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
        // Generate realistic sample data based on current stats
        const baseReviews = Math.max(1, Math.floor(stats.reviewed / 30));
        const variance = Math.random() * baseReviews;
        sampleData[date] = Math.floor(baseReviews + variance);
      }
      return sampleData;
    };

    // Generate sample weekly data
    const generateWeeklyData = () => {
      const weeklyData = [];
      const dailyData = Object.keys(stats.dailyReviews || {}).length > 0 
        ? stats.dailyReviews 
        : generateSampleDailyData();
      
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.now() - i * 86400000);
        const dateStr = date.toISOString().split('T')[0];
        const reviews = dailyData[dateStr] || 0;
        weeklyData.push({
          day: date.toLocaleDateString('en', { weekday: 'short' }),
          date: dateStr,
          reviews: reviews,
          accuracy: reviews > 0 ? Math.max(60, accuracy + (Math.random() * 20 - 10)) : 0
        });
      }
      return weeklyData;
    };

    const generateReport = (format) => {
      try {
        if (format === 'pdf') {
          exportProgressToPDF();
        } else if (format === 'json') {
          const reportData = {
            reportGenerated: new Date().toISOString(),
            deckInfo: {
              name: deck.name,
              totalCards: deckStats.total,
              learnedCards: deckStats.learned,
              dueCards: deckStats.dueCount,
              newCards: deckStats.newCount
            },
            studyStats: {
              totalReviews: stats.reviewed || 0,
              accuracy: accuracy || 0,
              sessionsCompleted: stats.sessionsCompleted || 0,
              streakDays: stats.streakDays || 0,
              avgSessionTime: stats.avgSessionTime || 0,
              dailyReviews: stats.dailyReviews || {},
              monthlyReviews: stats.monthlyReviews || {}
            },
            goals: {
              dailyGoal: options.goalCards || 20,
              weeklyGoal: options.weeklyGoal || 100,
              monthlyGoal: options.monthlyGoal || 500,
              targetAccuracy: options.targetAccuracy || 80
            },
            userProfile: {
              name: userProfile.name || "Student",
              studyLevel: userProfile.studyLevel || "Beginner",
              preferredTime: userProfile.preferredStudyTime || "Evening"
            }
          };
          
          const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `flashcards-report-${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          alert('📊 Detailed JSON report exported successfully!');
        } else if (format === 'csv') {
          // Generate CSV report
          const csvData = [
            ['Date', 'Reviews', 'Accuracy', 'Session Time'],
            ...Object.entries(stats.dailyReviews || {}).map(([date, reviews]) => [
              date, reviews, `${accuracy}%`, '15 min'
            ])
          ];
          
          const csvContent = csvData.map(row => row.join(',')).join('\n');
          const blob = new Blob([csvContent], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `flashcards-data-${new Date().toISOString().split('T')[0]}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          
          alert('📈 CSV data exported successfully!');
        }
      } catch (error) {
        alert(`Export failed: ${error.message}`);
      }
    };

    const weeklyData = generateWeeklyData();
    const maxWeeklyReviews = Math.max(...weeklyData.map(d => d.reviews), 1);

    return (
      <div className="rounded-2xl border-2 border-black shadow-lg bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-xl font-semibold">Study Reports</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Comprehensive progress analysis and insights</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentView('profile')}
              className="px-4 py-2 rounded-xl bg-gradient-to-br from-slate-200 via-slate-100 to-slate-50 dark:from-slate-600 dark:via-slate-500 dark:to-slate-400 border-2 border-black shadow-md hover:shadow-lg transition-all shimmer-dark glass-effect flex items-center gap-2"
            >
              <div className="text-lg">⬅️</div>
              <span className="font-medium text-slate-800 dark:text-slate-900">Back</span>
            </button>
            <button
              onClick={() => setCurrentView('study')}
              className="px-4 py-2 rounded-xl bg-gradient-to-br from-orange-200 via-orange-100 to-orange-50 dark:from-orange-300 dark:via-orange-200 dark:to-orange-100 border-2 border-black shadow-md hover:shadow-lg transition-all shimmer-dark glass-effect flex items-center gap-2"
            >
              <div className="text-lg">🏠</div>
              <span className="font-medium text-slate-600 dark:text-slate-700">Home</span>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Report Type Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[
              { key: "overview", label: "Overview", icon: "📊" },
              { key: "charts", label: "Progress Charts", icon: "📈" },
              { key: "insights", label: "Study Insights", icon: "🧠" }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedReportType(tab.key)}
                className={`px-4 py-2 rounded-xl whitespace-nowrap flex items-center gap-2 transition-all ${
                  selectedReportType === tab.key
                    ? 'bg-emerald-600 text-white shadow-lg'
                    : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {selectedReportType === "overview" && (
            <div className="space-y-6">
              {/* Key Metrics */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="text-2xl">🎯</span>
                  Performance Summary
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-lg">
                    <div className="text-3xl font-bold text-indigo-600">{stats.reviewed || 0}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Total Reviews</div>
                    <div className="text-xs text-indigo-600 mt-1">
                      Goal: {options.goalCards || 20} daily
                    </div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-lg">
                    <div className="text-3xl font-bold text-emerald-600">{accuracy || 0}%</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Accuracy Rate</div>
                    <div className="text-xs text-emerald-600 mt-1">
                      Target: {options.targetAccuracy || 80}%
                    </div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 rounded-lg">
                    <div className="text-3xl font-bold text-purple-600">{stats.streakDays || 0}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Study Streak</div>
                    <div className="text-xs text-purple-600 mt-1">
                      🔥 {stats.streakDays >= 7 ? "On fire!" : "Keep going!"}
                    </div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg">
                    <div className="text-3xl font-bold text-amber-600">{deckStats.learned || 0}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Cards Mastered</div>
                    <div className="text-xs text-amber-600 mt-1">
                      {Math.round(((deckStats.learned || 0) / (deckStats.total || 1)) * 100)}% of deck
                    </div>
                  </div>
                </div>
              </div>

              {/* Progress Indicators */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                <h3 className="text-lg font-semibold mb-4">Goal Progress</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Daily Reviews</span>
                      <span>{stats.reviewed || 0} / {options.goalCards || 20}</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-indigo-500 to-indigo-400 h-3 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(100, ((stats.reviewed || 0) / (options.goalCards || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span>Accuracy Target</span>
                      <span>{accuracy || 0}% / {options.targetAccuracy || 80}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-3 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(100, ((accuracy || 0) / (options.targetAccuracy || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Charts Tab */}
          {selectedReportType === "charts" && (
            <div className="space-y-6">
              {/* Weekly Activity Chart */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="text-2xl">📊</span>
                  Weekly Activity Overview
                </h3>
                <div className="h-64 flex items-end gap-3 px-4">
                  {weeklyData.map((day, idx) => (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                      <div className="relative w-full flex justify-center">
                        <div 
                          className="w-full max-w-[40px] bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-lg transition-all duration-500 hover:from-emerald-700 hover:to-emerald-500 cursor-pointer"
                          style={{ height: `${(day.reviews / maxWeeklyReviews) * 200 || 8}px` }}
                          title={`${day.day}: ${day.reviews} reviews, ${Math.round(day.accuracy)}% accuracy`}
                        >
                          {day.reviews > 0 && (
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 px-2 py-1 rounded shadow">
                              {day.reviews}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 font-medium">{day.day}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-4 text-xs text-slate-500 dark:text-slate-400">
                  <span>7 days ago</span>
                  <span className="bg-emerald-100 dark:bg-emerald-900/30 px-2 py-1 rounded text-emerald-700 dark:text-emerald-300">
                    Total: {weeklyData.reduce((sum, day) => sum + day.reviews, 0)} reviews this week
                  </span>
                  <span>Today</span>
                </div>
              </div>

              {/* Deck Progress Pie Chart Visualization */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="text-2xl">🍰</span>
                  Deck Mastery Distribution
                </h3>
                <div className="flex items-center justify-center">
                  <div className="relative w-48 h-48">
                    {/* Simple circular progress visualization */}
                    <div className="absolute inset-0 rounded-full bg-slate-200 dark:bg-slate-700"></div>
                    <div 
                      className="absolute inset-0 rounded-full border-8 border-emerald-500 border-transparent"
                      style={{
                        background: `conic-gradient(#10b981 ${((deckStats.learned || 0) / (deckStats.total || 1)) * 360}deg, #e2e8f0 0deg)`
                      }}
                    ></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-emerald-600">
                          {Math.round(((deckStats.learned || 0) / (deckStats.total || 1)) * 100)}%
                        </div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Mastered</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-6">
                  <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <div className="text-lg font-bold text-emerald-600">{deckStats.learned || 0}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Learned Cards</div>
                  </div>
                  <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                    <div className="text-lg font-bold text-amber-600">{deckStats.dueCount || 0}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Due for Review</div>
                  </div>
                </div>
              </div>
            </div>
          )}


          {/* Insights Tab */}
          {selectedReportType === "insights" && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="text-2xl">🧠</span>
                  Study Insights & Recommendations
                </h3>
                
                <div className="space-y-4">
                  {/* Performance Analysis */}
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">📈 Performance Analysis</h4>
                    <div className="text-sm text-blue-700 dark:text-blue-300">
                      {accuracy >= 90 ? (
                        "Excellent! Your accuracy is outstanding. Consider increasing your daily goal to challenge yourself more."
                      ) : accuracy >= 75 ? (
                        "Good progress! Your accuracy is solid. Focus on consistency to improve further."
                      ) : (
                        "Room for improvement. Consider reviewing cards more frequently and taking your time with difficult concepts."
                      )}
                    </div>
                  </div>

                  {/* Study Habits */}
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                    <h4 className="font-semibold text-emerald-800 dark:text-emerald-200 mb-2">⏰ Study Habits</h4>
                    <div className="text-sm text-emerald-700 dark:text-emerald-300">
                      {stats.streakDays >= 7 ? (
                        "🔥 Amazing consistency! You've maintained a great study streak. Keep up the excellent habit!"
                      ) : stats.streakDays >= 3 ? (
                        "Good momentum building! Try to study a little each day to build a stronger routine."
                      ) : (
                        "Building consistency is key. Set a small, achievable daily goal to establish a study habit."
                      )}
                    </div>
                  </div>

                  {/* Card Mastery */}
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                    <h4 className="font-semibold text-purple-800 dark:text-purple-200 mb-2">🎯 Card Mastery</h4>
                    <div className="text-sm text-purple-700 dark:text-purple-300">
                      {deckStats.learned >= deckStats.total * 0.8 ? (
                        "Outstanding! You've mastered most of your deck. Consider adding new cards or reviewing challenging ones."
                      ) : deckStats.learned >= deckStats.total * 0.5 ? (
                        "Great progress! You're halfway through mastering your deck. Keep up the steady work."
                      ) : (
                        "Plenty of learning opportunities ahead! Focus on the cards you find most challenging."
                      )}
                    </div>
                  </div>

                  {/* Personalized Tips */}
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-2">💡 Personalized Tips</h4>
                    <div className="text-sm text-amber-700 dark:text-amber-300">
                      Based on your {userProfile.studyLevel} level and {userProfile.motivationStyle} style:
                      <ul className="mt-2 space-y-1">
                        <li>• Study during your preferred {userProfile.preferredStudyTime?.toLowerCase()} hours</li>
                        <li>• {userProfile.studyLevel === 'Beginner' ? 'Start with shorter sessions (10-15 min)' : 'Challenge yourself with longer study sessions'}</li>
                        <li>• {userProfile.motivationStyle === 'Encouraging' ? 'Celebrate small wins!' : 'Track your progress analytically'}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // REPORT AND ANALYSIS CENTER - COMPREHENSIVE PROGRESS INSIGHTS
  const ReportAnalysisCenter = () => {
    return (
      <div className="rounded-2xl border-2 border-black shadow-lg bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="text-2xl">📊</div>
            <div>
              <h2 className="text-xl font-semibold">Report & Analysis Center</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Comprehensive progress analysis and insights</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Executive Summary Export - Top Priority */}
          <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
              <FileText className="w-5 h-5"/>
              📋 Executive Summary Reports
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Generate professional, portfolio-ready reports showcasing your learning progress and achievements.
            </p>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
              <button 
                className="px-4 py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2 text-sm font-medium" 
                onClick={exportProgressToPDF}
              >
                <FileText className="w-4 h-4"/>
                PDF Report
              </button>
              <button 
                className="px-4 py-3 rounded-lg bg-orange-600 hover:bg-orange-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2 text-sm font-medium" 
                onClick={() => {
                  const htmlReport = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                      <title>PRCM™️ Learning Progress Report</title>
                      <style>
                        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
                        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; }
                        .number { font-size: 2em; font-weight: bold; color: #4f46e5; }
                      </style>
                    </head>
                    <body>
                      <div class="header">
                        <h1>PRCM™️ Rapid Learning System</h1>
                        <h2>Progress Report</h2>
                        <p>Generated: ${new Date().toLocaleDateString()}</p>
                        <p>Student: ${userProfile.name || 'Student'}</p>
                      </div>
                      <div class="stat-grid">
                        <div class="stat-card">
                          <div class="number">${stats.reviewed || 0}</div>
                          <div>Cards Reviewed</div>
                        </div>
                        <div class="stat-card">
                          <div class="number">${stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0}%</div>
                          <div>Accuracy Rate</div>
                        </div>
                        <div class="stat-card">
                          <div class="number">${stats.studyStreak || 0}</div>
                          <div>Current Streak</div>
                        </div>
                        <div class="stat-card">
                          <div class="number">${Math.round((stats.totalStudyTime || 0) / 60)}</div>
                          <div>Minutes Studied</div>
                        </div>
                      </div>
                      <h3>Active Deck: ${deck.name}</h3>
                      <p>Total Cards: ${deck.cards.length}</p>
                      <p>Sessions Completed: ${stats.sessionsCompleted || 0}</p>
                    </body>
                    </html>
                  `;
                  const blob = new Blob([htmlReport], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `prcm-report-${new Date().toISOString().split('T')[0]}.html`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <FileText className="w-4 h-4"/>
                HTML Report
              </button>
              <button 
                className="px-4 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2 text-sm font-medium" 
                onClick={() => {
                  const csvData = [
                    ['Metric', 'Value'],
                    ['Student Name', userProfile.name || 'Student'],
                    ['Report Date', new Date().toLocaleDateString()],
                    ['Active Deck', deck.name],
                    ['Total Cards', deck.cards.length],
                    ['Cards Reviewed', stats.reviewed || 0],
                    ['Accuracy Rate', `${stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0}%`],
                    ['Current Streak', stats.studyStreak || 0],
                    ['Minutes Studied', Math.round((stats.totalStudyTime || 0) / 60)],
                    ['Sessions Completed', stats.sessionsCompleted || 0]
                  ];
                  const csvContent = csvData.map(row => row.join(',')).join('\\n');
                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `prcm-stats-${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <BarChart3 className="w-4 h-4"/>
                CSV Stats
              </button>
              <button 
                className="px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2 text-sm font-medium" 
                onClick={() => {
                  const summaryData = {
                    student: userProfile.name || 'Student',
                    reportDate: new Date().toISOString(),
                    deck: {
                      name: deck.name,
                      totalCards: deck.cards.length
                    },
                    performance: {
                      cardsReviewed: stats.reviewed || 0,
                      accuracyRate: stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0,
                      currentStreak: stats.studyStreak || 0,
                      minutesStudied: Math.round((stats.totalStudyTime || 0) / 60),
                      sessionsCompleted: stats.sessionsCompleted || 0
                    },
                    goals: {
                      dailyCards: options.goalCards || 0,
                      dailyMinutes: options.goalMinutes || 0,
                      targetAccuracy: options.targetAccuracy || 0
                    }
                  };
                  const blob = new Blob([JSON.stringify(summaryData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `prcm-summary-${new Date().toISOString().split('T')[0]}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="w-4 h-4"/>
                JSON Summary
              </button>
            </div>
          </div>

          {/* Detailed Progress Analytics */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5"/>
              📈 Detailed Progress Analytics
            </h3>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.reviewed || 0}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Total Reviews</div>
              </div>
              <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0}%</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Accuracy Rate</div>
              </div>
              <div className="text-center p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{stats.studyStreak || 0}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Day Streak</div>
              </div>
              <div className="text-center p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">{Math.round((stats.totalStudyTime || 0) / 60)}</div>
                <div className="text-sm text-slate-600 dark:text-slate-400">Minutes Studied</div>
              </div>
            </div>

          </div>

        </div>
      </div>
    );
  };

  // PROFILE VIEW - PERSONALIZATION SYSTEM
  const ProfileView = () => {
    const [editMode, setEditMode] = useState(false);
    const [tempProfile, setTempProfile] = useState(userProfile);
    const [photoUpload, setPhotoUpload] = useState(null);
    const [profileTab, setProfileTab] = useState("profile"); // "profile" | "goals" | "stats" | "analysis"
    const photoInputRef = useRef(null);

    const saveProfile = () => {
      setUserProfile(tempProfile);
      setEditMode(false);
    };

    const cancelEdit = () => {
      setTempProfile(userProfile);
      setEditMode(false);
      setPhotoUpload(null);
    };

    const handlePhotoUpload = (event) => {
      const file = event.target.files?.[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
          alert('Photo size must be under 5MB');
          return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
          const photoData = e.target?.result;
          setTempProfile({...tempProfile, photo: photoData});
          setPhotoUpload(photoData);
        };
        reader.readAsDataURL(file);
      }
    };

    const removePhoto = () => {
      setTempProfile({...tempProfile, photo: null});
      setPhotoUpload(null);
      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }
    };

    const avatarOptions = ['🎓', '📚', '🧠', '⚡', '🎯', '🔥', '💎', '🌟', '🚀', '🎨', '🔬', '💡'];
    const studyLevels = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
    const studyTimes = ['Morning', 'Afternoon', 'Evening', 'Night', 'Flexible'];
    const motivationStyles = ['Encouraging', 'Challenging', 'Analytical', 'Casual', 'Formal'];
    const themes = ['Auto', 'Light', 'Dark'];

    return (
      <div className="rounded-2xl border-2 border-black shadow-lg bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="text-2xl">{userProfile.avatar || "👤"}</div>
            <div>
              <h2 className="text-xl font-semibold">User Profile</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Personalize your study experience</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentView('study')}
              className="px-4 py-2 rounded-xl bg-gradient-to-br from-orange-200 via-orange-100 to-orange-50 dark:from-orange-300 dark:via-orange-200 dark:to-orange-100 border-2 border-black shadow-md hover:shadow-lg transition-all shimmer-dark glass-effect flex items-center gap-2"
            >
              <div className="text-lg">🏠</div>
              <span className="font-medium text-slate-600 dark:text-slate-700">Home</span>
            </button>
            <div className="flex gap-2">
            {editMode ? (
              <>
                <button
                  onClick={saveProfile}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark"
                >
                  Save Changes
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-4 py-2 rounded-xl bg-slate-600 hover:bg-slate-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center gap-2"
              >
                <Edit className="w-4 h-4" />
                Edit Profile
              </button>
            )}
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Tab Navigation */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black overflow-hidden">
            <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 p-1">
              <button
                onClick={() => setProfileTab("profile")}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 rounded-lg border-2 shimmer-dark ${
                  profileTab === "profile"
                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 border-blue-400 shadow-lg transform scale-105"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600"
                }`}
              >
                👤 Profile Settings
              </button>
              <button
                onClick={() => setProfileTab("goals")}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 rounded-lg border-2 shimmer-dark ${
                  profileTab === "goals"
                    ? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-400 shadow-lg transform scale-105"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600"
                }`}
              >
                🎯 Study Goals
              </button>
              <button
                onClick={() => setProfileTab("stats")}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 rounded-lg border-2 shimmer-dark ${
                  profileTab === "stats"
                    ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 border-indigo-400 shadow-lg transform scale-105"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600"
                }`}
              >
                📊 Statistics
              </button>
              <button
                onClick={() => setProfileTab("analysis")}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 rounded-lg border-2 shimmer-dark ${
                  profileTab === "analysis"
                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 border-emerald-400 shadow-lg transform scale-105"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600"
                }`}
              >
                📈 Analysis
              </button>
              <button
                onClick={() => setProfileTab("reports")}
                className={`flex-1 px-3 py-2 text-xs font-medium transition-all duration-300 rounded-lg border-2 shimmer-dark ${
                  profileTab === "reports"
                    ? "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 border-purple-400 shadow-lg transform scale-105"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-400 dark:hover:border-slate-600"
                }`}
              >
                📋 Study Reports
              </button>
            </div>

            <div className="p-6">
              {profileTab === "profile" && (
                <div className="space-y-6">
                  {/* Profile Header */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6 text-center">
                    {/* Profile Photo/Avatar Display */}
                    <div className="mb-4">
                      {(editMode ? (tempProfile.photo || photoUpload) : userProfile.photo) ? (
                        <div className="relative inline-block">
                          <img 
                            src={editMode ? (photoUpload || tempProfile.photo) : userProfile.photo} 
                            alt="Profile" 
                            className="w-24 h-24 rounded-full object-cover mx-auto border-4 border-slate-200 dark:border-slate-700"
                          />
                          {editMode && (
                            <button
                              onClick={removePhoto}
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 flex items-center justify-center"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-6xl">{editMode ? tempProfile.avatar : userProfile.avatar}</div>
                      )}
                    </div>
                    
                    {editMode ? (
                      <div className="space-y-4">
                        <input
                          type="text"
                          value={tempProfile.name}
                          onChange={(e) => setTempProfile({...tempProfile, name: e.target.value})}
                          placeholder="Enter your name"
                          className="w-full px-3 py-2 rounded-lg border-2 border-black bg-white dark:bg-slate-800 text-center text-lg font-semibold"
                        />
                        
                        {/* Photo Upload Section */}
                        <div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Profile Photo</p>
                          <div className="flex flex-col items-center gap-2">
                            <input
                              ref={photoInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handlePhotoUpload}
                              className="hidden"
                            />
                            <button
                              onClick={() => photoInputRef.current?.click()}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shimmer-dark"
                            >
                              📷 Upload Photo
                            </button>
                            {(tempProfile.photo || photoUpload) && (
                              <button
                                onClick={removePhoto}
                                className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 transition-colors shimmer-dark"
                              >
                                Remove Photo
                              </button>
                            )}
                          </div>
                        </div>
                        
                        {/* Avatar Selection */}
                        <div>
                          <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">Or Choose Avatar</p>
                          <div className="grid grid-cols-6 gap-2">
                            {avatarOptions.map(avatar => (
                              <button
                                key={avatar}
                                onClick={() => setTempProfile({...tempProfile, avatar})}
                                className={`text-2xl p-2 rounded-lg border-2 transition-all ${
                                  tempProfile.avatar === avatar 
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                }`}
                              >
                                {avatar}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h3 className="text-xl font-semibold mb-2">{userProfile.name || "Learning Enthusiast"}</h3>
                        <p className="text-slate-600 dark:text-slate-400">
                          {userProfile.studyLevel} • {userProfile.preferredStudyTime} Learner
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Study Preferences */}
                  <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                    <h3 className="text-lg font-semibold mb-4">Study Preferences</h3>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium mb-2">Study Level</label>
                        <select
                          value={editMode ? tempProfile.studyLevel : userProfile.studyLevel}
                          onChange={(e) => editMode && setTempProfile({...tempProfile, studyLevel: e.target.value})}
                          disabled={!editMode}
                          className="w-full px-3 py-2 border-2 border-black rounded-lg bg-white dark:bg-slate-800 disabled:opacity-60"
                        >
                          {studyLevels.map(level => (
                            <option key={level} value={level}>{level}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Preferred Study Time</label>
                        <select
                          value={editMode ? tempProfile.preferredStudyTime : userProfile.preferredStudyTime}
                          onChange={(e) => editMode && setTempProfile({...tempProfile, preferredStudyTime: e.target.value})}
                          disabled={!editMode}
                          className="w-full px-3 py-2 border-2 border-black rounded-lg bg-white dark:bg-slate-800 disabled:opacity-60"
                        >
                          {studyTimes.map(time => (
                            <option key={time} value={time}>{time}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Motivation Style</label>
                        <select
                          value={editMode ? tempProfile.motivationStyle : userProfile.motivationStyle}
                          onChange={(e) => editMode && setTempProfile({...tempProfile, motivationStyle: e.target.value})}
                          disabled={!editMode}
                          className="w-full px-3 py-2 border-2 border-black rounded-lg bg-white dark:bg-slate-800 disabled:opacity-60"
                        >
                          {motivationStyles.map(style => (
                            <option key={style} value={style}>{style}</option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium mb-2">Theme Preference</label>
                        <select
                          value={editMode ? tempProfile.themePreference : userProfile.themePreference}
                          onChange={(e) => editMode && setTempProfile({...tempProfile, themePreference: e.target.value})}
                          disabled={!editMode}
                          className="w-full px-3 py-2 border-2 border-black rounded-lg bg-white dark:bg-slate-800 disabled:opacity-60"
                        >
                          {themes.map(themeOpt => (
                            <option key={themeOpt} value={themeOpt}>{themeOpt}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Study Stats Summary */}
                  <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 dark:from-indigo-500/20 dark:to-purple-500/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-6">
                    <h3 className="text-lg font-semibold mb-4">Your Study Journey</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-indigo-600">{stats.reviewed}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Cards Mastered</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-emerald-600">{Math.round(accuracy)}%</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Success Rate</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-amber-600">{stats.streakDays}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Day Streak</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-600">{decks.length}</div>
                        <div className="text-sm text-slate-600 dark:text-slate-400">Study Decks</div>
                      </div>
                    </div>
                  </div>

                  {/* Personalized Motivation */}
                  <div className="bg-gradient-to-r from-orange-500/10 to-red-500/10 dark:from-orange-500/20 dark:to-red-500/20 rounded-xl border border-orange-200 dark:border-orange-800 p-6">
                    <h3 className="text-lg font-semibold mb-3">Personal Message</h3>
                    <p className="text-slate-700 dark:text-slate-300">
                      {userProfile.motivationStyle === 'Encouraging' && `Great work, ${userProfile.name || "Student"}! You're making excellent progress on your learning journey. Keep up the fantastic effort! 🌟`}
                      {userProfile.motivationStyle === 'Challenging' && `${userProfile.name || "Student"}, you've got ${deckStats.dueCount} cards waiting. Time to push your limits and master new knowledge! 🔥`}
                      {userProfile.motivationStyle === 'Analytical' && `Analysis shows you've completed ${stats.reviewed} reviews with ${accuracy}% accuracy, ${userProfile.name || "Student"}. Optimize your next session! 📊`}
                      {userProfile.motivationStyle === 'Casual' && `Hey ${userProfile.name || "Student"}! Ready for another study session? Let's tackle those cards together! 😊`}
                      {userProfile.motivationStyle === 'Formal' && `Good ${userProfile.preferredStudyTime?.toLowerCase()}, ${userProfile.name || "Student"}. Your dedicated study approach shows consistent improvement. Continue with your structured learning plan.`}
                    </p>
                  </div>

                </div>
              )}

              {profileTab === "goals" && (
                <div>
                  <GoalsView />
                </div>
              )}

              {profileTab === "stats" && (
                <div>
                  <StatsView />
                </div>
              )}

              {profileTab === "analysis" && (
                <div>
                  <ReportAnalysisCenter />
                </div>
              )}

              {profileTab === "reports" && (
                <div>
                  <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                    <div className="text-center mb-6">
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">📋 Study Reports</h2>
                      <p className="text-slate-600 dark:text-slate-400">Comprehensive progress analysis and insights</p>
                    </div>
                    
                    <div className="space-y-4">
                      <button
                        onClick={() => setCurrentView("reports")}
                        className="w-full px-6 py-4 rounded-xl bg-gradient-to-br from-purple-100 via-purple-50 to-white dark:from-purple-800 dark:via-purple-700 dark:to-purple-600 border-2 border-black shadow-md hover:shadow-lg transition-all shimmer-dark glass-effect flex items-center justify-center gap-3"
                      >
                        <FileText className="w-5 h-5"/>
                        <span className="font-medium">View Detailed Study Reports</span>
                      </button>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">📊 Performance Analysis</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400">Track your learning progress and identify areas for improvement</p>
                        </div>
                        
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">📈 Learning Trends</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400">Visualize your study patterns and retention rates over time</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // GOALS VIEW - DEDICATED STUDY GOALS PAGE
  const GoalsView = () => {
    const [selectedGoalType, setSelectedGoalType] = useState("daily");
    
    // Calculate goal progress
    const dailyProgress = Math.min(100, (stats.reviewed / (options.goalCards || 1)) * 100);
    const weeklyProgress = Math.min(100, ((stats.reviewed * 7) / (options.weeklyGoal || 1)) * 100);
    const monthlyProgress = Math.min(100, ((stats.reviewed * 30) / (options.monthlyGoal || 1)) * 100);
    const accuracyProgress = Math.min(100, (accuracy / (options.targetAccuracy || 1)) * 100);
    const streakProgress = Math.min(100, (stats.streakDays / (options.streakTarget || 1)) * 100);
    
    // Achievement system
    const achievements = [
      { 
        id: "first_card", 
        title: "First Steps", 
        description: "Review your first card", 
        unlocked: stats.reviewed >= 1,
        icon: "🌟"
      },
      { 
        id: "daily_goal", 
        title: "Daily Warrior", 
        description: `Complete ${options.goalCards} reviews in a day`, 
        unlocked: stats.reviewed >= options.goalCards,
        icon: "🎯"
      },
      { 
        id: "accuracy_master", 
        title: "Accuracy Master", 
        description: `Achieve ${options.targetAccuracy}% accuracy`, 
        unlocked: accuracy >= options.targetAccuracy,
        icon: "🎖️"
      },
      { 
        id: "streak_keeper", 
        title: "Streak Keeper", 
        description: `Study for ${options.streakTarget} consecutive days`, 
        unlocked: stats.streakDays >= options.streakTarget,
        icon: "🔥"
      },
      { 
        id: "century_club", 
        title: "Century Club", 
        description: "Review 100 cards total", 
        unlocked: stats.reviewed >= 100,
        icon: "💯"
      },
      { 
        id: "perfectionist", 
        title: "Perfectionist", 
        description: "Achieve 100% accuracy in a session", 
        unlocked: options.perfectDays >= 1,
        icon: "💎"
      }
    ];
    
    const unlockedCount = achievements.filter(a => a.unlocked).length;

    return (
      <div className="rounded-2xl border-2 border-black shadow-lg bg-slate-50/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🎯</div>
            <div>
              <h2 className="text-xl font-semibold">Study Goals</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">Track your progress and achievements</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Goal Type Selector */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {[
              { key: "daily", label: "Daily Goals", icon: "☀️" },
              { key: "weekly", label: "Weekly Goals", icon: "📅" },
              { key: "monthly", label: "Monthly Goals", icon: "🗓️" },
              { key: "achievements", label: "Achievements", icon: "🏆" }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setSelectedGoalType(tab.key)}
                className={`px-4 py-2 rounded-xl whitespace-nowrap flex items-center gap-2 transition-all shimmer-dark ${
                  selectedGoalType === tab.key
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Daily Goals */}
          {selectedGoalType === "daily" && (
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Daily Review Goal */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl">📚</div>
                      <div>
                        <h3 className="font-semibold">Daily Reviews</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Cards to review each day</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-indigo-600">{stats.reviewed}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">/ {options.goalCards}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-indigo-500 to-indigo-400 h-3 rounded-full transition-all duration-1000"
                        style={{ width: `${dailyProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>{Math.round(dailyProgress)}% Complete</span>
                      <span>{Math.max(0, options.goalCards - stats.reviewed)} remaining</span>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Daily Goal</label>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={options.goalCards}
                      onChange={(e) => setOptions({...options, goalCards: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>

                {/* Accuracy Goal */}
                <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="text-2xl">🎯</div>
                      <div>
                        <h3 className="font-semibold">Accuracy Target</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Target accuracy percentage</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-emerald-600">{accuracy}%</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">/ {options.targetAccuracy}%</div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                      <div 
                        className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-3 rounded-full transition-all duration-1000"
                        style={{ width: `${accuracyProgress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>{Math.round(accuracyProgress)}% of Target</span>
                      <span className={accuracy >= options.targetAccuracy ? "text-emerald-600" : ""}>
                        {accuracy >= options.targetAccuracy ? "Goal Achieved!" : "Keep Going!"}
                      </span>
                    </div>
                  </div>
                  
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Target Accuracy (%)</label>
                    <input
                      type="number"
                      min="50"
                      max="100"
                      value={options.targetAccuracy}
                      onChange={(e) => setOptions({...options, targetAccuracy: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* Today's Progress Summary */}
              <div className="bg-gradient-to-r from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20 rounded-xl border border-blue-200 dark:border-blue-800 p-6">
                <h3 className="text-lg font-semibold mb-4">Today's Progress</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{stats.reviewed}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Cards Reviewed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-600">{accuracy}%</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Accuracy</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">{stats.streakDays}</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Day Streak</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-amber-600">{Math.round(dailyProgress)}%</div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">Daily Goal</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Weekly Goals */}
          {selectedGoalType === "weekly" && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
              <h3 className="text-lg font-semibold mb-4">Weekly Targets</h3>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Weekly Review Goal</span>
                    <span className="text-lg font-bold">{stats.reviewed * 7} / {options.weeklyGoal}</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 mb-2">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-400 h-3 rounded-full transition-all duration-1000"
                      style={{ width: `${weeklyProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                    <span>{Math.round(weeklyProgress)}% Complete</span>
                    <span>{Math.max(0, options.weeklyGoal - (stats.reviewed * 7))} remaining</span>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Weekly Goal</label>
                    <input
                      type="number"
                      min="7"
                      max="1000"
                      value={options.weeklyGoal}
                      onChange={(e) => setOptions({...options, weeklyGoal: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Monthly Goals */}
          {selectedGoalType === "monthly" && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Targets</h3>
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Monthly Review Goal</span>
                    <span className="text-lg font-bold">{stats.reviewed * 30} / {options.monthlyGoal}</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 mb-2">
                    <div 
                      className="bg-gradient-to-r from-purple-500 to-purple-400 h-3 rounded-full transition-all duration-1000"
                      style={{ width: `${monthlyProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400">
                    <span>{Math.round(monthlyProgress)}% Complete</span>
                    <span>{Math.max(0, options.monthlyGoal - (stats.reviewed * 30))} remaining</span>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium mb-2">Monthly Goal</label>
                    <input
                      type="number"
                      min="30"
                      max="3000"
                      value={options.monthlyGoal}
                      onChange={(e) => setOptions({...options, monthlyGoal: Number(e.target.value)})}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Achievements */}
          {selectedGoalType === "achievements" && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border-2 border-black p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold">Achievements</h3>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {unlockedCount} of {achievements.length} unlocked
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                {achievements.map((achievement) => (
                  <div key={achievement.id} className={`p-4 rounded-xl border-2 ${
                    achievement.unlocked 
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' 
                      : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`text-2xl ${achievement.unlocked ? '' : 'grayscale opacity-50'}`}>
                        {achievement.icon}
                      </div>
                      <div className="flex-1">
                        <h4 className={`font-medium ${
                          achievement.unlocked 
                            ? 'text-emerald-800 dark:text-emerald-200' 
                            : 'text-slate-600 dark:text-slate-400'
                        }`}>
                          {achievement.title}
                        </h4>
                        <p className={`text-sm ${
                          achievement.unlocked 
                            ? 'text-emerald-600 dark:text-emerald-300' 
                            : 'text-slate-500 dark:text-slate-400'
                        }`}>
                          {achievement.description}
                        </p>
                      </div>
                      {achievement.unlocked && (
                        <div className="text-emerald-500">✓</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Main component variables and logic
  const sessionActive = sessionStarted && !paused && currentId;
  const timerColor = useMemo(() => {
    if (!sessionRemaining || options.sessionMinutes <= 0) return "from-indigo-500 to-purple-500";
    const percent = sessionRemaining / (options.sessionMinutes * 60_000);
    if (percent > 0.5) return "from-emerald-500 to-green-500";
    if (percent > 0.25) return "from-amber-500 to-orange-500";
    return "from-red-500 to-rose-500";
  }, [sessionRemaining, options.sessionMinutes]);

  return (
    <div className={`app-main-container w-full min-h-screen ${theme === "dark" ? "dark bg-gradient-to-br from-slate-800 via-indigo-900/20 via-purple-900/15 to-slate-700" : "bg-gradient-to-br from-blue-50 via-indigo-100/40 via-purple-100/30 to-pink-50/50"}`}>
      <div className="w-full max-w-6xl mx-auto p-2 md:p-4">
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: ${theme === 'dark' ? '#1e293b' : '#f1f5f9'};
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${theme === 'dark' ? '#475569' : '#cbd5e1'};
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${theme === 'dark' ? '#64748b' : '#94a3b8'};
        }
        .glass {
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
      `}</style>
      {currentView === "deck-editor" ? (
        <DeckEditorView />
      ) : currentView === "stats" ? (
        <StatsView />
      ) : currentView === "reports" ? (
        <ReportsView />
      ) : currentView === "report-analysis" ? (
        <ReportAnalysisCenter />
      ) : currentView === "profile" ? (
        <ProfileView />
      ) : currentView === "goals" ? (
        <GoalsView />
      ) : (
        <div className="rounded-2xl border-2 border-black shadow-2xl bg-white/70 dark:bg-slate-900/70 glass text-slate-900 dark:text-slate-100">
          {/* Header with banner image and logo */}
          <div className="relative flex items-center justify-between p-4 border-2 border-black min-h-[80px] glass-effect overflow-visible"
               style={{
                 backgroundImage: 'url("ASRL banner.png")',
                 backgroundSize: 'contain',
                 backgroundPosition: 'center',
                 backgroundRepeat: 'no-repeat'
               }}>
            {/* Light overlay for readability */}
            <div className="absolute inset-0 bg-black/10"></div>
            
            {/* Left: Profile Button */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
              <div className="relative">
                <button 
                  className="p-3 rounded-xl shadow-lg bg-slate-800/80 backdrop-blur-md border-2 border-slate-600/50 hover:shadow-2xl hover:scale-110 hover:bg-slate-700/90 hover:border-slate-400/70 transition-all duration-300 transform hover:rotate-1" 
                  title="User Profile" 
                  onClick={() => setCurrentView("profile")}
                  onMouseEnter={() => setHoveredButton('profile')}
                  onMouseLeave={() => setHoveredButton(null)}
                >
                  <User className="w-5 h-5 text-white hover:text-blue-300 transition-colors duration-300"/>
                </button>
                {hoveredButton === 'profile' && (
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-2 py-1 rounded text-xs whitespace-nowrap z-10">
                    Profile
                  </div>
                )}
              </div>
            </div>

            {/* Center Left: Logo */}
            <div className="absolute left-1/2 -translate-x-[280px] top-1/2 -translate-y-1/2 z-10">
              <img 
                src="400PngdpiLogoCroppedBW.png" 
                alt="PRCM Logo" 
                className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 object-contain drop-shadow-lg"
                style={{filter: 'drop-shadow(2px 2px 4px rgba(0,0,0,0.8))'}}
                onError={(e) => {
                  e.target.src = "400PngdpiLogo.png";
                }}
              />
            </div>

            {/* Center Right: Logo */}
            <div className="absolute left-1/2 translate-x-[216px] top-1/2 -translate-y-1/2 z-10">
              <img 
                src="400PngdpiLogoCroppedBW.png" 
                alt="PRCM Logo" 
                className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 object-contain drop-shadow-lg"
                style={{filter: 'drop-shadow(2px 2px 4px rgba(0,0,0,0.8))'}}
                onError={(e) => {
                  e.target.src = "400PngdpiLogo.png";
                }}
              />
            </div>

            {/* Right: Drawer Menu */}
            <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex items-center gap-4">
              {/* Drawer Menu Button */}
              <div className="relative">
                <button 
                  className="p-3 rounded-xl shadow-lg bg-slate-800/80 backdrop-blur-md border-2 border-slate-600/50 hover:shadow-2xl hover:scale-110 hover:bg-slate-700/90 hover:border-slate-400/70 transition-all duration-300 transform hover:rotate-1" 
                  title="Menu" 
                  onClick={() => setDrawerOpen(!drawerOpen)}
                  onMouseEnter={() => setHoveredButton('menu')}
                  onMouseLeave={() => setHoveredButton(null)}
                >
                  <Menu className="w-5 h-5 text-white hover:text-slate-300 transition-colors duration-300"/>
                </button>
                {hoveredButton === 'menu' && (
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-2 py-1 rounded text-xs whitespace-nowrap z-10">
                    Menu
                  </div>
                )}

                {/* Drawer Menu */}
                {drawerOpen && (
                  <div className="fixed top-20 right-4 bg-white/95 dark:bg-slate-800/95 border-2 border-black rounded-xl shadow-2xl z-[99999] min-w-[280px] max-w-[320px] p-3 pointer-events-auto backdrop-blur-md">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => {
                          setDrawerOpen(false);
                          setShowHelp(true);
                        }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 hover:border hover:border-blue-300 dark:hover:border-slate-600 transition-all shimmer-dark text-left"
                      >
                        <HelpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Help</span>
                      </button>
                      <button
                        onClick={() => {
                          setDrawerOpen(false);
                          setShowTutorial(true);
                        }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 hover:border hover:border-blue-300 dark:hover:border-slate-600 transition-all shimmer-dark text-left"
                      >
                        <BookOpen className="w-4 h-4 text-green-600 dark:text-green-400" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Tutorial</span>
                      </button>
                      <button
                        onClick={() => {
                          setDrawerOpen(false);
                          setShowOptions(true);
                          setOptTab("session");
                        }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 hover:border hover:border-blue-300 dark:hover:border-slate-600 transition-all shimmer-dark text-left"
                      >
                        <Settings className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                        <span className="text-sm text-slate-700 dark:text-slate-300">Settings</span>
                      </button>
                      <button
                        onClick={() => {
                          setDrawerOpen(false);
                          toggleTheme();
                        }}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700 hover:border hover:border-blue-300 dark:hover:border-slate-600 transition-all shimmer-dark text-left"
                      >
                        {theme === "light" ? <Moon className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /> : <Sun className="w-4 h-4 text-yellow-500" />}
                        <span className="text-sm text-slate-700 dark:text-slate-300">{theme === "light" ? "Dark Mode" : "Light Mode"}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Deck Selector and Stats Section */}
          <div className="border-2 border-black bg-slate-50/70 dark:bg-slate-800/70 p-3 border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="border border-black rounded-lg bg-white dark:bg-slate-900 shadow-sm">
                  <select 
                    value={currentDeckId}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'manage') {
                        setShowOptions(true);
                        setOptTab("decks");
                      } else {
                        setCurrentDeckId(Number(value));
                      }
                    }}
                    className="text-sm text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border-none px-3 py-1 focus:ring-0 cursor-pointer font-medium min-w-[120px] rounded"
                  >
                    {decks.map((d, idx) => (
                      <option key={idx} value={idx}>
                        {d.name}
                      </option>
                    ))}
                    <option disabled>───────────</option>
                    <option value="manage">⚙️ Manage Decks</option>
                  </select>
                </div>
              </div>
              
              {/* Search Section */}
              <div className="flex-1 flex justify-center">
                <div className="relative">
                  {showSearchBar ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="Search cards..."
                        value={studySearchQuery}
                        onChange={(e) => {
                          setStudySearchQuery(e.target.value);
                          setShowSearchResults(e.target.value.length > 0);
                        }}
                        onBlur={() => {
                          if (!studySearchQuery) {
                            setShowSearchBar(false);
                            setShowSearchResults(false);
                          }
                        }}
                        className="pl-3 pr-3 py-2 rounded-xl border border-black bg-white dark:bg-slate-800 text-sm w-48 md:w-64"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          setShowSearchBar(false);
                          setStudySearchQuery("");
                          setShowSearchResults(false);
                        }}
                        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shimmer-dark"
                      >
                        <X className="w-4 h-4 text-slate-400"/>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowSearchBar(true)}
                      className="p-3 rounded-xl shadow-sm bg-white dark:bg-slate-800 border border-black hover:shadow-lg hover:scale-105 hover:bg-blue-50 dark:hover:bg-slate-700 transition-all duration-200"
                      title="Search Cards"
                    >
                      <Search className="w-5 h-5 text-slate-600 dark:text-slate-400"/>
                    </button>
                  )}
                  {showSearchResults && studySearchQuery && (
                    <div className="absolute top-12 left-1/2 transform -translate-x-1/2 bg-white dark:bg-slate-800 border border-black rounded-xl shadow-lg max-h-48 overflow-y-auto z-50 min-w-[300px]">
                      {deck.cards
                        .filter(c => c.front.toLowerCase().includes(studySearchQuery.toLowerCase()) || c.back.toLowerCase().includes(studySearchQuery.toLowerCase()))
                        .slice(0, 5)
                        .map(card => (
                          <div 
                            key={card.id} 
                            className="p-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer border-b border-slate-100 dark:border-slate-600 last:border-b-0"
                            onClick={() => {
                              setCurrentId(card.id);
                              setFrontPhase(true);
                              setStudySearchQuery("");
                              setShowSearchResults(false);
                              setShowSearchBar(false);
                            }}
                          >
                            <div className="text-sm font-medium">{card.front.slice(0, 40)}...</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">{card.back.slice(0, 30)}...</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 flex-wrap border border-black rounded-lg p-2 bg-white dark:bg-slate-900">
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 rounded text-xs font-medium border border-blue-300">
                  {stats.reviewed} reviewed
                </span>
                <span className="px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 rounded text-xs font-medium border border-emerald-300">
                  {accuracy}% accuracy
                </span>
                {sessionStarted && (
                  <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 rounded text-xs font-medium border border-indigo-300">
                    Goal: {options.goalType === "cards" ? `${stats.reviewed}/${options.goalCards} cards` : `${Math.round((Date.now() - (sessionEndAtRef.current - options.sessionMinutes * 60_000)) / 60_000)}/${options.goalMinutes} min`}
                  </span>
                )}
                {persist && (
                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded text-xs font-medium border border-purple-300">
                    Auto-saved
                  </span>
                )}
                <button
                  onClick={resetSettings}
                  className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded text-xs font-medium border border-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  title="Reset brightness and other settings"
                >
                  🔄 Reset
                </button>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {sessionStarted ? "Session Progress" : "Ready to Study"}
              </span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {sessionStarted ? `${sessionProgress}% complete` : `${deckStats.dueCount} due`}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-500 to-blue-500"
                initial={{ width: 0 }}
                animate={{ width: sessionStarted ? `${sessionProgress}%` : `${((deckStats.total - deckStats.dueCount) / Math.max(deckStats.total, 1)) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between p-4 border-2 border-black border-t-0 bg-slate-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {current ? `Card ${position}/${queue.length}` : "No cards in queue"}
              </span>
              {current && (
                <div className="flex gap-2">
                  <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 rounded-full text-xs">
                    Ease {current.ease?.toFixed(1) || "2.5"}
                  </span>
                  <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 rounded-full text-xs">
                    {current.reps || 0} reviews
                  </span>
                  {current.lapses > 0 && (
                    <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-full text-xs">
                      {current.lapses} lapses
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {sessionRemaining != null && sessionStarted && (
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-700 dark:text-slate-300"/>
                  <span className={`text-sm font-semibold px-3 py-1 rounded-full bg-gradient-to-r ${timerColor} text-white shadow-md`}>
                    {fmtMs(sessionRemaining)}
                  </span>
                </div>
              )}
              {!sessionStarted ? (
                <button 
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center gap-2" 
                  onClick={handleStart}
                >
                  <Play className="w-4 h-4"/> Start Session
                </button>
              ) : paused ? (
                <button 
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center gap-2" 
                  onClick={resumeSession}
                >
                  <Play className="w-4 h-4"/> Resume
                </button>
              ) : (
                <button 
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center gap-2" 
                  onClick={pauseSession}
                >
                  <Pause className="w-4 h-4"/> Pause
                </button>
              )}
              {current && (
                <button 
                  className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                  onClick={handleSkip}
                >
                  <SkipForward className="w-4 h-4"/>
                </button>
              )}
              {lastRatedCard && (
                <button 
                  className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                  onClick={handleUndo}
                  title="Undo last rating"
                >
                  <RotateCcw className="w-4 h-4"/>
                </button>
              )}
            </div>
          </div>

          {/* Card display */}
          <div className="p-4">
            <AnimatePresence mode="wait" initial={false}>
              {current ? (
                <motion.div 
                  key={current.id + (frontPhase ? "-front" : "-back")} 
                  initial={{ opacity: 0, y: 20, rotateY: isFlippingBack ? 180 : 0 }} 
                  animate={{ 
                    opacity: 1, 
                    y: 0, 
                    rotateY: isFlippingBack ? 180 : 0,
                    transition: { duration: isFlippingBack ? 0.3 : 0.5 }
                  }} 
                  exit={{ opacity: 0, y: -20, rotateY: isFlippingBack ? 0 : 180 }} 
                  className="rounded-2xl shadow-2xl p-8 bg-white/90 dark:bg-slate-900/90 border border-slate-200/50 dark:border-slate-700/50 hover:shadow-xl transition-all glass"
                  style={{ perspective: "1000px" }}
                >
                  {/* Card content */}
                  <div className="min-h-[200px] flex items-center justify-center text-center">
                    <p className="text-xl leading-relaxed whitespace-pre-wrap font-medium">
                      {frontPhase ? current.front : current.back}
                    </p>
                  </div>
                  
                  {/* Tags */}
                  {current.tags && current.tags.length > 0 && (
                    <div className="flex gap-2 justify-center mb-6">
                      {current.tags.map(tag => (
                        <span key={tag} className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full text-sm">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {/* Difficulty prediction */}
                  {!frontPhase && (
                    <div className="flex gap-2 justify-center mb-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        current.ease >= 2.5 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200' :
                        current.ease >= 2.0 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200' :
                        current.ease >= 1.7 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200' :
                        'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                      }`}>
                        Difficulty: {current.ease >= 2.5 ? 'Easy' : current.ease >= 2.0 ? 'Normal' : current.ease >= 1.7 ? 'Hard' : 'Very Hard'} ({current.ease?.toFixed(1)})
                      </span>
                      {current.reps > 0 && (
                        <span className="px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full text-xs">
                          {current.reps} reviews
                        </span>
                      )}
                    </div>
                  )}
                  
                  {frontPhase ? (
                    <div className="flex justify-center gap-4 mt-8">
                      <button 
                        className="px-8 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark font-medium" 
                        onClick={handleReveal}
                      >
                        <Eye className="w-5 h-5 inline mr-2"/>Show Answer
                      </button>
                      <button 
                        className="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                        onClick={handleSkip}
                      >
                        Skip
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4 mt-8">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <button 
                          className="px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark font-medium flex flex-col items-center" 
                          onClick={() => handleRate("Again")}
                        >
                          <div><X className="w-4 h-4 inline mr-1"/>Again (1)</div>
                          <div className="text-xs opacity-75 mt-1">{previewScheduling(current, "Again")}</div>
                        </button>
                        <button 
                          className="px-4 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark font-medium flex flex-col items-center" 
                          onClick={() => handleRate("Hard")}
                        >
                          <div>Hard (2)</div>
                          <div className="text-xs opacity-75 mt-1">{previewScheduling(current, "Hard")}</div>
                        </button>
                        <button 
                          className="px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark font-medium flex flex-col items-center" 
                          onClick={() => handleRate("Good")}
                        >
                          <div><ThumbsUp className="w-4 h-4 inline mr-1"/>Good (3)</div>
                          <div className="text-xs opacity-75 mt-1">{previewScheduling(current, "Good")}</div>
                        </button>
                        <button 
                          className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark font-medium flex flex-col items-center" 
                          onClick={() => handleRate("Easy")}
                        >
                          <div><Check className="w-4 h-4 inline mr-1"/>Easy (4)</div>
                          <div className="text-xs opacity-75 mt-1">{previewScheduling(current, "Easy")}</div>
                        </button>
                      </div>
                      <div className="flex justify-center">
                        <button 
                          className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                          onClick={() => handleRate("RepeatNow")}
                        >
                          <Repeat className="w-4 h-4 inline mr-1"/>Repeat Now
                        </button>
                      </div>
                      <div className="text-center text-xs text-slate-500 dark:text-slate-400 mt-4">
                        Keyboard: Space (flip) • 1-4 (rate) • Esc (pause)
                      </div>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div 
                  key="complete" 
                  initial={{ opacity: 0, scale: 0.95 }} 
                  animate={{ opacity: 1, scale: 1 }} 
                  exit={{ opacity: 0, scale: 0.95 }} 
                  className="rounded-2xl shadow-lg p-8 bg-white dark:bg-slate-900 border-2 border-black text-center"
                >
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", delay: 0.2, stiffness: 120 }}
                    className="text-6xl mb-4"
                  >
                    🎉
                  </motion.div>
                  <h2 className="text-2xl font-bold mb-4">Session Complete!</h2>
                  
                  {/* Session Summary with Insights */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
                    <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Session Insights</h4>
                    <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                      <div>• Studied {stats.reviewed} cards with {accuracy}% accuracy</div>
                      <div>• Mode: {options.studyMode === "cramming" ? "Cramming (all cards by difficulty)" : options.studyMode === "test" ? "Test (random order)" : "Normal (due + new cards)"}</div>
                      {accuracy >= 90 && <div>• 🎉 Excellent accuracy! You've mastered these concepts well.</div>}
                      {accuracy < 70 && <div>• 📚 Consider reviewing these cards again soon to improve retention.</div>}
                      {stats.reviewed >= options.goalCards && <div>• ✅ You reached your card goal of {options.goalCards}!</div>}
                    </div>
                  </div>
                  
                  {/* Enhanced completion stats */}
                  <div className="grid grid-cols-3 gap-6 mb-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{stats.reviewed}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Reviews</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">{accuracy}%</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Accuracy</div>
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{stats.correct}</div>
                      <div className="text-sm text-slate-600 dark:text-slate-400">Correct</div>
                    </div>
                  </div>

                  <div className="flex justify-center gap-4">
                    <button 
                      className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark font-medium" 
                      onClick={() => { 
                        setQueue([]); 
                        setCurrentId(null); 
                        setFrontPhase(true); 
                        resetTimer();
                        setDeck({ ...deck, id: uid("d") }); 
                      }}
                    >
                      New Session
                    </button>
                    <button 
                      className="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all font-medium" 
                      onClick={() => setCurrentView("stats")}
                    >
                      View Stats
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            {/* Queue preview */}
            {options.showNextCard && queue.length > 1 && sessionStarted && (
              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border-2 border-black">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 text-slate-600 dark:text-slate-400"/>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Next cards</span>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {queue.slice(queue.indexOf(currentId) + 1, queue.indexOf(currentId) + 6).map((id, idx) => {
                    const card = deck.cards.find(c => c.id === id);
                    return (
                      <div key={id} className="flex-shrink-0 w-20 h-12 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded text-xs p-1 overflow-hidden">
                        <div className="truncate text-slate-600 dark:text-slate-300">
                          {card?.front.slice(0, 30)}...
                        </div>
                      </div>
                    );
                  })}
                  {queue.length - queue.indexOf(currentId) > 6 && (
                    <div className="flex-shrink-0 w-20 h-12 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                      +{queue.length - queue.indexOf(currentId) - 5}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* OPTIONS SCREEN - enhanced with dark mode */}
          <AnimatePresence>
            {showOptions && (
              <motion.div 
                className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
              >
                <motion.div 
                  className="w-full max-w-7xl bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl max-h-[95vh] overflow-y-auto border-2 border-black" 
                  initial={{ scale: 0.95, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }} 
                  exit={{ scale: 0.95, opacity: 0 }}
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-semibold">Control Center</h2>
                    <button 
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                      onClick={() => setShowOptions(false)}
                    >
                      Close
                    </button>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-2 mb-6">
                    {['session','goals','decks','import','lighting','reset'].map(t => (
                      <button 
                        key={t} 
                        onClick={() => setOptTab(t)} 
                        className={`px-4 py-2 rounded-xl border transition-all ${
                          optTab === t 
                            ? 'bg-indigo-600 text-white border-indigo-600' 
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {t === 'session' && <Settings className="w-4 h-4"/>}
                          {t === 'goals' && <Clock className="w-4 h-4"/>}
                          {t === 'decks' && <BookOpen className="w-4 h-4"/>}
                          {t === 'import' && <Upload className="w-4 h-4"/>}
                          {t === 'reset' && <RotateCcw className="w-4 h-4"/>}
                          {t === 'session' ? 'Settings' : 
                           t === 'goals' ? 'Study Goals' : 
                           t === 'decks' ? 'Deck Manager' :
                           t === 'import' ? 'Import/Export' :
                           'Reset'}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Session options */}
                  {optTab === 'session' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Session limit</span>
                          <input 
                            type="number" 
                            className="w-20 border rounded-lg px-2 py-1 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600" 
                            value={options.sessionLimit} 
                            min={1} 
                            onChange={(e) => setOptions(o => ({ ...o, sessionLimit: Math.max(1, Number(e.target.value)) }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>New per session</span>
                          <input 
                            type="number" 
                            className="w-20 border rounded-lg px-2 py-1 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600" 
                            value={options.newPerSession} 
                            min={0} 
                            onChange={(e) => setOptions(o => ({ ...o, newPerSession: Math.max(0, Number(e.target.value)) }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Shuffle cards</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={options.shuffle} 
                            onChange={(e) => setOptions(o => ({ ...o, shuffle: e.target.checked }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Session minutes</span>
                          <input 
                            type="number" 
                            className="w-20 border rounded-lg px-2 py-1 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600" 
                            value={options.sessionMinutes} 
                            min={1} 
                            onChange={(e) => setOptions(o => ({ ...o, sessionMinutes: Math.max(1, Number(e.target.value)) }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Sound effects</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={options.soundEffects} 
                            onChange={(e) => setOptions(o => ({ ...o, soundEffects: e.target.checked }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Show next card</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={options.showNextCard} 
                            onChange={(e) => setOptions(o => ({ ...o, showNextCard: e.target.checked }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Enable undo</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={options.enableUndo} 
                            onChange={(e) => setOptions(o => ({ ...o, enableUndo: e.target.checked }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Auto-reveal after {options.frontTimerSec}s</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={options.autoReveal} 
                            onChange={(e) => setOptions(o => ({ ...o, autoReveal: e.target.checked }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Auto-advance to next</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={options.autoAdvance} 
                            onChange={(e) => setOptions(o => ({ ...o, autoAdvance: e.target.checked }))} 
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                          <span>Local persistence</span>
                          <input 
                            type="checkbox" 
                            className="h-5 w-5 rounded" 
                            checked={persist} 
                            onChange={(e) => setPersist(e.target.checked)} 
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ENHANCED Goals tab - Comprehensive Study Goals and Tracking */}
                  {optTab === 'goals' && (
                    <div className="space-y-6">
                      {/* Progress Overview */}
                      <div className="rounded-xl border-2 border-black p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2 text-blue-800 dark:text-blue-200">
                          🎯 Today's Progress
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.reviewed || 0}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Cards</div>
                            <div className="text-xs text-emerald-600 dark:text-emerald-400">
                              Goal: {options.goalCards}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{Math.round((stats.totalStudyTime || 0) / 60)}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Minutes</div>
                            <div className="text-xs text-emerald-600 dark:text-emerald-400">
                              Goal: {options.goalMinutes}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.studyStreak || 0}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Streak</div>
                            <div className="text-xs text-emerald-600 dark:text-emerald-400">
                              Best: {stats.longestStreak || 0}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0}%</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Accuracy</div>
                            <div className="text-xs text-emerald-600 dark:text-emerald-400">
                              Target: {options.targetAccuracy}%
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Daily Goals */}
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          <Clock className="w-4 h-4"/> Daily Study Goals
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-2">Primary Goal Type</label>
                            <select
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                              value={options.goalType || "cards"}
                              onChange={(e) => setOptions({...options, goalType: e.target.value})}
                            >
                              <option value="cards">Cards per day</option>
                              <option value="minutes">Minutes per day</option>
                              <option value="both">Both cards and minutes</option>
                              <option value="accuracy">Accuracy target</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-2">Target Value</label>
                            <input
                              type="number"
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                              placeholder={options.goalType === "cards" ? "Number of cards" : options.goalType === "minutes" ? "Study minutes" : "Accuracy %"}
                              value={options.goalType === "cards" ? options.goalCards : options.goalType === "minutes" ? options.goalMinutes : options.targetAccuracy}
                              min={0}
                              max={options.goalType === "accuracy" ? 100 : undefined}
                              onChange={(e) => {
                                const field = options.goalType === "cards" ? "goalCards" : options.goalType === "minutes" ? "goalMinutes" : "targetAccuracy";
                                setOptions({...options, [field]: Number(e.target.value)});
                              }}
                            />
                          </div>
                        </div>
                        
                        {/* Progress Bar */}
                        {(options.goalCards > 0 || options.goalMinutes > 0) && (
                          <div className="mt-4">
                            <div className="flex justify-between text-sm mb-2">
                              <span>Today's Progress</span>
                              <span>
                                {options.goalType === "cards" ? 
                                  `${stats.reviewed || 0}/${options.goalCards} cards` :
                                  options.goalType === "minutes" ?
                                  `${Math.round((stats.totalStudyTime || 0) / 60)}/${options.goalMinutes} min` :
                                  `${stats.reviewed ? Math.round((stats.correct / stats.reviewed) * 100) : 0}%/${options.targetAccuracy}%`
                                }
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3">
                              <div 
                                className={`h-3 rounded-full transition-all duration-500 ${
                                  options.goalType === "cards" ? 'bg-gradient-to-r from-blue-500 to-blue-600' :
                                  options.goalType === "minutes" ? 'bg-gradient-to-r from-green-500 to-green-600' :
                                  'bg-gradient-to-r from-purple-500 to-purple-600'
                                }`}
                                style={{ 
                                  width: `${Math.min(100, options.goalType === "cards" ? 
                                    ((stats.reviewed || 0) / options.goalCards) * 100 :
                                    options.goalType === "minutes" ?
                                    ((stats.totalStudyTime || 0) / 60 / options.goalMinutes) * 100 :
                                    (stats.reviewed ? (stats.correct / stats.reviewed) / options.targetAccuracy : 0) * 100
                                  )}%` 
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Weekly & Monthly Goals */}
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                          <h3 className="font-semibold mb-4 flex items-center gap-2">
                            📅 Weekly Goals
                          </h3>
                          <div className="space-y-3">
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Weekly card target</span>
                              <input 
                                type="number" 
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 w-20 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                                value={options.weeklyGoal || 140}
                                onChange={(e) => setOptions({...options, weeklyGoal: Number(e.target.value)})}
                              />
                            </label>
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Study streak target</span>
                              <input 
                                type="number" 
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 w-20 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                                value={options.streakTarget || 7}
                                onChange={(e) => setOptions({...options, streakTarget: Number(e.target.value)})}
                              />
                            </label>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                              Current week: {Object.values(stats.dailyReviews || {}).reduce((a, b) => a + b, 0)} cards
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                          <h3 className="font-semibold mb-4 flex items-center gap-2">
                            🗓️ Monthly Goals
                          </h3>
                          <div className="space-y-3">
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Monthly target</span>
                              <input 
                                type="number" 
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 w-20 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                                value={options.monthlyGoal || 500}
                                onChange={(e) => setOptions({...options, monthlyGoal: Number(e.target.value)})}
                              />
                            </label>
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Perfect days goal</span>
                              <input 
                                type="number" 
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 w-20 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                                value={options.perfectDays || 0}
                                onChange={(e) => setOptions({...options, perfectDays: Number(e.target.value)})}
                              />
                            </label>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                              This month: {stats.reviewed || 0} cards total
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Study Preferences */}
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          ⚙️ Study Preferences
                        </h3>
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Preferred study time</span>
                              <select 
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                                value={options.reminderTime || "19:00"}
                                onChange={(e) => setOptions({...options, reminderTime: e.target.value})}
                              >
                                <option value="08:00">Morning (8 AM)</option>
                                <option value="12:00">Afternoon (12 PM)</option>
                                <option value="17:00">Evening (5 PM)</option>
                                <option value="19:00">Night (7 PM)</option>
                                <option value="21:00">Late (9 PM)</option>
                              </select>
                            </label>
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Difficulty preference</span>
                              <select 
                                className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shimmer-dark"
                                value={options.difficultyTarget || "normal"}
                                onChange={(e) => setOptions({...options, difficultyTarget: e.target.value})}
                              >
                                <option value="easy">Focus on easy cards</option>
                                <option value="normal">Balanced approach</option>
                                <option value="hard">Challenge with hard cards</option>
                              </select>
                            </label>
                          </div>
                          
                          <div className="space-y-3">
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Daily study reminders</span>
                              <input 
                                type="checkbox" 
                                className="h-4 w-4 rounded accent-blue-600 hover:scale-110 transition-transform" 
                                checked={options.studyReminder || false}
                                onChange={(e) => setOptions({...options, studyReminder: e.target.checked})}
                              />
                            </label>
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Break reminders (30 min)</span>
                              <input 
                                type="checkbox" 
                                className="h-4 w-4 rounded accent-green-600 hover:scale-110 transition-transform" 
                              />
                            </label>
                            <label className="flex items-center justify-between">
                              <span className="text-sm">Motivational milestones</span>
                              <input 
                                type="checkbox" 
                                className="h-4 w-4 rounded accent-purple-600 hover:scale-110 transition-transform" 
                                defaultChecked
                              />
                            </label>
                          </div>
                        </div>
                      </div>

                      {/* Achievement Tracking */}
                      <div className="rounded-xl border-2 border-black p-4 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20">
                        <h3 className="font-semibold mb-4 flex items-center gap-2 text-orange-800 dark:text-orange-200">
                          🏆 Achievement Tracker
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={`text-2xl ${(stats.studyStreak || 0) >= 7 ? '' : 'grayscale'}`}>🔥</span>
                            <div>
                              <div className="font-medium">Week Streak</div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">{(stats.studyStreak || 0) >= 7 ? 'Unlocked!' : `${stats.studyStreak || 0}/7 days`}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-2xl ${(stats.reviewed || 0) >= 100 ? '' : 'grayscale'}`}>💯</span>
                            <div>
                              <div className="font-medium">Century</div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">{(stats.reviewed || 0) >= 100 ? 'Unlocked!' : `${stats.reviewed || 0}/100 cards`}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-2xl ${(stats.correct / (stats.reviewed || 1)) >= 0.9 ? '' : 'grayscale'}`}>🎯</span>
                            <div>
                              <div className="font-medium">Accuracy</div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">{(stats.correct / (stats.reviewed || 1)) >= 0.9 ? 'Unlocked!' : '90%+ needed'}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-2xl ${(stats.sessionsCompleted || 0) >= 10 ? '' : 'grayscale'}`}>🎓</span>
                            <div>
                              <div className="font-medium">Sessions</div>
                              <div className="text-xs text-slate-600 dark:text-slate-400">{(stats.sessionsCompleted || 0) >= 10 ? 'Unlocked!' : `${stats.sessionsCompleted || 0}/10 sessions`}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Deck Manager tab - Individual deck management */}
                  {optTab === 'decks' && (
                    <div className="space-y-6">
                      {/* Current Deck Overview */}
                      <div className="rounded-xl border-2 border-black p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <BookOpen className="w-6 h-6 text-indigo-600"/>
                            <div>
                              <h3 className="font-bold text-lg text-indigo-800 dark:text-indigo-200">{deck.name}</h3>
                              <p className="text-sm text-indigo-600 dark:text-indigo-400">Currently active deck</p>
                            </div>
                          </div>
                          <button 
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors shimmer-dark flex items-center gap-2"
                            onClick={() => setCurrentView("deck-editor")}
                          >
                            <Edit className="w-4 h-4"/>
                            Edit Cards
                          </button>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                            <div className="text-2xl font-bold text-blue-600">{deck.cards.length}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Total Cards</div>
                          </div>
                          <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                            <div className="text-2xl font-bold text-amber-600">{deck.cards.filter(c => isDue(c)).length}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Due Now</div>
                          </div>
                          <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                            <div className="text-2xl font-bold text-green-600">{deck.cards.filter(c => c.reps >= 3).length}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">Learned</div>
                          </div>
                          <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-lg">
                            <div className="text-2xl font-bold text-purple-600">{deck.cards.filter(c => c.reps === 0 && !c.dueAt).length}</div>
                            <div className="text-sm text-slate-600 dark:text-slate-400">New</div>
                          </div>
                        </div>
                      </div>

                      {/* All Decks Management */}
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2">
                            <BookOpen className="w-4 h-4"/>
                            All Decks ({decks.length})
                          </h3>
                          <button 
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shimmer-dark flex items-center gap-2"
                            onClick={createNewDeck}
                          >
                            <Plus className="w-4 h-4"/>
                            New Deck
                          </button>
                        </div>
                        
                        <div className="space-y-3">
                          {decks.map((deckItem, idx) => (
                            <div key={idx} className={`p-4 border rounded-lg transition-colors shimmer-dark ${
                              idx === currentDeckId 
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' 
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                            }`}>
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    {editingDeckId === idx ? (
                                      <input
                                        type="text"
                                        defaultValue={deckItem.name}
                                        className="font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500"
                                        autoFocus
                                        onBlur={(e) => {
                                          renameDeck(idx, e.target.value);
                                          setEditingDeckId(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            renameDeck(idx, e.target.value);
                                            setEditingDeckId(null);
                                          } else if (e.key === 'Escape') {
                                            setEditingDeckId(null);
                                          }
                                        }}
                                      />
                                    ) : (
                                      <span className={`font-medium ${idx === currentDeckId ? 'text-indigo-700 dark:text-indigo-300' : ''}`}>
                                        {deckItem.name}
                                      </span>
                                    )}
                                    {idx === currentDeckId && (
                                      <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded">ACTIVE</span>
                                    )}
                                  </div>
                                  <div className="text-sm text-slate-600 dark:text-slate-400">
                                    {deckItem.cards.length} cards
                                    {deckItem.cards.length > 0 && (
                                      <>
                                        • {deckItem.cards.filter(c => isDue(c)).length} due
                                        • {deckItem.cards.filter(c => c.reps >= 3).length} learned
                                        • {deckItem.cards.filter(c => (c.lapses || 0) > 2).length} struggling
                                      </>
                                    )}
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <button 
                                    className="p-2 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors shimmer-dark"
                                    title="Rename Deck"
                                    onClick={() => setEditingDeckId(idx)}
                                  >
                                    <Type className="w-4 h-4"/>
                                  </button>
                                  <button 
                                    className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors shimmer-dark"
                                    title="Edit Cards"
                                    onClick={() => {
                                      setCurrentDeckId(idx);
                                      setCurrentView("deck-editor");
                                    }}
                                  >
                                    <Edit className="w-4 h-4"/>
                                  </button>
                                  <button 
                                    className="p-2 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors shimmer-dark"
                                    title="Export Deck"
                                    onClick={() => {
                                      const tempDeckId = currentDeckId;
                                      setCurrentDeckId(idx);
                                      setTimeout(() => {
                                        const a = document.createElement('a');
                                        const deckData = decks[idx];
                                        a.href = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(deckData, null, 2))}`;
                                        a.download = `deck-${deckData.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`;
                                        a.click();
                                        setCurrentDeckId(tempDeckId);
                                      }, 100);
                                    }}
                                  >
                                    <Download className="w-4 h-4"/>
                                  </button>
                                  {decks.length > 1 && (
                                    <button 
                                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors shimmer-dark"
                                      onClick={() => {
                                        if (confirm(`Delete "${deckItem.name}" and all its ${deckItem.cards.length} cards?`)) {
                                          deleteDeck(idx);
                                        }
                                      }}
                                    >
                                      <Trash2 className="w-4 h-4"/>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Deck Options & Settings */}
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                          <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <Settings className="w-4 h-4"/>
                            Deck Settings
                          </h3>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium mb-1">Deck Name</label>
                              <input 
                                type="text" 
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                value={deck.name}
                                onChange={(e) => {
                                  const newDeck = { ...deck, name: e.target.value };
                                  setDeck(newDeck);
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium mb-1">New Cards Per Session</label>
                              <input 
                                type="number" 
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                value={options.newPerSession || 5}
                                min={1}
                                onChange={(e) => setOptions({...options, newPerSession: Number(e.target.value)})}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium mb-1">Study Mode for This Deck</label>
                              <select 
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                value={options.studyMode}
                                onChange={(e) => setOptions({...options, studyMode: e.target.value})}
                              >
                                <option value="normal">Normal (Due + New)</option>
                                <option value="cramming">Cramming (All by Difficulty)</option>
                                <option value="test">Test Mode (Random)</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                          <h3 className="font-semibold mb-4 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4"/>
                            Quick Actions
                          </h3>
                          <div className="space-y-2">
                            <button 
                              className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shimmer-dark flex items-center gap-2"
                              onClick={() => setCurrentView("deck-editor")}
                            >
                              <Edit className="w-4 h-4"/>
                              Edit Cards
                            </button>
                            <button 
                              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shimmer-dark flex items-center gap-2"
                              onClick={() => setCurrentView("stats")}
                            >
                              <BarChart3 className="w-4 h-4"/>
                              View Statistics
                            </button>
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Current Deck Export</div>
                              <button 
                                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors shimmer-dark flex items-center gap-2"
                                onClick={() => {
                                  const deckData = JSON.stringify(deck, null, 2);
                                  const blob = new Blob([deckData], { type: 'application/json' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `deck-${deck.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                <Download className="w-4 h-4"/>
                                Export "{deck.name}" Deck
                              </button>
                              <button 
                                className="w-full px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors shimmer-dark flex items-center gap-2"
                                onClick={generateDeckCSV}
                              >
                                <Download className="w-4 h-4"/>
                                Export as CSV
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Import/Export tab - Properly paired import and export functionality */}
                  {optTab === 'import' && (
                    <div className="space-y-6">
                      {/* Deck Import/Export Pair */}
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          <BookOpen className="w-4 h-4"/> Deck Management
                        </h3>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                          {/* Import Deck */}
                          <div className="bg-white/50 dark:bg-slate-900/50 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
                            <h4 className="font-medium mb-3 flex items-center gap-2 text-blue-700 dark:text-blue-300">
                              <Upload className="w-4 h-4"/>
                              Import Deck
                            </h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Import flashcard decks from JSON or CSV format. New decks will be added to your collection.
                            </p>
                            
                            <div className="space-y-3">
                              <div>
                                <label className="block text-sm font-medium mb-2">Import Format</label>
                                <div className="flex gap-2 mb-4">
                                  <label className={`px-3 py-2 rounded-xl border cursor-pointer transition-all ${deckImportType === 'json' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                    <input type="radio" name="impdeck" className="mr-2" checked={deckImportType === 'json'} onChange={() => setDeckImportType('json')} />
                                    📄 JSON
                                  </label>
                                  <label className={`px-3 py-2 rounded-xl border cursor-pointer transition-all ${deckImportType === 'csv' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                    <input type="radio" name="impdeck" className="mr-2" checked={deckImportType === 'csv'} onChange={() => setDeckImportType('csv')} />
                                    📊 CSV
                                  </label>
                                </div>
                              </div>
                              
                              <div>
                                <label className="block text-sm font-medium mb-2">Upload File or Paste Data</label>
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  accept={deckImportType === 'json' ? '.json' : '.csv'}
                                  onChange={(e) => handleFileUpload(e.target.files?.[0])}
                                  className="w-full text-sm border border-slate-300 dark:border-slate-600 rounded-lg p-2 bg-white dark:bg-slate-900 mb-3"
                                />
                              </div>
                              
                              <div>
                                <textarea 
                                  className="w-full h-32 border rounded-xl p-3 font-mono text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600" 
                                  placeholder={deckImportType === 'json' ? '{"name":"My Deck","cards":[{"front":"Question","back":"Answer","tags":["tag1"]}]}' : "front,back,tags\\nWhat is 2+2?,4,math\\nWhat is the capital of France?,Paris,geography"} 
                                  value={deckImportText} 
                                  onChange={(e) => setDeckImportText(e.target.value)} 
                                />
                                <div className="flex justify-end gap-2 mt-3">
                                  <button 
                                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                                    onClick={() => setDeckImportText("")}
                                  >
                                    Clear
                                  </button>
                                  <button 
                                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark" 
                                    onClick={importDeckFromText}
                                    disabled={!deckImportText.trim()}
                                  >
                                    <Upload className="w-4 h-4 inline mr-2"/>
                                    Import as New Deck
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Export Current Deck */}
                          <div className="bg-white/50 dark:bg-slate-900/50 p-4 rounded-lg border border-green-200 dark:border-green-700">
                            <h4 className="font-medium mb-3 flex items-center gap-2 text-green-700 dark:text-green-300">
                              <Download className="w-4 h-4"/>
                              Export Current Deck
                            </h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Export deck "{deck.name}" as JSON or CSV for backup or sharing.
                            </p>
                            
                            <div className="flex flex-col gap-2 mb-4">
                              <button 
                                className="w-full px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2" 
                                onClick={generateDeckJSON}
                              >
                                <Download className="w-4 h-4"/>
                                Generate JSON
                              </button>
                              <button 
                                className="w-full px-4 py-2 rounded-xl bg-green-500 hover:bg-green-600 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2" 
                                onClick={generateDeckCSV}
                              >
                                <Download className="w-4 h-4"/>
                                Generate CSV
                              </button>
                            </div>
                            
                            {(deckExportJSON || deckExportCSV) && (
                              <div className="space-y-3">
                                {deckExportJSON && (
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-medium text-xs">📄 Deck JSON</span>
                                      <div className="flex gap-1">
                                        <button 
                                          className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                          onClick={() => copyText(deckExportJSON)}
                                        >
                                          Copy
                                        </button>
                                        <button 
                                          className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                          onClick={() => setDeckExportJSON("")}
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>
                                    <textarea 
                                      className="w-full h-16 border rounded p-2 font-mono text-xs bg-white dark:bg-slate-900" 
                                      readOnly 
                                      value={deckExportJSON} 
                                    />
                                  </div>
                                )}
                                {deckExportCSV && (
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-medium text-xs">📊 Deck CSV</span>
                                      <div className="flex gap-1">
                                        <button 
                                          className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                          onClick={() => copyText(deckExportCSV)}
                                        >
                                          Copy
                                        </button>
                                        <button 
                                          className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                          onClick={() => setDeckExportCSV("")}
                                        >
                                          ×
                                        </button>
                                      </div>
                                    </div>
                                    <textarea 
                                      className="w-full h-16 border rounded p-2 font-mono text-xs bg-white dark:bg-slate-900" 
                                      readOnly 
                                      value={deckExportCSV} 
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Progress Import/Export Pair */}
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          <BarChart3 className="w-4 h-4"/> Complete Data Backup & Restore
                        </h3>
                        
                        <div className="grid md:grid-cols-2 gap-6">
                          {/* Import Progress */}
                          <div className="bg-white/50 dark:bg-slate-900/50 p-4 rounded-lg border border-orange-200 dark:border-orange-700">
                            <h4 className="font-medium mb-3 flex items-center gap-2 text-orange-700 dark:text-orange-300">
                              <Upload className="w-4 h-4"/>
                              Import Complete Backup
                            </h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Import complete study progress including all decks, stats, goals, and settings from a backup file.
                            </p>
                            
                            <div className="space-y-3">
                              <textarea 
                                className="w-full h-32 border rounded-xl p-3 font-mono text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600" 
                                placeholder='{"decks":[...],"stats":{...},"options":{...},"userProfile":{...}}' 
                                value={progressImportText} 
                                onChange={(e) => setProgressImportText(e.target.value)} 
                              />
                              <div className="flex justify-end gap-2">
                                <button 
                                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border-2 border-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all" 
                                  onClick={() => setProgressImportText("")}
                                >
                                  Clear
                                </button>
                                <button 
                                  className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark" 
                                  onClick={importProgressFromText}
                                  disabled={!progressImportText.trim()}
                                >
                                  <Upload className="w-4 h-4 inline mr-2"/>
                                  Import Complete Backup
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Export Complete Backup */}
                          <div className="bg-white/50 dark:bg-slate-900/50 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
                            <h4 className="font-medium mb-3 flex items-center gap-2 text-purple-700 dark:text-purple-300">
                              <Download className="w-4 h-4"/>
                              Export Complete Backup
                            </h4>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                              Export everything: all decks, statistics, goals, settings and profile for complete backup.
                            </p>
                            
                            <div className="space-y-3">
                              <button 
                                className="w-full px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark flex items-center justify-center gap-2" 
                                onClick={() => {
                                  const completeData = {
                                    decks,
                                    currentDeckId,
                                    stats,
                                    options,
                                    userProfile,
                                    exportDate: new Date().toISOString(),
                                    version: "2.0"
                                  };
                                  setProgressExportJSON(JSON.stringify(completeData, null, 2));
                                }}
                              >
                                <Download className="w-4 h-4"/>
                                Generate Complete Backup
                              </button>
                              
                              {progressExportJSON && (
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium text-xs">💾 Complete Backup</span>
                                    <div className="flex gap-1">
                                      <button 
                                        className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                        onClick={() => copyText(progressExportJSON)}
                                      >
                                        Copy
                                      </button>
                                      <button 
                                        className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                        onClick={() => {
                                          const blob = new Blob([progressExportJSON], { type: 'application/json' });
                                          const url = URL.createObjectURL(blob);
                                          const a = document.createElement('a');
                                          a.href = url;
                                          a.download = `prcm-backup-${new Date().toISOString().split('T')[0]}.json`;
                                          a.click();
                                          URL.revokeObjectURL(url);
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button 
                                        className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs" 
                                        onClick={() => setProgressExportJSON("")}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                  <textarea 
                                    className="w-full h-20 border rounded p-2 font-mono text-xs bg-white dark:bg-slate-900" 
                                    readOnly 
                                    value={progressExportJSON} 
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Lighting & Visual Effects tab */}
                  {optTab === 'lighting' && (
                    <div className="space-y-6">
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          <Sun className="w-4 h-4"/> Brightness Controls
                        </h3>
                        <div className="space-y-4">
                          {/* Light Mode Brightness */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Sun className="w-4 h-4 text-yellow-500" />
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Light Mode Brightness</span>
                            </div>
                            <input
                              type="range"
                              min="50"
                              max="150"
                              value={lightBrightness}
                              onChange={(e) => setLightBrightness(Number(e.target.value))}
                              className="w-full h-3 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
                              style={{
                                background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${((lightBrightness - 50) / 100) * 100}%, #e5e7eb ${((lightBrightness - 50) / 100) * 100}%, #e5e7eb 100%)`
                              }}
                            />
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">{lightBrightness}%</div>
                          </div>
                          
                          {/* Dark Mode Brightness */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <Moon className="w-4 h-4 text-indigo-500" />
                              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Dark Mode Brightness</span>
                            </div>
                            <input
                              type="range"
                              min="50"
                              max="150"
                              value={darkBrightness}
                              onChange={(e) => setDarkBrightness(Number(e.target.value))}
                              className="w-full h-3 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
                              style={{
                                background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${((darkBrightness - 50) / 100) * 100}%, #4b5563 ${((darkBrightness - 50) / 100) * 100}%, #4b5563 100%)`
                              }}
                            />
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">{darkBrightness}%</div>
                          </div>
                        </div>
                      </div>

                      {/* Transparency Controls */}
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          <Eye className="w-4 h-4"/> Transparency Effects
                        </h3>
                        <div className="space-y-4">
                          {/* Transparency Toggle */}
                          <label className="flex items-center justify-between p-3 bg-white dark:bg-slate-700 rounded-xl">
                            <div className="flex items-center gap-2">
                              <div className="text-lg">✨</div>
                              <span className="text-sm font-medium">Enable Transparency Effects</span>
                            </div>
                            <input 
                              type="checkbox"
                              checked={transparencyEnabled}
                              onChange={(e) => setTransparencyEnabled(e.target.checked)}
                              className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500" 
                            />
                          </label>
                          
                          {/* Transparency Level */}
                          {transparencyEnabled && (
                            <div>
                              <div className="flex items-center gap-2 mb-2">
                                <div className="text-lg">💫</div>
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Transparency Level</span>
                              </div>
                              <input
                                type="range"
                                min="20"
                                max="95"
                                value={transparencyLevel}
                                onChange={(e) => setTransparencyLevel(Number(e.target.value))}
                                className="w-full h-3 bg-slate-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer"
                                style={{
                                  background: `linear-gradient(to right, rgba(99, 102, 241, 0.8) 0%, rgba(99, 102, 241, 0.8) ${((transparencyLevel - 20) / 75) * 100}%, #e5e7eb ${((transparencyLevel - 20) / 75) * 100}%, #e5e7eb 100%)`
                                }}
                              />
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-center">{transparencyLevel}% opacity</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reset tab */}
                  {optTab === 'reset' && (
                    <div className="space-y-6">
                      <div className="rounded-xl border-2 border-black p-4 bg-slate-50 dark:bg-slate-800">
                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4"/> Reset Options
                        </h3>
                        <div className="space-y-3">
                          <button 
                            onClick={() => {
                              // Create a small test deck with 3 cards for quick testing
                              const testDeck = {
                                name: "Test Deck (3 cards)",
                                cards: [
                                  { id: "test1", front: "Test Card 1", back: "Answer 1", due: new Date().toISOString(), interval: 1, ease: 2.5, reps: 0, lapses: 0, tags: ["test"] },
                                  { id: "test2", front: "Test Card 2", back: "Answer 2", due: new Date().toISOString(), interval: 1, ease: 2.5, reps: 0, lapses: 0, tags: ["test"] },
                                  { id: "test3", front: "Test Card 3", back: "Answer 3", due: new Date().toISOString(), interval: 1, ease: 2.5, reps: 0, lapses: 0, tags: ["test"] }
                                ]
                              };
                              setDeck(testDeck);
                              setQueue([]);
                              setCurrentId(null);
                              setShowOptions(false);
                              alert("Test deck loaded with 3 cards. Use Shift+N to skip cards quickly, Shift+E to end session instantly.");
                            }}
                            className="w-full px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark text-left"
                          >
                            <div className="font-medium">Load Test Deck (3 cards)</div>
                            <div className="text-sm opacity-75">Quick testing with minimal cards</div>
                          </button>
                          <button 
                            onClick={resetProgress}
                            className="w-full px-4 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark text-left"
                          >
                            <div className="font-medium">Reset Progress Only</div>
                            <div className="text-sm opacity-75">Keep cards but clear all scheduling data</div>
                          </button>
                          <button 
                            onClick={resetAll}
                            className="w-full px-4 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white shadow-md hover:shadow-lg transition-all shimmer-dark text-left"
                          >
                            <div className="font-medium">Reset Everything</div>
                            <div className="text-sm opacity-75">Replace deck with sample cards and clear all progress</div>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* HELP OVERLAY */}
          <AnimatePresence>
            {showHelp && (
              <motion.div 
                className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                onClick={() => setShowHelp(false)}
              >
                <motion.div 
                  className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
                  initial={{ scale: 0.9 }} 
                  animate={{ scale: 1 }} 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold dark:text-white">Keyboard Shortcuts</h2>
                    <button 
                      onClick={() => setShowHelp(false)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold mb-2 text-slate-700 dark:text-slate-300">During Study</h3>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Flip card / Next card (Good)</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">Space</kbd>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Pause/Resume</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">Esc</kbd>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Show Help</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">H</kbd>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold mb-2 text-slate-700 dark:text-slate-300">Rating Cards (Back Side)</h3>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Again (1 min)</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">1</kbd>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Hard (6 min)</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">2</kbd>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Good (10 min)</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">3</kbd>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Easy (4 days)</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">4</kbd>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold mb-2 text-slate-700 dark:text-slate-300">Global Shortcuts</h3>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">Open Settings</span>
                          <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">Ctrl + S</kbd>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      💡 <strong>Tip:</strong> Press Space to flip cards and advance with Good rating. 
                      Use number keys for specific ratings when viewing the answer.
                    </p>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>


          {/* COMPREHENSIVE TUTORIAL MODAL */}
          <AnimatePresence>
            {showTutorial && (
              <motion.div 
                className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }}
                onClick={() => setShowTutorial(false)}
              >
                <motion.div 
                  className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
                  initial={{ scale: 0.9 }} 
                  animate={{ scale: 1 }} 
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold dark:text-white flex items-center gap-2">
                      <HelpCircle className="w-6 h-6 text-blue-600"/>
                      Complete Tutorial & Guide
                    </h2>
                    <button 
                      onClick={() => setShowTutorial(false)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  {/* Tutorial Content */}
                  <div className="space-y-8">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-6">
                        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-xl">
                          <h3 className="font-bold text-lg mb-3 text-blue-800 dark:text-blue-200">🎯 Getting Started</h3>
                          <ul className="space-y-2 text-sm">
                            <li>• Click <strong>Start Session</strong> to begin studying</li>
                            <li>• Use <strong>Space</strong> to flip cards and advance with "Good"</li>
                            <li>• Rate cards: 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)</li>
                            <li>• Press <strong>Esc</strong> to pause anytime</li>
                            <li>• Set daily goals in Settings → Goals</li>
                          </ul>
                        </div>
                        
                        <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 p-6 rounded-xl">
                          <h3 className="font-bold text-lg mb-3 text-emerald-800 dark:text-emerald-200">📊 Tracking Progress</h3>
                          <ul className="space-y-2 text-sm">
                            <li>• View detailed stats in Reports tab</li>
                            <li>• Track daily/weekly/monthly goals</li>
                            <li>• Monitor learning progress and accuracy</li>
                            <li>• Export progress data as PDF</li>
                            <li>• Check struggling cards for review</li>
                          </ul>
                        </div>

                        <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-6 rounded-xl">
                          <h3 className="font-bold text-lg mb-3 text-purple-800 dark:text-purple-200">⚙️ Customization</h3>
                          <ul className="space-y-2 text-sm">
                            <li>• Switch between light/dark themes</li>
                            <li>• Adjust study modes: Normal/Cramming/Test</li>
                            <li>• Enable sound effects for feedback</li>
                            <li>• Set custom study goals and targets</li>
                            <li>• Import/export decks and progress</li>
                          </ul>
                        </div>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 p-6 rounded-xl">
                          <h3 className="font-bold text-lg mb-3 text-amber-800 dark:text-amber-200">🧠 Spaced Repetition</h3>
                          <p className="text-sm mb-3">This app uses the proven SM-2 algorithm:</p>
                          <ul className="space-y-2 text-sm">
                            <li>• <strong>Again (1):</strong> Shows card again in 1 minute</li>
                            <li>• <strong>Hard (2):</strong> Reduces card ease, shorter interval</li>
                            <li>• <strong>Good (3):</strong> Standard progression</li>
                            <li>• <strong>Easy (4):</strong> Longer intervals, faster progression</li>
                          </ul>
                          <div className="mt-3 p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <p className="text-xs text-amber-700 dark:text-amber-300">
                              💡 Rate honestly! The algorithm learns from your performance.
                            </p>
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-slate-50 to-gray-50 dark:from-slate-800 dark:to-gray-800 p-6 rounded-xl">
                          <h3 className="font-bold text-lg mb-3">🔧 Advanced Features</h3>
                          <ul className="space-y-2 text-sm">
                            <li>• <strong>Deck Editor:</strong> Create, edit, and manage cards</li>
                            <li>• <strong>CSV/JSON Import:</strong> Import from other apps</li>
                            <li>• <strong>Progress Backup:</strong> Export complete session state</li>
                            <li>• <strong>Undo:</strong> Reverse the last rating if needed</li>
                            <li>• <strong>Search:</strong> Find specific cards quickly</li>
                          </ul>
                        </div>

                        <div className="bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 p-6 rounded-xl">
                          <h3 className="font-bold text-lg mb-3 text-red-800 dark:text-red-200">⌨️ Keyboard Shortcuts</h3>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div><kbd className="px-2 py-1 bg-white dark:bg-slate-700 rounded shadow">Space</kbd> Flip/Next</div>
                            <div><kbd className="px-2 py-1 bg-white dark:bg-slate-700 rounded shadow">1-4</kbd> Rate Cards</div>
                            <div><kbd className="px-2 py-1 bg-white dark:bg-slate-700 rounded shadow">Esc</kbd> Pause</div>
                            <div><kbd className="px-2 py-1 bg-white dark:bg-slate-700 rounded shadow">H</kbd> Help</div>
                            <div><kbd className="px-2 py-1 bg-white dark:bg-slate-700 rounded shadow">Shift+N</kbd> Skip (Test)</div>
                            <div><kbd className="px-2 py-1 bg-white dark:bg-slate-700 rounded shadow">Shift+E</kbd> End (Test)</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-600 dark:text-slate-400">
                          Need more help? Check the Quick Help or browse Settings for detailed options.
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => { setShowTutorial(false); setShowHelp(true); }}
                            className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shimmer-dark"
                          >
                            Quick Help
                          </button>
                          <button 
                            onClick={() => setShowTutorial(false)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors shimmer-dark"
                          >
                            Got it!
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="p-4 text-center border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              SM-2 spaced repetition • {persist ? "Auto-saving enabled" : "Manual save only"}
            </p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
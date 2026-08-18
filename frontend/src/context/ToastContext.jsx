import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ToastContext = createContext();

export const useToast = () => {
  return useContext(ToastContext);
};

let audioCtx = null;

const playNotificationSound = () => {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
    oscillator.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1); // A6
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'info') => {
    playNotificationSound();
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    
    // Auto remove after 3.5 seconds
    setTimeout(() => {
      removeToast(id);
    }, 3500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback((message) => showToast(message, 'success'), [showToast]);
  const error = useCallback((message) => showToast(message, 'error'), [showToast]);
  const info = useCallback((message) => showToast(message, 'info'), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info }}>
      {children}
      {/* Toast Container */}
      <div className="fixed z-50 flex flex-col items-center sm:items-end sm:top-6 sm:right-6 top-4 right-0 left-0 sm:left-auto px-4 sm:px-0 gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const ToastItem = ({ toast, onRemove }) => {
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLeaving(true);
    }, 3200); // Start leaving animation slightly before actual removal
    return () => clearTimeout(timer);
  }, []);

  const getStyle = () => {
    switch (toast.type) {
      case 'success':
        return 'bg-green-600 text-white border-green-700';
      case 'error':
        return 'bg-red-600 text-white border-red-700';
      case 'info':
      default:
        return 'bg-blue-600 text-white border-blue-700';
    }
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'info':
      default: return 'i';
    }
  };

  return (
    <div
      className={`
        flex items-center p-4 rounded-md shadow-lg border w-full sm:w-80 pointer-events-auto
        transition-all duration-300 ease-in-out transform
        ${isLeaving ? 'opacity-0 scale-95 translate-y-[-10px]' : 'opacity-100 scale-100 translate-y-0'}
        animate-slide-in-top sm:animate-slide-in-right
        ${getStyle()}
      `}
      role="alert"
    >
      <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-white bg-opacity-20 mr-3 font-bold text-sm">
        {getIcon()}
      </div>
      <div className="flex-1 text-sm font-medium pr-2">
        {toast.message}
      </div>
      <button 
        onClick={() => {
          setIsLeaving(true);
          setTimeout(onRemove, 300);
        }}
        className="flex-shrink-0 text-white opacity-70 hover:opacity-100 focus:outline-none transition-opacity"
        aria-label="Close"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path>
        </svg>
      </button>
    </div>
  );
};

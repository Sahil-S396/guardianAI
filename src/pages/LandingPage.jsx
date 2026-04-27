import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LandingPage() {
  const { signInWithGoogle, authError, authDebug, clearAuthError } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    clearAuthError();
    setError('');
    setLoading(true);

    let redirected = false;

    try {
      const result = await signInWithGoogle();
      redirected = Boolean(result?.redirected);

      if (redirected) {
        return;
      }

      navigate('/dashboard');
    } catch (err) {
      setError(err?.userMessage || authError || 'Sign-in failed. Please try again.');
      console.error(err);
    } finally {
      if (!redirected) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-navy bg-grid-pattern relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-accent-red/5 blur-3xl" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-blue-600/5 blur-3xl" />
        <div className="absolute top-[40%] left-[50%] -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-purple-600/3 blur-3xl" />
      </div>

      <header className="relative z-10 px-8 py-5 flex items-center justify-between border-b border-white/[0.05]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-accent-red/20 border border-accent-red/30 shadow-glow-red">
            <svg className="w-5 h-5 text-accent-red" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z" />
            </svg>
          </div>
          <div>
            <span className="text-base font-bold text-white tracking-wide">GuardianAI</span>
            <span className="ml-2 text-[10px] font-medium uppercase tracking-widest text-white/30 border border-white/10 px-1.5 py-0.5 rounded">Beta</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span className="glow-dot-green" />
          <span>Systems Operational</span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-accent-red/30 bg-accent-red/5 text-accent-red text-xs font-semibold">
          <span className="glow-dot-red animate-ping-slow" />
          REAL-TIME REHAB & HOSPITALITY SAFETY INTELLIGENCE
        </div>

        <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-none mb-4">
          <span className="text-white">Guardian</span>
          <span className="text-gradient-red">AI</span>
        </h1>
        <p className="text-2xl md:text-3xl font-light text-white/60 mb-4">
          Rehab and Hospitality Safety, Powered by AI
        </p>
        <p className="max-w-xl text-base text-white/40 mb-10 leading-relaxed">
          Detect fires and falls in real-time across rehab centers and hospitality environments.
          Gemini AI triages every emergency in milliseconds, from alert to action.
        </p>

        <button
          id="google-signin-btn"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-white text-gray-900 font-bold text-base shadow-glass hover:bg-gray-100 transition-all duration-200 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-gray-800 animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
          )}
          {loading ? 'Signing in...' : 'Continue with Google'}
        </button>

        {(error || authError) && (
          <div className="mt-4 max-w-xl animate-fade-in">
            <p className="text-sm text-accent-red">{error || authError}</p>
            {authDebug && (
              <p className="mt-2 text-xs text-white/45 break-words">
                Firebase: <span className="font-mono">{authDebug.code}</span>
                {authDebug.message ? ` - ${authDebug.message}` : ''}
              </p>
            )}
          </div>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
          {[
            { icon: '🔥', label: 'Fire Detection' },
            { icon: '🚨', label: 'Fall Detection' },
            { icon: '🤖', label: 'Gemini AI Triage' },
            { icon: '⚡', label: 'Real-time Alerts' },
            { icon: '🎯', label: 'Drill Simulator' },
            { icon: '👥', label: 'Staff Dispatch' },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </main>

      <div className="relative z-10 border-t border-white/[0.06] px-8 py-5">
        <div className="max-w-3xl mx-auto grid grid-cols-3 gap-8 text-center">
          {[
            { value: '< 500ms', label: 'AI Response Time' },
            { value: '99.9%', label: 'Uptime SLA' },
            { value: '40s', label: 'Fall Detection Window' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-xl font-bold text-white">{stat.value}</p>
              <p className="text-xs text-white/40 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="relative z-10 text-center py-4 text-xs text-white/20 border-t border-white/[0.04]">
        © 2026 GuardianAI - Rehab and Hospitality Safety Intelligence Platform
      </footer>
    </div>
  );
}

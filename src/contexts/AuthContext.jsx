/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

const AuthContext = createContext(null);
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

function formatAuthError(error) {
  switch (error?.code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Retrying with a full-page redirect.';
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in window closed before the login completed.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in attempt interrupted the popup. Please try again.';
    case 'auth/unauthorized-domain':
      return 'This app domain is not authorized for Firebase Authentication yet.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled in Firebase Authentication for this project.';
    case 'auth/network-request-failed':
      return 'A network error interrupted sign-in. Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

function buildAuthDebug(error) {
  return {
    code: error?.code || 'unknown',
    message: error?.message || 'No additional details available.',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authDebug, setAuthDebug] = useState(null);

  useEffect(() => {
    let isMounted = true;
    let authStateReady = false;
    let redirectReady = false;

    const finishLoading = () => {
      if (isMounted && authStateReady && redirectReady) {
        setLoading(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!isMounted) {
        return;
      }

      setUser(firebaseUser);
      authStateReady = true;
      finishLoading();
    });

    getRedirectResult(auth)
      .then((result) => {
        if (!isMounted || !result?.user) {
          return;
        }

        setAuthError('');
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        console.error('Google redirect sign-in failed:', error);
        setAuthError(formatAuthError(error));
        setAuthDebug(buildAuthDebug(error));
      })
      .finally(() => {
        redirectReady = true;
        finishLoading();
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    setAuthError('');
    setAuthDebug(null);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      return { user: result.user, redirected: false };
    } catch (error) {
      if (POPUP_FALLBACK_CODES.has(error?.code)) {
        console.warn('Popup sign-in failed, falling back to redirect:', error);
        await signInWithRedirect(auth, googleProvider);
        return { user: null, redirected: true };
      }

      error.userMessage = formatAuthError(error);
      setAuthError(error.userMessage);
      setAuthDebug(buildAuthDebug(error));
      console.error('Google sign-in failed:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign-out failed:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authError,
        authDebug,
        signInWithGoogle,
        logout,
        clearAuthError: () => {
          setAuthError('');
          setAuthDebug(null);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

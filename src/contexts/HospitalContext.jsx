/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { TRACKING_MODES } from '../utils/staffTracker';

const HospitalContext = createContext(null);
const TRACKING_MODE_STORAGE_KEY = 'guardianai.trackingMode';

function buildHospitalId(user) {
  if (!user?.uid) {
    return null;
  }

  return `hospital-${user.uid}`;
}

export function HospitalProvider({ children }) {
  const { user } = useAuth();
  const [drillMode, setDrillMode] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState('all');
  const [selectedZone, setSelectedZone] = useState('all');
  const [trackingMode, setTrackingMode] = useState(() => {
    if (typeof window === 'undefined') {
      return TRACKING_MODES.LIVE;
    }

    return window.localStorage.getItem(TRACKING_MODE_STORAGE_KEY) || TRACKING_MODES.LIVE;
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(TRACKING_MODE_STORAGE_KEY, trackingMode);
  }, [trackingMode]);

  return (
    <HospitalContext.Provider value={{
      hospitalId: buildHospitalId(user),
      drillMode,
      setDrillMode,
      trackingMode,
      setTrackingMode,
      selectedFloor,
      setSelectedFloor,
      selectedZone,
      setSelectedZone,
    }}
    >
      {children}
    </HospitalContext.Provider>
  );
}

export function useHospital() {
  const ctx = useContext(HospitalContext);
  if (!ctx) throw new Error('useHospital must be used inside HospitalProvider');
  return ctx;
}

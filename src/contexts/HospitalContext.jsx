import React, { createContext, useContext, useState } from 'react';
import { useAuth } from './AuthContext';

const HospitalContext = createContext(null);

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

  return (
    <HospitalContext.Provider value={{
      hospitalId: buildHospitalId(user),
      drillMode,
      setDrillMode,
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

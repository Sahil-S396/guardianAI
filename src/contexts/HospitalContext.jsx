import React, { createContext, useContext, useState } from 'react';

const HospitalContext = createContext(null);

// Default hospital ID — in production you'd derive this from the authenticated user's profile
export const HOSPITAL_ID = 'hospital-001';

export function HospitalProvider({ children }) {
  const [drillMode, setDrillMode] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState('all');
  const [selectedZone, setSelectedZone] = useState('all');

  return (
    <HospitalContext.Provider value={{
      hospitalId: HOSPITAL_ID,
      drillMode,
      setDrillMode,
      selectedFloor,
      setSelectedFloor,
      selectedZone,
      setSelectedZone,
    }}>
      {children}
    </HospitalContext.Provider>
  );
}

export function useHospital() {
  const ctx = useContext(HospitalContext);
  if (!ctx) throw new Error('useHospital must be used inside HospitalProvider');
  return ctx;
}

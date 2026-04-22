import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import { callGeminiForAlert } from '../gemini';

const DRILL_SCENARIOS = [
  {
    id: 'fire-icu',
    label: 'ICU Fire Emergency',
    type: 'fire',
    roomName: 'ICU Bay 3',
    zone: 'A',
    floor: '3',
    description: 'Simulates a fire alert in a high-acuity ICU environment',
    icon: '🔥',
  },
  {
    id: 'fall-ward',
    label: 'Ward Patient Fall',
    type: 'fall',
    roomName: 'Ward 204',
    zone: 'B',
    floor: '2',
    description: 'Simulates a patient fall trigger in a general ward',
    icon: '🚨',
  },
  {
    id: 'fire-pharmacy',
    label: 'Pharmacy Fire',
    type: 'fire',
    roomName: 'Pharmacy Storage',
    zone: 'C',
    floor: '1',
    description: 'Tests response protocols for a fire in the pharmacy',
    icon: '💊🔥',
  },
  {
    id: 'fall-er',
    label: 'ER Fall Detection',
    type: 'fall',
    roomName: 'ER Room 12',
    zone: 'A',
    floor: '1',
    description: 'Simulates a fall trigger in the Emergency Room',
    icon: '🏥',
  },
  {
    id: 'fire-server-room',
    label: 'Server Room Fire',
    type: 'fire',
    roomName: 'IT Server Room',
    zone: 'D',
    floor: 'B1',
    description: 'Critical infrastructure fire scenario',
    icon: '💻🔥',
  },
];

export default function Drill() {
  const { drillMode, setDrillMode, hospitalId } = useHospital();
  const [staff, setStaff] = useState([]);
  const [running, setRunning] = useState(null); // scenario id
  const [results, setResults] = useState({}); // scenarioId → gemini response
  const [countdown, setCountdown] = useState(null); // { scenarioId, progress }
  const [drillLog, setDrillLog] = useState([]); // [{text, type, ts}]

  useEffect(() => {
    if (!hospitalId) return;
    const q = query(collection(db, `hospitals/${hospitalId}/staff`), where('available', '==', true));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [hospitalId]);

  const addLog = (text, type = 'info') => {
    const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDrillLog((prev) => [{ text, type, ts }, ...prev].slice(0, 50));
  };

  const runScenario = async (scenario) => {
    if (!drillMode) {
      addLog('⚠ Enable Drill Mode first before running scenarios.', 'warn');
      return;
    }
    setRunning(scenario.id);
    addLog(`🎯 Starting drill: ${scenario.label}`, 'info');

    // Countdown simulation
    let t = 40;
    if (scenario.type === 'fall') {
      const interval = setInterval(() => {
        t -= 1;
        setCountdown({ scenarioId: scenario.id, progress: Math.round((t / 40) * 100) });
        if (t <= 0) {
          clearInterval(interval);
          setCountdown(null);
          addLog(`⚑ Fall timer expired for ${scenario.roomName} — Alert would be created`, 'alert');
        }
      }, 100); // 10x speed for drill
    }

    try {
      addLog(`📡 Calling Gemini AI for ${scenario.roomName}…`, 'info');
      const geminiResponse = await callGeminiForAlert({
        roomName: scenario.roomName,
        zone: scenario.zone,
        floor: scenario.floor,
        alertType: scenario.type,
        nearbyStaff: staff.slice(0, 3),
        secondsSinceTrigger: scenario.type === 'fall' ? 40 : 0,
      });

      setResults((prev) => ({ ...prev, [scenario.id]: geminiResponse }));
      addLog(`✅ Gemini response: Severity=${geminiResponse.severity}, Evacuate=${geminiResponse.evacuationRequired}`, 'success');
      addLog(`👤 Suggested responder: ${geminiResponse.suggestedResponder}`, 'info');
    } catch (err) {
      addLog(`❌ Gemini API error: ${err.message}`, 'error');
    } finally {
      setRunning(null);
      setCountdown(null);
    }
  };

  const clearResults = () => {
    setResults({});
    setDrillLog([]);
    addLog('🗑 Drill results cleared', 'info');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Drill Mode Simulator</h1>
          <p className="text-sm text-white/40 mt-0.5">
            Test emergency protocols without triggering real alerts
          </p>
        </div>

        {/* Drill mode toggle */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-white/60">Drill Mode</span>
          <button
            id="drill-mode-toggle"
            onClick={() => {
              setDrillMode(!drillMode);
              addLog(drillMode ? '🔴 Drill mode deactivated' : '🟡 Drill mode ACTIVATED — amber UI enabled', drillMode ? 'info' : 'alert');
            }}
            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${
              drillMode ? 'bg-accent-amber' : 'bg-white/15'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-300 ${
              drillMode ? 'translate-x-8' : 'translate-x-1'
            }`} />
          </button>
          {drillMode && (
            <span className="animate-blink text-accent-amber font-bold text-xs uppercase tracking-widest">
              ACTIVE
            </span>
          )}
        </div>
      </div>

      {/* Drill mode warning */}
      {!drillMode && (
        <div className="alert-banner-fall">
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold">Drill Mode is OFF</p>
            <p className="text-xs opacity-70">Enable Drill Mode to run scenarios safely without triggering real alerts or escalations.</p>
          </div>
        </div>
      )}

      {drillMode && (
        <div className="p-4 rounded-lg bg-accent-amber/10 border border-accent-amber/30 flex items-center gap-3">
          <span className="glow-dot-amber animate-ping-slow" />
          <div>
            <p className="text-sm font-bold text-accent-amber">🎯 DRILL MODE ACTIVE</p>
            <p className="text-xs text-accent-amber/70">All alerts below are labeled as drills. No real escalations will occur.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Scenarios */}
        <div className="xl:col-span-2 space-y-4">
          <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Emergency Scenarios</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {DRILL_SCENARIOS.map((scenario) => {
              const result = results[scenario.id];
              const isRunning = running === scenario.id;
              const isCountdown = countdown?.scenarioId === scenario.id;

              return (
                <div
                  key={scenario.id}
                  className={`glass-card p-4 flex flex-col gap-3 transition-all duration-200 ${
                    drillMode ? 'border-accent-amber/20 hover:border-accent-amber/40' : 'opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{scenario.icon}</span>
                      <div>
                        <h3 className="text-sm font-semibold text-white">{scenario.label}</h3>
                        <p className="text-xs text-white/40 mt-0.5">{scenario.description}</p>
                      </div>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      scenario.type === 'fire' ? 'bg-accent-red/20 text-accent-red' : 'bg-accent-amber/20 text-accent-amber'
                    }`}>
                      {scenario.type}
                    </span>
                  </div>

                  {/* Countdown bar */}
                  {isCountdown && (
                    <div>
                      <div className="flex justify-between text-[10px] text-accent-amber mb-1">
                        <span>Fall countdown running (10x speed)…</span>
                        <span>{countdown.progress}%</span>
                      </div>
                      <div className="progress-bar-track">
                        <div className="progress-bar-fill bg-accent-amber" style={{ width: `${countdown.progress}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Gemini result */}
                  {result && (
                    <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span className="text-white/50">Severity</span>
                        <span className={`font-bold uppercase ${
                          result.severity === 'critical' ? 'text-accent-red' :
                          result.severity === 'high' ? 'text-orange-400' : 'text-accent-amber'
                        }`}>{result.severity}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/50">Evacuate</span>
                        <span className={result.evacuationRequired ? 'text-accent-red font-semibold' : 'text-emerald-400'}>
                          {result.evacuationRequired ? 'YES' : 'No'}
                        </span>
                      </div>
                      <div className="text-white/60 pt-1 border-t border-white/10">{result.immediateAction}</div>
                    </div>
                  )}

                  <button
                    id={`drill-scenario-${scenario.id}`}
                    onClick={() => runScenario(scenario)}
                    disabled={!drillMode || isRunning}
                    className={`w-full py-2 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95 disabled:cursor-not-allowed
                      ${drillMode
                        ? 'bg-accent-amber/20 text-accent-amber border border-accent-amber/30 hover:bg-accent-amber/30'
                        : 'bg-white/5 text-white/30 border border-white/10'
                      }`}
                  >
                    {isRunning ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-3 h-3 rounded-full border border-accent-amber/30 border-t-accent-amber animate-spin" />
                        Running…
                      </span>
                    ) : result ? '▶ Re-run Scenario' : '▶ Run Scenario'}
                  </button>
                </div>
              );
            })}
          </div>

          {Object.keys(results).length > 0 && (
            <button
              id="drill-clear-results"
              onClick={clearResults}
              className="btn-secondary text-xs"
            >
              Clear All Results
            </button>
          )}
        </div>

        {/* Drill Activity Log */}
        <div className="glass-card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Activity Log</h2>
            {drillLog.length > 0 && (
              <button onClick={() => setDrillLog([])} className="text-xs text-white/30 hover:text-white/60">Clear</button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 max-h-[500px]">
            {drillLog.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-white/25 text-xs">No drill activity yet.</p>
                <p className="text-white/15 text-[10px] mt-1">Enable Drill Mode and run a scenario.</p>
              </div>
            ) : drillLog.map((entry, i) => (
              <div key={i} className={`flex items-start gap-2 text-xs ${
                entry.type === 'error' ? 'text-accent-red' :
                entry.type === 'success' ? 'text-emerald-400' :
                entry.type === 'alert' ? 'text-accent-amber' :
                entry.type === 'warn' ? 'text-orange-400' :
                'text-white/60'
              }`}>
                <span className="shrink-0 font-mono text-white/25 text-[10px] mt-0.5">{entry.ts}</span>
                <span>{entry.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

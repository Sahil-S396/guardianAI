import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { onAuthStateChanged, signInWithRedirect } from 'firebase/auth';
import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import './index.css';
import {
  buildTrackingGraphFromExportedMap,
  buildTrackingGraphFromFloorMaps,
} from './utils/staffTracker';

export function QRCodePreview({ url }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !window.QRCode) {
      return;
    }

    containerRef.current.innerHTML = '';
    new window.QRCode(containerRef.current, {
      text: url,
      width: 132,
      height: 132,
      colorDark: '#071120',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  }, [url]);

  return <div ref={containerRef} className="overflow-hidden rounded-2xl bg-white p-3" />;
}

export function QrGeneratorApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const hospitalParam = params.get('hospital') || '';
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [floorMaps, setFloorMaps] = useState([]);
  const [uploadedMap, setUploadedMap] = useState(null);
  const [source, setSource] = useState('live');

  const hospitalId = hospitalParam || (user?.uid ? `hospital-${user.uid}` : '');

  useEffect(() => (
    onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    })
  ), []);

  useEffect(() => {
    if (!hospitalId || !user) {
      return undefined;
    }

    const unsub = onSnapshot(collection(db, `hospitals/${hospitalId}/floorMaps`), (snap) => {
      setFloorMaps(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });

    return unsub;
  }, [hospitalId, user]);

  const liveGraph = useMemo(() => buildTrackingGraphFromFloorMaps(floorMaps), [floorMaps]);
  const uploadedGraph = useMemo(() => buildTrackingGraphFromExportedMap(uploadedMap || {}), [uploadedMap]);
  const graph = source === 'uploaded' ? uploadedGraph : liveGraph;

  const nodes = [...graph.nodes]
    .sort((a, b) => {
      const floorCompare = String(a.floor).localeCompare(String(b.floor), undefined, { numeric: true, sensitivity: 'base' });
      if (floorCompare !== 0) {
        return floorCompare;
      }

      return String(a.label).localeCompare(String(b.label));
    });

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setUploadedMap(parsed);
      setSource('uploaded');
    } catch (error) {
      console.error('Map import failed:', error);
      setUploadedMap(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-6">
        <div className="glass-card flex w-full max-w-sm flex-col items-center gap-3 p-6 text-center">
          <div className="spinner" />
          <p className="text-sm text-white/60">Loading QR generator...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy px-4 py-6">
        <div className="glass-card w-full max-w-sm rounded-3xl p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">GuardianAI</p>
          <h1 className="mt-3 text-2xl font-bold text-white">QR generator</h1>
          <p className="mt-2 text-sm text-white/55">
            Sign in to pull your published floor map and print QR codes for each trackable zone.
          </p>
          <button
            type="button"
            onClick={() => signInWithRedirect(auth, googleProvider)}
            className="mt-5 w-full rounded-2xl border border-emerald-400/25 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy px-5 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">GuardianAI</p>
            <h1 className="mt-2 text-3xl font-black text-white">Staff QR Generator</h1>
            <p className="mt-2 text-sm text-white/55">
              Publish a floor from the map editor, then print these QR codes so staff can check in from their phones.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => window.print()} className="btn-secondary text-xs">
              Print cards
            </button>
            <a href="/checkin.html" className="btn-secondary text-xs">
              Open check-in page
            </a>
          </div>
        </div>

        <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSource('live')}
              className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                source === 'live'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-white/5 text-white/55 hover:bg-white/10'
              }`}
            >
              Live published floors
            </button>
            <button
              type="button"
              onClick={() => setSource('uploaded')}
              className={`rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                source === 'uploaded'
                  ? 'bg-accent-amber/15 text-accent-amber'
                  : 'bg-white/5 text-white/55 hover:bg-white/10'
              }`}
            >
              Uploaded export JSON
            </button>
          </div>

          <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 transition hover:bg-white/10">
            Upload export JSON
            <input type="file" accept=".json,application/json" onChange={handleUpload} className="hidden" />
          </label>
        </div>

        {nodes.length === 0 ? (
          <div className="glass-card rounded-3xl p-8 text-center">
            <p className="text-lg font-semibold text-white">No QR zones available yet</p>
            <p className="mt-2 text-sm text-white/50">
              {source === 'live'
                ? 'Publish at least one floor from the map editor, or switch to uploaded JSON mode.'
                : 'Upload the exported map JSON from the editor to generate QR cards.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {nodes.map((node) => {
              const url = `${window.location.origin}/checkin.html?hospital=${encodeURIComponent(hospitalId)}&zone=${encodeURIComponent(node.id)}&floor=${encodeURIComponent(node.floor)}&label=${encodeURIComponent(node.label)}`;

              return (
                <div key={node.id} className="glass-card rounded-3xl border border-white/10 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Floor {node.floor}</p>
                      <h2 className="mt-2 text-lg font-semibold text-white">{node.label}</h2>
                      <p className="mt-1 text-sm text-white/50">{node.type.replace(/_/g, ' ')}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                      {node.id}
                    </span>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-4">
                    <QRCodePreview url={url} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-[0.18em] text-white/35">Scan target</p>
                      <p className="mt-2 break-all text-xs text-white/55">{url}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QrGeneratorApp />
  </React.StrictMode>
);

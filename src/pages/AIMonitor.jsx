import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useHospital } from '../contexts/HospitalContext';
import { useAuth } from '../contexts/AuthContext';
import { analyzeCameraFrame } from '../gemini';
import { createEmergencyAlert } from '../utils/alertService';
import {
  AI_SAMPLE_MS,
  ALERT_COOLDOWN_MS,
  DETECTION_LOG_MS,
  LOCAL_SAMPLE_MS,
  MONITOR_SYNC_MS,
  analyzeLocalFrame,
  buildMonitorId,
  mergeDetectionScores,
  shouldTriggerAlert,
} from '../utils/aiMonitoring';
import { sortFloorLabels } from '../utils/floorPublishing';
import { formatDistanceToNow, formatTimestamp } from '../utils/time';

const INPUT_SOURCES = {
  CAMERA: 'camera',
  FILE: 'file',
};

const DEFAULT_LOCAL_SCORES = {
  localFireScore: 0,
  localFallScore: 0,
  metrics: {
    fireRatio: 0,
    heatRatio: 0,
    averageBrightness: 0,
    motionRatio: 0,
    motionPixels: 0,
    aspectRatio: 0,
    verticalDrop: 0,
  },
};

const DEFAULT_COMBINED_SCORES = {
  fireScore: 0,
  fallScore: 0,
  crisisScore: 0,
  dominantType: 'fire',
  dominantScore: 0,
  level: 'stable',
  summary: 'Camera feed is stable.',
};

function waitForVideoReady(videoElement, timeoutMs = 5000) {
  if (!videoElement) {
    return Promise.reject(new Error('Camera preview is unavailable.'));
  }

  if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;

    const cleanup = () => {
      videoElement.removeEventListener('loadedmetadata', handleReady);
      videoElement.removeEventListener('loadeddata', handleReady);
      videoElement.removeEventListener('canplay', handleReady);
      videoElement.removeEventListener('error', handleError);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };

    const finalize = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const handleReady = () => finalize(resolve);
    const handleError = () => finalize(() => reject(new Error('The camera feed could not be rendered.')));

    timeoutId = window.setTimeout(() => {
      finalize(() => reject(new Error('Timed out while waiting for the camera feed to start.')));
    }, timeoutMs);

    videoElement.addEventListener('loadedmetadata', handleReady, { once: true });
    videoElement.addEventListener('loadeddata', handleReady, { once: true });
    videoElement.addEventListener('canplay', handleReady, { once: true });
    videoElement.addEventListener('error', handleError, { once: true });
  });
}

function getCameraStartErrorMessage(error) {
  const errorName = String(error?.name || '');

  if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
    return 'Camera permission was blocked. Allow browser camera access and try again.';
  }

  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return 'No usable camera was found. Plug in a camera or refresh the device list.';
  }

  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return 'The selected camera is busy or unavailable. Close other apps using it and try again.';
  }

  if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
    return 'The selected camera profile is unavailable right now. Refresh cameras and try again.';
  }

  if (errorName === 'AbortError') {
    return 'The camera feed was interrupted while starting. Please try again.';
  }

  return error?.message || 'Unable to start the selected video source.';
}

export default function AIMonitor() {
  const { hospitalId, drillMode } = useHospital();
  const { user } = useAuth();

  const [rooms, setRooms] = useState([]);
  const [monitors, setMonitors] = useState([]);
  const [detections, setDetections] = useState([]);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [cameraLabel, setCameraLabel] = useState('North Hall Cam');
  const [inputSource, setInputSource] = useState(INPUT_SOURCES.CAMERA);
  const [demoFile, setDemoFile] = useState(null);
  const [fireEnabled, setFireEnabled] = useState(true);
  const [fallEnabled, setFallEnabled] = useState(true);
  const [aiAssistEnabled, setAiAssistEnabled] = useState(Boolean(import.meta.env.VITE_GEMINI_API_KEY));
  const [monitoring, setMonitoring] = useState(false);
  const [starting, setStarting] = useState(false);
  const [localScores, setLocalScores] = useState(DEFAULT_LOCAL_SCORES);
  const [aiResult, setAiResult] = useState(null);
  const [combinedScores, setCombinedScores] = useState(DEFAULT_COMBINED_SCORES);
  const [lastAnalysisAt, setLastAnalysisAt] = useState(null);
  const [lastAlertId, setLastAlertId] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [statusMessage, setStatusMessage] = useState('Select an area and start monitoring.');

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const demoFileUrlRef = useRef('');
  const previousFrameStateRef = useRef(null);
  const activeMonitorIdRef = useRef(null);
  const analysisBusyRef = useRef(false);
  const aiBusyRef = useRef(false);
  const localTimerRef = useRef(null);
  const aiTimerRef = useRef(null);
  const lastMonitorSyncAtRef = useRef(0);
  const lastDetectionWriteAtRef = useRef(0);
  const lastDetectionKeyRef = useRef('');
  const lastAlertAtRef = useRef(0);
  const configRef = useRef({
    selectedRoom: null,
    fireEnabled: true,
    fallEnabled: true,
    aiAssistEnabled: false,
    cameraLabel: 'North Hall Cam',
    userId: null,
    drillMode: false,
    inputSource: INPUT_SOURCES.CAMERA,
    demoFileName: '',
  });
  const aiResultRef = useRef(null);

  const sortedRooms = useMemo(() => {
    return [...rooms].sort((a, b) => {
      const floorSort = sortFloorLabels(String(a.floor || ''), String(b.floor || ''));
      if (floorSort !== 0) return floorSort;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [rooms]);

  const selectedRoom = useMemo(
    () => sortedRooms.find((room) => room.id === selectedRoomId) || null,
    [selectedRoomId, sortedRooms]
  );

  const activeMonitors = useMemo(
    () => monitors.filter((monitor) => monitor.isActive || monitor.status === 'active' || monitor.status === 'alerting'),
    [monitors]
  );

  useEffect(() => {
    configRef.current = {
      selectedRoom,
      fireEnabled,
      fallEnabled,
      aiAssistEnabled,
      cameraLabel,
      userId: user?.uid || null,
      drillMode,
      inputSource,
      demoFileName: demoFile?.name || '',
    };
  }, [selectedRoom, fireEnabled, fallEnabled, aiAssistEnabled, cameraLabel, user, drillMode, inputSource, demoFile]);

  useEffect(() => {
    aiResultRef.current = aiResult;
  }, [aiResult]);

  useEffect(() => {
    if (demoFileUrlRef.current) {
      URL.revokeObjectURL(demoFileUrlRef.current);
      demoFileUrlRef.current = '';
    }

    if (!demoFile) return undefined;

    const objectUrl = URL.createObjectURL(demoFile);
    demoFileUrlRef.current = objectUrl;

    if (videoRef.current && inputSource === INPUT_SOURCES.FILE && !monitoring) {
      videoRef.current.src = objectUrl;
    }

    return () => {
      if (demoFileUrlRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        demoFileUrlRef.current = '';
      }
    };
  }, [demoFile, inputSource, monitoring]);

  useEffect(() => {
    if (!videoRef.current || monitoring) {
      return;
    }

    if (inputSource === INPUT_SOURCES.CAMERA) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.srcObject = null;
      videoRef.current.load();
      return;
    }

    if (inputSource === INPUT_SOURCES.FILE && demoFileUrlRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.src = demoFileUrlRef.current;
      videoRef.current.load();
    }
  }, [inputSource, monitoring]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsubscribe = onSnapshot(collection(db, `hospitals/${hospitalId}/rooms`), (snapshot) => {
      const nextRooms = snapshot.docs.map((roomDoc) => ({
        id: roomDoc.id,
        ...roomDoc.data(),
      }));
      setRooms(nextRooms);
      setSelectedRoomId((current) => current || nextRooms[0]?.id || '');
    });

    return unsubscribe;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsubscribe = onSnapshot(collection(db, `hospitals/${hospitalId}/aiMonitors`), (snapshot) => {
      const nextMonitors = snapshot.docs.map((monitorDoc) => ({
        id: monitorDoc.id,
        ...monitorDoc.data(),
      }));

      nextMonitors.sort((a, b) => {
        const aTime = a.lastHeartbeatAt?.seconds || 0;
        const bTime = b.lastHeartbeatAt?.seconds || 0;
        return bTime - aTime;
      });

      setMonitors(nextMonitors);
    });

    return unsubscribe;
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return undefined;

    const unsubscribe = onSnapshot(
      query(collection(db, `hospitals/${hospitalId}/aiDetections`), orderBy('createdAt', 'desc'), limit(12)),
      (snapshot) => {
        setDetections(snapshot.docs.map((detectionDoc) => ({ id: detectionDoc.id, ...detectionDoc.data() })));
      }
    );

    return unsubscribe;
  }, [hospitalId]);

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((device) => device.kind === 'videoinput');
    setCameraDevices(videoInputs);
    if (!selectedDeviceId && videoInputs[0]?.deviceId) {
      setSelectedDeviceId(videoInputs[0].deviceId);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    let active = true;

    if (!navigator.mediaDevices?.enumerateDevices) {
      return () => {
        active = false;
      };
    }

    navigator.mediaDevices.enumerateDevices()
      .then((devices) => {
        if (!active) return;
        const videoInputs = devices.filter((device) => device.kind === 'videoinput');
        setCameraDevices(videoInputs);
        setSelectedDeviceId((current) => current || videoInputs[0]?.deviceId || '');
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const syncMonitor = useCallback(async (payload) => {
    if (!hospitalId || !activeMonitorIdRef.current) return;

    await setDoc(doc(db, `hospitals/${hospitalId}/aiMonitors`, activeMonitorIdRef.current), payload, { merge: true });
  }, [hospitalId]);

  const stopMonitoring = useCallback(async () => {
    if (localTimerRef.current) {
      window.clearInterval(localTimerRef.current);
      localTimerRef.current = null;
    }

    if (aiTimerRef.current) {
      window.clearInterval(aiTimerRef.current);
      aiTimerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    previousFrameStateRef.current = null;
    analysisBusyRef.current = false;
    aiBusyRef.current = false;
    setMonitoring(false);
    setStatusMessage('Camera monitor paused.');

    if (hospitalId && activeMonitorIdRef.current) {
      try {
        await setDoc(
          doc(db, `hospitals/${hospitalId}/aiMonitors`, activeMonitorIdRef.current),
          { isActive: false, status: 'idle', lastStoppedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (error) {
        console.error('Failed to stop monitor session:', error);
      }
    }
  }, [hospitalId]);

  useEffect(() => () => {
    stopMonitoring().catch(() => {});
  }, [stopMonitoring]);

  const runLocalAnalysis = useCallback(async () => {
    if (analysisBusyRef.current || !monitoring || !videoRef.current || !canvasRef.current) return;
    if (videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const {
      selectedRoom: room,
      fireEnabled: fireOn,
      fallEnabled: fallOn,
      cameraLabel: label,
      userId,
      inputSource: activeInputSource,
      demoFileName,
    } = configRef.current;

    if (!room) return;

    analysisBusyRef.current = true;

    try {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const width = canvas.width;
      const height = canvas.height;

      context.drawImage(videoRef.current, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const nextLocalScores = analyzeLocalFrame(imageData, previousFrameStateRef.current);
      previousFrameStateRef.current = nextLocalScores.frameState;

      const normalizedLocalScores = {
        ...nextLocalScores,
        localFireScore: fireOn ? nextLocalScores.localFireScore : 0,
        localFallScore: fallOn ? nextLocalScores.localFallScore : 0,
      };

      setLocalScores(normalizedLocalScores);

      const mergedScores = mergeDetectionScores({
        localFireScore: normalizedLocalScores.localFireScore,
        localFallScore: normalizedLocalScores.localFallScore,
        aiFireScore: fireOn ? aiResultRef.current?.fireScore ?? null : null,
        aiFallScore: fallOn ? aiResultRef.current?.fallScore ?? null : null,
        aiSummary: aiResultRef.current?.summary || '',
        roomName: room.name,
      });

      setCombinedScores(mergedScores);
      setLastAnalysisAt(new Date());
      setStatusMessage(mergedScores.summary);

      const now = Date.now();
      const monitorStatus = mergedScores.level === 'critical' ? 'alerting' : 'active';
      const sourceLabel = activeInputSource === INPUT_SOURCES.FILE ? 'Local Demo File' : 'Live Camera';
      const detectionPayload = {
        roomId: room.id,
        roomName: room.name,
        roomFloor: room.floor,
        roomZone: room.zone,
        cameraLabel: label,
        sourceType: activeInputSource,
        sourceLabel,
        demoFileName: demoFileName || null,
        fireScore: mergedScores.fireScore,
        fallScore: mergedScores.fallScore,
        crisisScore: mergedScores.crisisScore,
        dominantType: mergedScores.dominantType,
        dominantScore: mergedScores.dominantScore,
        level: mergedScores.level,
        summary: mergedScores.summary,
        localSignals: normalizedLocalScores.metrics,
        aiSignals: aiResultRef.current
          ? {
              fireScore: aiResultRef.current.fireScore,
              fallScore: aiResultRef.current.fallScore,
              summary: aiResultRef.current.summary,
              visibleHazards: aiResultRef.current.visibleHazards,
              recommendedAction: aiResultRef.current.recommendedAction,
            }
          : null,
      };

      if ((now - lastMonitorSyncAtRef.current) >= MONITOR_SYNC_MS) {
        await syncMonitor({
          roomId: room.id,
          roomName: room.name,
          roomFloor: room.floor,
          roomZone: room.zone,
          cameraLabel: label,
          inputSource: activeInputSource,
          sourceLabel,
          demoFileName: demoFileName || null,
          isActive: true,
          status: monitorStatus,
          fireEnabled: fireOn,
          fallEnabled: fallOn,
          aiAssistEnabled: configRef.current.aiAssistEnabled,
          fireScore: mergedScores.fireScore,
          fallScore: mergedScores.fallScore,
          crisisScore: mergedScores.crisisScore,
          dominantType: mergedScores.dominantType,
          level: mergedScores.level,
          summary: mergedScores.summary,
          lastHeartbeatAt: serverTimestamp(),
        });
        lastMonitorSyncAtRef.current = now;
      }

      if (mergedScores.level !== 'stable' && (now - lastDetectionWriteAtRef.current) >= DETECTION_LOG_MS) {
        const nextDetectionKey = `${mergedScores.level}:${mergedScores.dominantType}:${Math.round(mergedScores.dominantScore / 5)}`;
        if (nextDetectionKey !== lastDetectionKeyRef.current) {
          await addDoc(collection(db, `hospitals/${hospitalId}/aiDetections`), {
            monitorId: activeMonitorIdRef.current,
            roomId: room.id,
            roomName: room.name,
            roomFloor: room.floor,
            roomZone: room.zone,
            cameraLabel: label,
            inputSource: activeInputSource,
            sourceLabel,
            demoFileName: demoFileName || null,
            type: mergedScores.dominantType,
            fireScore: mergedScores.fireScore,
            fallScore: mergedScores.fallScore,
            crisisScore: mergedScores.crisisScore,
            level: mergedScores.level,
            summary: mergedScores.summary,
            alertId: null,
            createdAt: serverTimestamp(),
          });

          lastDetectionWriteAtRef.current = now;
          lastDetectionKeyRef.current = nextDetectionKey;
        }
      }

      if (shouldTriggerAlert(mergedScores) && (now - lastAlertAtRef.current) >= ALERT_COOLDOWN_MS) {
        const alertType = mergedScores.fireScore >= mergedScores.fallScore ? 'fire' : 'fall';
        const result = await createEmergencyAlert({
          hospitalId,
          room,
          alertType,
          drillMode: configRef.current.drillMode,
          userId,
          source: 'ai-monitor',
          sourceMonitorId: activeMonitorIdRef.current,
          cameraLabel: label,
          detectionSnapshot: detectionPayload,
        });

        lastAlertAtRef.current = now;
        setLastAlertId(result.alertId);

        await syncMonitor({
          status: 'alerting',
          lastAlertAt: serverTimestamp(),
          lastAlertId: result.alertId,
          lastAlertType: alertType,
        });

        await addDoc(collection(db, `hospitals/${hospitalId}/aiDetections`), {
          monitorId: activeMonitorIdRef.current,
          roomId: room.id,
          roomName: room.name,
          roomFloor: room.floor,
          roomZone: room.zone,
          cameraLabel: label,
          inputSource: activeInputSource,
          sourceLabel,
          demoFileName: demoFileName || null,
          type: alertType,
          fireScore: mergedScores.fireScore,
          fallScore: mergedScores.fallScore,
          crisisScore: mergedScores.crisisScore,
          level: 'critical',
          summary: result.duplicate
            ? `Ongoing ${alertType} alert confirmed again by ${sourceLabel.toLowerCase()}.`
            : `AI monitor raised a ${alertType} alert for ${room.name}.`,
          alertId: result.alertId,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Local camera analysis failed:', error);
      setCameraError(error?.message || 'Camera analysis failed.');
    } finally {
      analysisBusyRef.current = false;
    }
  }, [hospitalId, monitoring, syncMonitor]);

  const runAiAnalysis = useCallback(async () => {
    if (aiBusyRef.current || !monitoring || !configRef.current.aiAssistEnabled || !videoRef.current || !canvasRef.current) return;
    if (videoRef.current.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const { selectedRoom: room, cameraLabel: label } = configRef.current;
    if (!room) return;

    aiBusyRef.current = true;

    try {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      const base64Image = canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
      const response = await analyzeCameraFrame(base64Image, {
        roomName: room.name,
        floor: room.floor,
        zone: room.zone,
        cameraLabel: label,
      });

      setAiResult(response);
    } catch (error) {
      console.error('AI frame analysis failed:', error);
      setAiResult(null);
    } finally {
      aiBusyRef.current = false;
    }
  }, [monitoring]);

  const prepareMonitorSession = useCallback(async () => {
    const monitorSuffix = inputSource === INPUT_SOURCES.FILE
      ? demoFile?.name || 'demo-file'
      : selectedDeviceId;
    const monitorId = buildMonitorId(selectedRoom.id, cameraLabel, monitorSuffix);

    activeMonitorIdRef.current = monitorId;
    lastAlertAtRef.current = 0;
    lastMonitorSyncAtRef.current = 0;
    lastDetectionWriteAtRef.current = 0;
    lastDetectionKeyRef.current = '';
    previousFrameStateRef.current = null;
    setAiResult(null);
    setLastAlertId(null);

    await setDoc(
      doc(db, `hospitals/${hospitalId}/aiMonitors`, monitorId),
      {
        roomId: selectedRoom.id,
        roomName: selectedRoom.name,
        roomFloor: selectedRoom.floor,
        roomZone: selectedRoom.zone,
        cameraLabel,
        deviceId: inputSource === INPUT_SOURCES.CAMERA ? (selectedDeviceId || null) : null,
        inputSource,
        sourceLabel: inputSource === INPUT_SOURCES.FILE ? 'Local Demo File' : 'Live Camera',
        demoFileName: demoFile?.name || null,
        createdBy: user?.uid || null,
        fireEnabled,
        fallEnabled,
        aiAssistEnabled,
        isActive: true,
        status: 'active',
        fireScore: 0,
        fallScore: 0,
        crisisScore: 0,
        lastStartedAt: serverTimestamp(),
        lastHeartbeatAt: serverTimestamp(),
      },
      { merge: true }
    );

  }, [
    aiAssistEnabled,
    cameraLabel,
    demoFile,
    fallEnabled,
    fireEnabled,
    hospitalId,
    inputSource,
    selectedDeviceId,
    selectedRoom,
    user,
  ]);

  const startCameraStream = useCallback(async () => {
    const requestedConstraints = selectedDeviceId
      ? { video: { deviceId: { exact: selectedDeviceId } }, audio: false }
      : { video: true, audio: false };

    try {
      return await navigator.mediaDevices.getUserMedia(requestedConstraints);
    } catch (error) {
      const errorName = String(error?.name || '');
      const shouldFallbackToDefault = Boolean(selectedDeviceId)
        && (errorName === 'OverconstrainedError'
          || errorName === 'ConstraintNotSatisfiedError'
          || errorName === 'NotFoundError');

      if (!shouldFallbackToDefault) {
        throw error;
      }

      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }, [selectedDeviceId]);

  const handleStartMonitoring = useCallback(async () => {
    if (!hospitalId || !selectedRoom) {
      setCameraError('Choose a room or zone before starting the monitor.');
      return;
    }

    if (!fireEnabled && !fallEnabled) {
      setCameraError('Enable at least one detector before starting the monitor.');
      return;
    }

    if (inputSource === INPUT_SOURCES.FILE && !demoFile) {
      setCameraError('Choose a local demo file before starting file playback.');
      return;
    }

    if (inputSource === INPUT_SOURCES.CAMERA && !navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support live camera capture.');
      return;
    }

    setStarting(true);
    setCameraError('');

    try {
      if (inputSource === INPUT_SOURCES.CAMERA) {
        const stream = await startCameraStream();
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          videoRef.current.autoplay = true;
          videoRef.current.srcObject = stream;
          await waitForVideoReady(videoRef.current);
          await videoRef.current.play();
        }

        await refreshCameraDevices();
      } else if (videoRef.current && demoFileUrlRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.src = demoFileUrlRef.current;
        videoRef.current.currentTime = 0;
        videoRef.current.loop = true;
        await waitForVideoReady(videoRef.current);
        await videoRef.current.play();
        videoRef.current.onended = null;
      }

      setMonitoring(true);
      setStatusMessage(
        inputSource === INPUT_SOURCES.FILE
          ? `Monitoring demo file ${demoFile?.name || ''} in ${selectedRoom.name}.`
          : `Monitoring ${selectedRoom.name} through ${cameraLabel}.`
      );

      try {
        await prepareMonitorSession();
      } catch (sessionError) {
        console.error('Monitor backend session init failed:', sessionError);
        setCameraError('Live preview started, but backend sync could not initialize immediately. Monitoring will keep trying.');
      }
    } catch (error) {
      console.error('Failed to start monitor:', error);
      setCameraError(getCameraStartErrorMessage(error));
      await stopMonitoring();
    } finally {
      setStarting(false);
    }
  }, [
    cameraLabel,
    demoFile,
    fallEnabled,
    fireEnabled,
    hospitalId,
    inputSource,
    prepareMonitorSession,
    refreshCameraDevices,
    selectedRoom,
    startCameraStream,
    stopMonitoring,
  ]);

  useEffect(() => {
    if (!monitoring) return undefined;

    localTimerRef.current = window.setInterval(() => {
      runLocalAnalysis().catch(() => {});
    }, LOCAL_SAMPLE_MS);

    if (configRef.current.aiAssistEnabled) {
      aiTimerRef.current = window.setInterval(() => {
        runAiAnalysis().catch(() => {});
      }, AI_SAMPLE_MS);
    }

    runLocalAnalysis().catch(() => {});
    if (configRef.current.aiAssistEnabled) {
      runAiAnalysis().catch(() => {});
    }

    return () => {
      if (localTimerRef.current) {
        window.clearInterval(localTimerRef.current);
        localTimerRef.current = null;
      }
      if (aiTimerRef.current) {
        window.clearInterval(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [aiAssistEnabled, monitoring, runAiAnalysis, runLocalAnalysis]);

  const handleDemoFileChange = useCallback((event) => {
    const nextFile = event.target.files?.[0] || null;
    setDemoFile(nextFile);
    if (nextFile && !cameraLabel.trim()) {
      setCameraLabel(nextFile.name.replace(/\.[^.]+$/, ''));
    }
  }, [cameraLabel]);

  const renderScorePill = (label, score, accentClass) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentClass}`}>{score}</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Camera Monitor</h1>
          <p className="mt-1 max-w-3xl text-sm text-white/45">
            Live fire and fall monitoring from camera feeds or local demo files, with detector scores synced to Firestore and automatic alert creation when the crisis engine crosses threshold.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/55">
            {activeMonitors.length} active {activeMonitors.length === 1 ? 'camera' : 'cameras'}
          </div>
          <div className={`rounded-full border px-3 py-1.5 text-xs ${
            combinedScores.level === 'critical'
              ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
              : combinedScores.level === 'watch'
              ? 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
          >
            Crisis engine: {combinedScores.level}
          </div>
          {drillMode && <span className="badge-alert">Drill mode enabled</span>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr,0.95fr]">
        <div className="space-y-6">
          <div className="glass-card overflow-hidden border-white/10">
            <div className="relative bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.2),transparent_55%),linear-gradient(180deg,#11192d_0%,#07101f_100%)]">
              <video ref={videoRef} className="aspect-video w-full bg-black/50 object-cover" autoPlay muted playsInline />
              <canvas ref={canvasRef} width={320} height={180} className="hidden" />

              {!monitoring && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy/70 backdrop-blur-sm">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-5 text-center">
                    <p className="text-sm font-semibold text-white">{inputSource === INPUT_SOURCES.FILE ? 'Demo file standby' : 'Camera standby'}</p>
                    <p className="mt-1 text-xs text-white/45">
                      {inputSource === INPUT_SOURCES.FILE
                        ? 'Choose a local video file and start playback for the demo.'
                        : 'Choose a room, grant camera access, and start live monitoring.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/15 bg-black/45 px-3 py-1 text-xs text-white/75">
                  {selectedRoom ? `${selectedRoom.name} • Floor ${selectedRoom.floor}` : 'No area selected'}
                </span>
                <span className="rounded-full border border-white/15 bg-black/45 px-3 py-1 text-xs text-white/75">
                  {inputSource === INPUT_SOURCES.FILE ? `Demo File${demoFile ? ` • ${demoFile.name}` : ''}` : cameraLabel}
                </span>
              </div>

              <div className="absolute bottom-4 left-4 right-4 grid gap-3 md:grid-cols-4">
                {renderScorePill('Fire', combinedScores.fireScore, combinedScores.fireScore >= 70 ? 'text-accent-red' : 'text-white')}
                {renderScorePill('Fall', combinedScores.fallScore, combinedScores.fallScore >= 68 ? 'text-accent-amber' : 'text-white')}
                {renderScorePill('Crisis', combinedScores.crisisScore, combinedScores.crisisScore >= 70 ? 'text-accent-red' : combinedScores.crisisScore >= 45 ? 'text-accent-amber' : 'text-emerald-300')}
                <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">State</p>
                  <p className={`mt-1 text-sm font-semibold capitalize ${
                    combinedScores.level === 'critical'
                      ? 'text-accent-red'
                      : combinedScores.level === 'watch'
                      ? 'text-accent-amber'
                      : 'text-emerald-300'
                  }`}
                  >
                    {combinedScores.level}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/10 p-5 md:grid-cols-[1.05fr,0.95fr]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">Live detector summary</p>
                    <p className="mt-1 text-sm text-white/80">{statusMessage}</p>
                  </div>
                  {lastAnalysisAt && <span className="text-[11px] text-white/35">Updated {formatDistanceToNow(lastAnalysisAt)}</span>}
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-white/55">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-white/35">Local fire signal</p>
                    <p className="mt-1 text-lg font-semibold text-white">{localScores.localFireScore}</p>
                    <p className="mt-1 text-[11px]">Heat signature: {(localScores.metrics.heatRatio * 100).toFixed(1)}%</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-white/35">Local fall signal</p>
                    <p className="mt-1 text-lg font-semibold text-white">{localScores.localFallScore}</p>
                    <p className="mt-1 text-[11px]">Motion ratio: {(localScores.metrics.motionRatio * 100).toFixed(1)}%</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-white/35">Vision AI fire</p>
                    <p className="mt-1 text-lg font-semibold text-white">{aiResult?.fireScore ?? '--'}</p>
                    <p className="mt-1 text-[11px]">{aiAssistEnabled ? 'Gemini-assisted confirmation' : 'AI assist disabled'}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-white/35">Vision AI fall</p>
                    <p className="mt-1 text-lg font-semibold text-white">{aiResult?.fallScore ?? '--'}</p>
                    <p className="mt-1 text-[11px]">{aiResult?.detectedType ? `Latest: ${aiResult.detectedType}` : 'No AI frame review yet'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">Backend sync</p>
                    <span className="badge-active">Firestore live</span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-white/65">
                    <p>Monitor state writes to `aiMonitors` every few seconds while the feed is active.</p>
                    <p>Elevated detections are logged into `aiDetections` for the incident trail.</p>
                    <p>Critical fire or fall events create standard alerts in the shared `alerts` backend.</p>
                  </div>
                </div>

                {lastAlertId ? (
                  <div className="rounded-xl border border-accent-red/20 bg-accent-red/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-accent-red/70">Latest triggered alert</p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="font-mono text-sm text-white/85">{lastAlertId}</p>
                      <Link to={`/alerts/${lastAlertId}`} className="btn-secondary px-3 py-2 text-xs">Open alert</Link>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
                    No auto-triggered alert during this session yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <div className="section-header">
              <h2 className="section-title">Recent AI Detections</h2>
              <span className="text-xs text-white/40">{detections.length} entries</span>
            </div>

            {detections.length === 0 ? (
              <p className="text-sm text-white/35">No AI detections logged yet. Start a monitor to build the incident trail.</p>
            ) : (
              <div className="space-y-3">
                {detections.map((detection) => (
                  <div key={detection.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`capitalize ${detection.type === 'fire' ? 'text-accent-red' : 'text-accent-amber'}`}>{detection.type}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                            detection.level === 'critical' ? 'bg-accent-red/15 text-accent-red' : 'bg-accent-amber/15 text-accent-amber'
                          }`}
                          >
                            {detection.level}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-white/80">{detection.summary}</p>
                        <p className="mt-1 text-xs text-white/40">
                          {detection.roomName} • Floor {detection.roomFloor} • {detection.cameraLabel}
                          {detection.demoFileName ? ` • ${detection.demoFileName}` : ''}
                        </p>
                      </div>

                      <div className="text-right text-xs text-white/45">
                        <p>{formatTimestamp(detection.createdAt)}</p>
                        <p className="mt-1">Fire {detection.fireScore ?? 0} • Fall {detection.fallScore ?? 0}</p>
                        {detection.alertId && (
                          <Link to={`/alerts/${detection.alertId}`} className="mt-2 inline-flex text-accent-blue hover:text-blue-300">
                            Linked alert
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-5">
            <div className="section-header">
              <h2 className="section-title">Monitor Controls</h2>
              {monitoring ? <span className="badge-active">Live</span> : <span className="badge-clear">Idle</span>}
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/45">Video Source</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setInputSource(INPUT_SOURCES.CAMERA)}
                    disabled={monitoring}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      inputSource === INPUT_SOURCES.CAMERA
                        ? 'border-accent-blue/35 bg-accent-blue/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/70'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <p className="text-sm font-semibold">Live Camera</p>
                    <p className="mt-1 text-[11px] text-white/45">Browser webcam or virtual camera</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputSource(INPUT_SOURCES.FILE)}
                    disabled={monitoring}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      inputSource === INPUT_SOURCES.FILE
                        ? 'border-accent-blue/35 bg-accent-blue/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-white/70'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <p className="text-sm font-semibold">Local Demo File</p>
                    <p className="mt-1 text-[11px] text-white/45">Play MP4/WebM footage inside the monitor</p>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/45">Area / Room</label>
                <select value={selectedRoomId} onChange={(event) => setSelectedRoomId(event.target.value)} className="guardian-select" disabled={monitoring}>
                  {sortedRooms.map((room) => (
                    <option key={room.id} value={room.id}>Floor {room.floor} • {room.name}</option>
                  ))}
                </select>
              </div>

              {inputSource === INPUT_SOURCES.CAMERA ? (
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/45">Camera Device</label>
                  <select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)} className="guardian-select" disabled={monitoring}>
                    {cameraDevices.length === 0 && <option value="">Default camera</option>}
                    {cameraDevices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/45">Local Demo File</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="video/mp4,video/webm,video/ogg"
                      onChange={handleDemoFileChange}
                      disabled={monitoring}
                      className="block w-full cursor-pointer rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white file:mr-3 file:rounded-md file:border-0 file:bg-accent-blue/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-accent-blue disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  {demoFile && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white/70">
                      <p className="font-medium text-white">{demoFile.name}</p>
                      <p className="mt-1 text-xs text-white/45">{(demoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-white/45">Camera Label</label>
                <input
                  type="text"
                  value={cameraLabel}
                  onChange={(event) => setCameraLabel(event.target.value)}
                  className="guardian-input"
                  disabled={monitoring}
                  placeholder={inputSource === INPUT_SOURCES.FILE ? 'e.g. Demo Hallway Playback' : 'e.g. ICU South Cam'}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <ToggleCard title="Fire" description="Pixel heat signatures plus vision review" enabled={fireEnabled} onToggle={() => setFireEnabled((current) => !current)} />
                <ToggleCard title="Fall" description="Motion silhouette plus vision review" enabled={fallEnabled} onToggle={() => setFallEnabled((current) => !current)} />
                <ToggleCard
                  title="Vision AI"
                  description={import.meta.env.VITE_GEMINI_API_KEY ? 'Gemini frame confirmation' : 'Gemini key missing'}
                  enabled={aiAssistEnabled}
                  disabled={!import.meta.env.VITE_GEMINI_API_KEY}
                  onToggle={() => setAiAssistEnabled((current) => !current)}
                />
              </div>

              {cameraError && (
                <div className="rounded-xl border border-accent-red/25 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
                  {cameraError}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                {monitoring ? (
                  <button type="button" onClick={() => stopMonitoring().catch(() => {})} className="btn-danger">Stop monitor</button>
                ) : (
                  <button type="button" onClick={() => handleStartMonitoring().catch(() => {})} className="btn-primary" disabled={starting}>
                    {starting ? 'Starting...' : inputSource === INPUT_SOURCES.FILE ? 'Start demo playback' : 'Start live monitor'}
                  </button>
                )}
                {inputSource === INPUT_SOURCES.CAMERA && (
                  <button type="button" onClick={() => refreshCameraDevices().catch(() => {})} className="btn-secondary">
                    Refresh cameras
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <div className="section-header">
              <h2 className="section-title">Area Context</h2>
              {selectedRoom && <span className="text-xs text-white/35">Room source</span>}
            </div>

            {selectedRoom ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <InfoCell label="Room" value={selectedRoom.name} />
                <InfoCell label="Floor" value={selectedRoom.floor} />
                <InfoCell label="Zone" value={selectedRoom.zone} />
                <InfoCell label="Current room state" value={selectedRoom.status || 'clear'} />
              </div>
            ) : (
              <p className="text-sm text-white/35">No room selected yet.</p>
            )}
          </div>

          <div className="glass-card p-5">
            <div className="section-header">
              <h2 className="section-title">Live Monitors</h2>
              <span className="text-xs text-white/40">{activeMonitors.length} online</span>
            </div>

            {activeMonitors.length === 0 ? (
              <p className="text-sm text-white/35">No active monitors right now.</p>
            ) : (
              <div className="space-y-3">
                {activeMonitors.map((monitor) => (
                  <div key={monitor.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{monitor.roomName}</p>
                        <p className="mt-1 text-xs text-white/40">
                          {monitor.cameraLabel} • Floor {monitor.roomFloor}
                          {monitor.demoFileName ? ` • ${monitor.demoFileName}` : ''}
                        </p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                        monitor.level === 'critical' || monitor.status === 'alerting'
                          ? 'bg-accent-red/15 text-accent-red'
                          : 'bg-emerald-500/15 text-emerald-300'
                      }`}
                      >
                        {monitor.status || 'active'}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <MetricMini label="Fire" value={monitor.fireScore ?? 0} />
                      <MetricMini label="Fall" value={monitor.fallScore ?? 0} />
                      <MetricMini label="Crisis" value={monitor.crisisScore ?? 0} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleCard({ title, description, enabled, onToggle, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`rounded-xl border p-3 text-left transition ${
        enabled ? 'border-accent-blue/35 bg-accent-blue/10' : 'border-white/10 bg-white/[0.03]'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{title}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-accent-blue shadow-[0_0_14px_rgba(59,130,246,0.4)]' : 'bg-white/20'}`} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-white/45">{description}</p>
    </button>
  );
}

function InfoCell({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 font-medium text-white">{value || '-'}</p>
    </div>
  );
}

function MetricMini({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
      <p className="text-[10px] uppercase tracking-wider text-white/35">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

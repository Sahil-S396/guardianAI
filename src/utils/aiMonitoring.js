export const LOCAL_SAMPLE_MS = 1_200;
export const AI_SAMPLE_MS = 9_000;
export const MONITOR_SYNC_MS = 3_000;
export const DETECTION_LOG_MS = 12_000;
export const ALERT_COOLDOWN_MS = 90_000;
export const FIRE_TRIGGER_SCORE = 72;
export const FALL_TRIGGER_SCORE = 68;
export const CRISIS_TRIGGER_SCORE = 70;

export function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildMonitorId(roomId, cameraLabel, deviceId) {
  return [
    roomId || 'room',
    slugify(cameraLabel) || 'camera',
    slugify(deviceId) || 'default',
  ].join('__');
}

function buildMotionMetrics(imageData, previousFrameState) {
  const { data, width, height } = imageData;
  const grayscale = [];
  const sampleStep = 4;
  let motionPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let sampledPixels = 0;

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const pixelIndex = ((y * width) + x) * 4;
      const gray = ((data[pixelIndex] * 0.299) + (data[pixelIndex + 1] * 0.587) + (data[pixelIndex + 2] * 0.114));
      grayscale.push(gray);

      if (previousFrameState?.grayscale?.length === grayscale.length) {
        const diff = Math.abs(gray - previousFrameState.grayscale[grayscale.length - 1]);
        if (diff > 34) {
          motionPixels += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      sampledPixels += 1;
    }
  }

  const hasMotionBox = motionPixels > 12 && maxX > minX && maxY > minY;
  const bboxWidth = hasMotionBox ? maxX - minX : 0;
  const bboxHeight = hasMotionBox ? maxY - minY : 0;
  const aspectRatio = hasMotionBox ? bboxWidth / Math.max(bboxHeight, 1) : 0;
  const centerY = hasMotionBox ? ((minY + maxY) / 2) / height : previousFrameState?.centerY || 0;
  const verticalDrop = previousFrameState?.centerY ? Math.max(0, centerY - previousFrameState.centerY) : 0;
  const motionRatio = sampledPixels > 0 ? motionPixels / sampledPixels : 0;

  return {
    motionPixels,
    motionRatio,
    aspectRatio,
    centerY,
    verticalDrop,
    frameState: {
      grayscale,
      centerY,
    },
  };
}

export function analyzeLocalFrame(imageData, previousFrameState = null) {
  const { data } = imageData;
  const totalPixels = data.length / 4;
  let firePixels = 0;
  let hotPixels = 0;
  let brightSum = 0;

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const brightness = (red + green + blue) / 3;
    brightSum += brightness;

    if (red > 180 && green > 60 && blue < 150 && red > (green * 1.08)) {
      hotPixels += 1;
    }

    if (red > 205 && green < 185 && blue < 95 && red > (green * 1.18)) {
      firePixels += 1;
    }
  }

  const heatRatio = totalPixels > 0 ? hotPixels / totalPixels : 0;
  const fireRatio = totalPixels > 0 ? firePixels / totalPixels : 0;
  const averageBrightness = totalPixels > 0 ? brightSum / totalPixels : 0;

  const motionMetrics = buildMotionMetrics(imageData, previousFrameState);

  const localFireScore = clamp(Math.round(
    (fireRatio * 10_000) +
    (heatRatio * 3_600) +
    (averageBrightness * 0.08) -
    18
  ));

  const localFallScore = clamp(Math.round(
    ((motionMetrics.aspectRatio > 1 ? (motionMetrics.aspectRatio - 1) : 0) * 54) +
    (motionMetrics.motionRatio * 240) +
    (motionMetrics.verticalDrop * 145)
  ));

  return {
    localFireScore,
    localFallScore,
    metrics: {
      fireRatio,
      heatRatio,
      averageBrightness,
      motionRatio: motionMetrics.motionRatio,
      motionPixels: motionMetrics.motionPixels,
      aspectRatio: motionMetrics.aspectRatio,
      verticalDrop: motionMetrics.verticalDrop,
    },
    frameState: motionMetrics.frameState,
  };
}

export function mergeDetectionScores({
  localFireScore,
  localFallScore,
  aiFireScore = null,
  aiFallScore = null,
  aiSummary = '',
  roomName = '',
}) {
  const fireScore = aiFireScore === null
    ? localFireScore
    : clamp(Math.round((localFireScore * 0.55) + (aiFireScore * 0.45)));
  const fallScore = aiFallScore === null
    ? localFallScore
    : clamp(Math.round((localFallScore * 0.4) + (aiFallScore * 0.6)));
  const crisisScore = clamp(Math.max(
    fireScore,
    fallScore,
    Math.round((fireScore * 0.62) + (fallScore * 0.58))
  ));
  const dominantType = fireScore >= fallScore ? 'fire' : 'fall';
  const dominantScore = dominantType === 'fire' ? fireScore : fallScore;

  let level = 'stable';
  if (crisisScore >= CRISIS_TRIGGER_SCORE || fireScore >= FIRE_TRIGGER_SCORE || fallScore >= FALL_TRIGGER_SCORE) {
    level = 'critical';
  } else if (crisisScore >= 45 || fireScore >= 50 || fallScore >= 50) {
    level = 'watch';
  }

  const roomText = roomName ? ` in ${roomName}` : '';
  const summary = level === 'critical'
    ? `High confidence ${dominantType} risk${roomText}. ${aiSummary || 'Escalating live safety workflow.'}`.trim()
    : level === 'watch'
    ? `Monitoring elevated ${dominantType} signals${roomText}. ${aiSummary || 'Waiting for additional confirmation.'}`.trim()
    : `Camera feed is stable${roomText}.`;

  return {
    fireScore,
    fallScore,
    crisisScore,
    dominantType,
    dominantScore,
    level,
    summary,
  };
}

export function shouldTriggerAlert(scores) {
  if (!scores) {
    return false;
  }

  return scores.fireScore >= FIRE_TRIGGER_SCORE
    || scores.fallScore >= FALL_TRIGGER_SCORE
    || scores.crisisScore >= CRISIS_TRIGGER_SCORE;
}

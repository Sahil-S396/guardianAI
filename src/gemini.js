// Gemini API integration for generating emergency response AI insights
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

/**
 * Calls Gemini API with emergency context and returns structured JSON response.
 * @param {Object} params - Alert context parameters
 * @returns {Promise<Object>} Parsed Gemini response JSON
 */
export async function callGeminiForAlert({ roomName, zone, floor, alertType, nearbyStaff, secondsSinceTrigger }) {
  const staffList = nearbyStaff?.map(s => `${s.name} (${s.role})`).join(', ') || 'None found';
  
  const prompt = `Emergency in ${roomName}, Zone ${zone}, Floor ${floor}. Type: ${alertType === 'fire' ? 'Fire' : 'Fall'}. 
Nearby staff: ${staffList}. Time since trigger: ${secondsSinceTrigger}s.
Return ONLY valid JSON with this exact structure:
{
  "severity": "low" | "medium" | "high" | "critical",
  "immediateAction": "string describing what to do first",
  "suggestedResponder": "string naming the best available staff member or role",
  "evacuationRequired": true | false,
  "estimatedResponseTime": "string like '2 minutes'"
}`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    // Parse the JSON response
    const parsed = JSON.parse(rawText);
    return {
      severity: parsed.severity || 'high',
      immediateAction: parsed.immediateAction || 'Respond to emergency immediately',
      suggestedResponder: parsed.suggestedResponder || 'Nearest available staff',
      evacuationRequired: parsed.evacuationRequired ?? (alertType === 'fire'),
      estimatedResponseTime: parsed.estimatedResponseTime || '3 minutes',
    };
  } catch (error) {
    console.error('Gemini API call failed:', error);
    // Return a safe fallback response
    return {
      severity: alertType === 'fire' ? 'critical' : 'high',
      immediateAction: alertType === 'fire' 
        ? 'Activate fire alarm, evacuate the floor, and call 911 immediately.'
        : 'Assess patient for injuries, call for medical assistance, do not move patient unnecessarily.',
      suggestedResponder: 'Nearest available nurse or security personnel',
      evacuationRequired: alertType === 'fire',
      estimatedResponseTime: '3-5 minutes',
    };
  }
}

export async function analyzeFloorPlanImage(base64Image, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    throw new Error('Missing VITE_GEMINI_API_KEY');
  }

  const now = new Date().toISOString();

  const prompt = `You are an expert hospital floor plan analyzer with computer vision capabilities.

Look CAREFULLY at this hospital floor plan image. Your job is to trace every room, corridor, and safety marker you can see.

OUTPUT: Return ONLY a raw JSON object (no markdown, no code fences, no explanation).

--- COORDINATE SYSTEM ---
Map everything to this fixed grid:
- Top-left corner of the floor plan image → x=120, y=80
- Bottom-right corner of the floor plan image → x=820, y=420
- x, y = top-left corner of each zone rectangle
- w = width of the zone, h = height of the zone
- ALL values must be integers within: x: 120–820, y: 80–420

--- ALLOWED ZONE TYPES (use ONLY these exact strings) ---
icu → #D85A30
ward → #378ADD
surgery → #7F77DD
corridor → #888780
reception → #1D9E75
lab → #639922
pharmacy → #D4537E
stairwell → #444441
exit_door → #00FF94
entry_door → #4FC3F7
aed_station → #FF6B35
fire_ext → #FF2D2D
hazard → #FFB800

--- DETECTION RULES ---
ZONES: Identify every distinct room and area. Corridors are long and narrow. Adjacent rooms must share edges (touch, not overlap). Minimum w=20, h=10.
WALLS: Trace each wall segment as a line. Always include the 4 outer perimeter walls. Add interior walls for each room partition. Aim for 15-30 segments.
CAMERAS: Detect CCTV symbols, or if none visible, infer positions at entry points and corridor intersections. angle is in radians (0=east, 1.57=south, 3.14=west, 4.71=north).

--- REQUIRED OUTPUT FORMAT ---
{
  "floors": [
    {
      "floor": 1,
      "zones": [
        { "type": "TYPE", "color": "HEX", "label": "Human Name", "x": INT, "y": INT, "w": INT, "h": INT }
      ],
      "cameras": [
        { "x": INT, "y": INT, "angle": FLOAT, "label": "Cam 1" }
      ],
      "walls": [
        { "x1": INT, "y1": INT, "x2": INT, "y2": INT }
      ]
    }
  ],
  "exportedAt": "${now}"
}

Analyze the ACTUAL image uploaded. Do not use generic or placeholder data. Map what you see.`;

  // Use a separate vision-capable URL (gemini-1.5-pro has better spatial reasoning)
  const visionUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(visionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          // Image FIRST so Gemini focuses on it before reading the instructions
          {
            inlineData: {
              mimeType,
              data: base64Image,
            },
          },
          { text: prompt },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        // NOTE: Do NOT set responseMimeType:'application/json' for vision requests
        // — it causes Gemini to return the example JSON from the prompt verbatim
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    const finishReason = data.candidates?.[0]?.finishReason;
    throw new Error(finishReason === 'SAFETY'
      ? 'Image was blocked by Gemini safety filters. Try a cleaner blueprint scan.'
      : 'Gemini returned an empty response. Check your API key and quota.');
  }

  // Strip markdown fences if Gemini adds them despite instructions
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON from anywhere in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error('Could not parse JSON from Gemini response. The image may be unclear.');
    }
  }

  if (!parsed || !Array.isArray(parsed.floors)) {
    throw new Error('Gemini response structure invalid — missing floors array.');
  }

  return {
    floors: parsed.floors,
    exportedAt: parsed.exportedAt || now,
  };
}


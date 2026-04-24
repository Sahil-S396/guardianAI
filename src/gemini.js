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

  const prompt = `You are analyzing a hospital floor plan image. Identify all visible rooms, zones, and areas.

Return ONLY valid JSON matching this schema:
[
  {
    "type": "icu",
    "label": "ICU",
    "color": "#D85A30",
    "x": 40,
    "y": 40,
    "w": 160,
    "h": 100
  }
]

Rules:
- The source coordinate system is 600 by 420.
- Allowed types/colors: icu/#D85A30, emergency/#E24B4A, ward/#378ADD, surgery/#7F77DD, corridor/#888780, reception/#1D9E75, lab/#BA7517, pharmacy/#D4537E, stairwell/#444441, other/#888780
- Use specific human-readable labels like "Room 101" or "ICU Bay A".
- Corridors should usually be long thin rectangles.
- Minimum size is w=80 and h=50.
- Maximum 20 zones.
- Avoid heavy overlap.
- x, y, w, h must be integers.
- Do not include markdown fences or explanation.`;

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: base64Image,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini image analysis failed: ${response.status}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response');
  }

  const parsed = JSON.parse(rawText);

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response was not an array');
  }

  return parsed;
}

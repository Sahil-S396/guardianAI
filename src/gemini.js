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

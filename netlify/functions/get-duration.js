// FILE PATH: netlify/functions/get-duration.js
// Place this file in: netlify/functions/get-duration.js

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { reason } = JSON.parse(event.body);

    if (!reason) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing reason field' })
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    
    if (!GEMINI_API_KEY) {
      console.error('Gemini API key not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const modelName = "gemini-2.0-flash-exp";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Time estimate required medical appointment duration in minutes (5–10). Respond with ONLY one number.

I want you to be the receptionist at a fast-paced medical clinic, and your role is to estimate how long each patient's appointment with the doctor will take only based on the reason for the visit that the patient provides. Your estimate should be a whole number between 4 and 12 minutes. You will only return a number with no additional formatting. Here are some sample sessions, you will only return the number in the output section for the given input/reason.

input: prescription refill authorisation | output: 4
input: blood pressure check | output: 4

input: ear wax removal | output: 5
input: minor cut dressing | output: 5

input: moderate fever | output: 6
input: mild sore throat evaluation | output: 6

input: routine vaccination | output: 7
input: skin rash assessment | output: 7

input: urine test review | output: 8
input: mild asthma flare-up | output: 8

input: blood sugar check | output: 9
input: sinus infection evaluation | output: 9

input: sprained ankle assessment | output: 10
input: persistent headache evaluation | output: 10

input: chest pain assessment | output: 11
input: severe abdominal pain evaluation | output: 11

input: heart attack | output: 12
input: major cuts and bleeding | output: 12

For your prediction right now, here is the reason that you will estimate the appointment time for: ${reason}`
                }
              ]
            }
          ]
        }),
      }
    );

    const data = await response.json();

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const duration = parseInt(rawText.replace(/\D/g, ""), 10);

    if (!isNaN(duration) && duration >= 2 && duration <= 15) {
      return {
        statusCode: 200,
        body: JSON.stringify({ duration })
      };
    } else {
      console.warn("Gemini returned unclear value → fallback used");
      return {
        statusCode: 200,
        body: JSON.stringify({ duration: 7 })
      };
    }

  } catch (error) {
    console.error('Gemini API error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to get duration prediction',
        details: error.message,
        duration: 7 // fallback
      })
    };
  }
};

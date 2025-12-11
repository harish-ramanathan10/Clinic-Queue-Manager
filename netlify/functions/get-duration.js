// FILE: netlify/functions/get-duration.js

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { reason } = JSON.parse(event.body);

    if (!reason) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing reason field" })
      };
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    const MODEL = "gemini-2.5-flash";

    if (!API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Server config error: Missing GEMINI_API_KEY" })
      };
    }

    // Use native Node 18 fetch — no node-fetch required
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
I want you to do a task of a receptionist at a fast-paced medical clinic, and your role is to estimate how long each patient’s appointment with the doctor will take only based on the reason for the visit that the patient provides. Make your estimates very ambitious and assume the doctors are fast-paced. Your estimate should be a whole number between 3 and 12 minutes. You will only return a number with no additional formatting. Here are some sample sessions, you will only return the number in the output section for the given input/reason.

input: prescription refill authorisation | output: 3
input: severe fever | output: 6

input: heart attack | output: 12
input: major cuts and bleeding | output: 12

For your prediction right now, here is the reason that you will estimate the appointment time for: ${reason}
                  `
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();


    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const duration = parseInt(rawText.replace(/\D/g, ""), 10);

    if (!isNaN(duration) && duration >= 3 && duration <= 12) {
      return {
        statusCode: 200,
        body: JSON.stringify({ duration })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ duration: 7 }) // fallback
    };

  } catch (err) {
    console.error("Gemini error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Gemini request failed",
        details: err.message
      })
    };
  }
};

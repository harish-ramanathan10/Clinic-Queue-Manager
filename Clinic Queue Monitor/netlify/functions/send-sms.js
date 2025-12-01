// FILE PATH: netlify/functions/send-sms.js
// Create the directory structure: netlify/functions/
// Then place this file as: send-sms.js

const twilio = require('twilio');

exports.handler = async (event, context) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { to, message } = JSON.parse(event.body);

    if (!to || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Initialize Twilio client
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      console.error('Twilio credentials not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    const client = twilio(accountSid, authToken);

    // Send SMS
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: to
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        messageSid: result.sid 
      })
    };

  } catch (error) {
    console.error('Twilio error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to send SMS',
        details: error.message 
      })
    };
  }
};
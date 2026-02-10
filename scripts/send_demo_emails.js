/**
 * Send Demo Emails Script
 * Sends one of each email type to verify credit/branding
 * 
 * Usage: node scripts/send_demo_emails.js [recipient_email]
 * 
 * Requires environment variables:
 *   MAILERSEND_API_KEY
 *   MAILERSEND_FROM_EMAIL
 */

require('dotenv').config();

const MAILERSEND_API_URL = 'https://api.mailersend.com/v1/email';
const apiKey = process.env.MAILERSEND_API_KEY;
const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'noreply@stratusweather.co.za';
const fromName = process.env.MAILERSEND_FROM_NAME || 'Stratus Weather';
const alertsEmail = process.env.MAILERSEND_ALERTS_EMAIL || 'alerts@stratusweather.co.za';
const recipient = process.argv[2] || 'esterhuizen2k@proton.me';

if (!apiKey) {
  console.error('ERROR: MAILERSEND_API_KEY not set');
  process.exit(1);
}

async function sendEmail(from, fromDisplayName, to, subject, html, text) {
  const payload = {
    from: { email: from, name: fromDisplayName },
    to: [{ email: to }],
    subject,
    text: text || '',
    html: html || text || '',
  };

  const response = await fetch(MAILERSEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`MailerSend API error: ${response.status} - ${errorData}`);
  }
  return true;
}

const creditFooter = `
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather Station Server</p>
      <p style="margin: 0; font-size: 11px;">Developed by <strong>Lukas Esterhuizen</strong></p>
      <p style="margin: 4px 0 0 0; font-size: 11px;">esterhuizen2k@proton.me</p>
    </div>`;

const monitorCreditFooter = `
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather - Station Monitoring</p>
      <p style="margin: 0; font-size: 11px;">Developed by <strong>Lukas Esterhuizen</strong></p>
      <p style="margin: 4px 0 0 0; font-size: 11px;">esterhuizen2k@proton.me</p>
    </div>`;

// ── 1. Welcome / Invitation Email ──────────────────────────────────────
async function sendDemoInvitation() {
  const subject = `[DEMO] Welcome to Stratus Weather - Set Up Your Account`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background: #1e3a5f; border-radius: 50%; margin: 0 auto 16px auto; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.3);">
        <div style="width: 16px; height: 16px; background: white; border-radius: 50%;"></div>
      </div>
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">Stratus Weather</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Weather Station Management</p>
    </div>
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="color: #1e3a5f; margin: 0 0 16px 0; font-size: 22px;">Welcome, Lukas!</h2>
      <p style="color: #4b5563; line-height: 1.7; margin: 0 0 24px 0; font-size: 15px;">
        <strong>Admin</strong> has invited you to join Stratus Weather Server. Click the button below to set up your password and access your account.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://stratusweather.co.za/setup-password?token=demo-token" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">Set Up Your Password</a>
      </div>
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0 0 24px 0;">This link will expire in <strong>72 hours</strong>.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you didn't expect this email, you can safely ignore it.</p>
    </div>
    ${creditFooter}
  </div>
</body>
</html>`;
  await sendEmail(fromEmail, fromName, recipient, subject, html, 'Demo invitation email');
  console.log('✅ 1/6 Invitation email sent');
}

// ── 2. Password Reset Email ────────────────────────────────────────────
async function sendDemoPasswordReset() {
  const subject = `[DEMO] Password Reset Request - Stratus Weather`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background: #1e3a5f; border-radius: 50%; margin: 0 auto 16px auto; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.3);">
        <div style="width: 16px; height: 16px; background: white; border-radius: 50%;"></div>
      </div>
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">Stratus Weather</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Password Reset Request</p>
    </div>
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="color: #1e3a5f; margin: 0 0 16px 0; font-size: 22px;">Hi Lukas,</h2>
      <p style="color: #4b5563; line-height: 1.7; margin: 0 0 24px 0; font-size: 15px;">
        We received a request to reset your password for your Stratus Weather account. Click the button below to create a new password.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://stratusweather.co.za/reset-password?token=demo-token" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">Reset Password</a>
      </div>
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0 0 24px 0;">This link will expire in <strong>1 hour</strong> for security.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you didn't request a password reset, you can safely ignore this email.</p>
    </div>
    ${creditFooter}
  </div>
</body>
</html>`;
  await sendEmail(fromEmail, fromName, recipient, subject, html, 'Demo password reset email');
  console.log('✅ 2/6 Password reset email sent');
}

// ── 3. Alarm Notification Email ────────────────────────────────────────
async function sendDemoAlarm() {
  const severityColor = '#dc2626';
  const subject = `[DEMO] 🚨 [CRITICAL] High Temperature Alert - Hopefield AWS`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, ${severityColor} 0%, ${severityColor}dd 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px auto; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.3);">
        <div style="width: 16px; height: 16px; background: white; border-radius: 50%;"></div>
      </div>
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">🚨 Weather Alert</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Hopefield AWS</p>
    </div>
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: ${severityColor}10; border-left: 4px solid ${severityColor}; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: ${severityColor}; font-size: 20px;">High Temperature Alert</h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">Severity: <strong style="color: ${severityColor}; text-transform: uppercase;">CRITICAL</strong></p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Condition</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">above</td></tr>
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Threshold</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">40 °C</td></tr>
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Current Value</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: ${severityColor}; font-size: 16px; font-weight: 600;">42.3 °C</td></tr>
        <tr><td style="padding: 12px; color: #6b7280; font-size: 14px;">Triggered At</td><td style="padding: 12px; color: #1e3a5f; font-size: 14px;">${new Date().toLocaleString()}</td></tr>
      </table>
      <div style="text-align: center; margin-top: 32px;">
        <a href="https://stratusweather.co.za" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Dashboard</a>
      </div>
    </div>
    ${creditFooter}
  </div>
</body>
</html>`;
  await sendEmail(alertsEmail, 'Stratus Weather Alerts', recipient, subject, html, 'Demo alarm email');
  console.log('✅ 3/6 Alarm notification email sent');
}

// ── 4. Alarm Resolved Email ────────────────────────────────────────────
async function sendDemoAlarmResolved() {
  const subject = `[DEMO] ✅ [RESOLVED] High Temperature Alert - Hopefield AWS`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">✅ Alert Resolved</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Hopefield AWS</p>
    </div>
    <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #dcfce7; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; color: #166534; font-size: 18px;">High Temperature Alert</h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">The alarm condition has returned to normal.</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Current Value</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #22c55e; font-size: 16px; font-weight: 600;">36.2 °C</td></tr>
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Triggered At</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px;">${new Date(Date.now() - 3600000).toLocaleString()}</td></tr>
        <tr><td style="padding: 12px; color: #6b7280; font-size: 14px;">Resolved At</td><td style="padding: 12px; color: #111827; font-size: 14px;">${new Date().toLocaleString()}</td></tr>
      </table>
      <div style="text-align: center; margin-top: 24px;">
        <a href="https://stratusweather.co.za" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 500; font-size: 14px;">View Dashboard</a>
      </div>
    </div>
    ${creditFooter}
  </div>
</body>
</html>`;
  await sendEmail(fromEmail, fromName, recipient, subject, html, 'Demo alarm resolved email');
  console.log('✅ 4/6 Alarm resolved email sent');
}

// ── 5. Staleness Alert Email ───────────────────────────────────────────
async function sendDemoStalenessAlert() {
  const subject = `[DEMO] [ALERT] Station Offline: Skaapdam AWS - No data for 3 hours 15 minutes`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">STATION OFFLINE</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Skaapdam AWS</p>
    </div>
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: #dc2626; font-size: 18px;">No Data for 3 hours 15 minutes</h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">This station has stopped sending data and may require attention.</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Station</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">Skaapdam AWS (ID: 2)</td></tr>
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Last Data</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-size: 14px; font-weight: 600;">${new Date(Date.now() - 11700000).toUTCString()}</td></tr>
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Offline Duration</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">3 hours 15 minutes</td></tr>
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Connection Type</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px;">dropbox</td></tr>
        <tr><td style="padding: 12px; color: #6b7280; font-size: 14px;">Threshold</td><td style="padding: 12px; color: #1e3a5f; font-size: 14px;">2 hours</td></tr>
      </table>
      <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <h3 style="margin: 0 0 8px 0; color: #1e3a5f; font-size: 14px;">Possible Causes</h3>
        <ul style="margin: 0; padding: 0 0 0 20px; color: #4b5563; font-size: 13px; line-height: 1.8;">
          <li>Station power failure or battery depletion</li>
          <li>Communication link failure (cellular modem, WiFi, etc.)</li>
          <li>Datalogger malfunction or program error</li>
          <li>Dropbox sync issue or cloud storage problem</li>
        </ul>
      </div>
      <div style="text-align: center; margin-top: 32px;">
        <a href="https://stratusweather.co.za" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Dashboard</a>
      </div>
    </div>
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 4px 0; color: #6b7280;">Stratus Weather - Station Monitoring</p>
      <p style="margin: 0;">Alert cooldown: 6 hours</p>
      <p style="margin: 12px 0 0 0; font-size: 11px;">Developed by <strong>Lukas Esterhuizen</strong></p>
      <p style="margin: 4px 0 0 0; font-size: 11px;">esterhuizen2k@proton.me</p>
    </div>
  </div>
</body>
</html>`;
  await sendEmail(alertsEmail, 'Stratus Weather Alerts', recipient, subject, html, 'Demo staleness alert email');
  console.log('✅ 5/6 Staleness alert email sent');
}

// ── 6. Recovery Alert Email ────────────────────────────────────────────
async function sendDemoRecovery() {
  const subject = `[DEMO] [RESOLVED] Station Online: Skaapdam AWS - Data receiving resumed`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">STATION BACK ONLINE</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Skaapdam AWS</p>
    </div>
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #dcfce7; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: #166534; font-size: 18px;">Data Receiving Resumed</h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">The station is sending data again and is no longer flagged as offline.</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Station</td><td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">Skaapdam AWS (ID: 2)</td></tr>
        <tr><td style="padding: 12px; color: #6b7280; font-size: 14px;">Latest Data</td><td style="padding: 12px; color: #22c55e; font-size: 14px; font-weight: 600;">${new Date().toUTCString()}</td></tr>
      </table>
      <div style="text-align: center; margin-top: 32px;">
        <a href="https://stratusweather.co.za" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Dashboard</a>
      </div>
    </div>
    ${monitorCreditFooter}
  </div>
</body>
</html>`;
  await sendEmail(alertsEmail, 'Stratus Weather Alerts', recipient, subject, html, 'Demo recovery email');
  console.log('✅ 6/6 Recovery alert email sent');
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📧 Sending 6 demo emails to: ${recipient}\n`);
  
  try {
    await sendDemoInvitation();
    await new Promise(r => setTimeout(r, 1000));
    
    await sendDemoPasswordReset();
    await new Promise(r => setTimeout(r, 1000));
    
    await sendDemoAlarm();
    await new Promise(r => setTimeout(r, 1000));
    
    await sendDemoAlarmResolved();
    await new Promise(r => setTimeout(r, 1000));
    
    await sendDemoStalenessAlert();
    await new Promise(r => setTimeout(r, 1000));
    
    await sendDemoRecovery();
    
    console.log(`\n✅ All 6 demo emails sent successfully to ${recipient}!`);
    console.log('Check your inbox (and spam folder) for emails with [DEMO] prefix.\n');
  } catch (error) {
    console.error('\n❌ Error sending demo emails:', error.message);
    process.exit(1);
  }
}

main();

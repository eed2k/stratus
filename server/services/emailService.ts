/**
 * Email Service for Stratus Weather Server
 * Uses SendGrid for transactional email delivery
 * 
 * Setup:
 * 1. Sign up at https://sendgrid.com (free tier: 100 emails/day)
 * 2. Create an API key in Settings > API Keys
 * 3. Verify a sender email in Settings > Sender Authentication
 * 4. Set environment variables:
 *    - SENDGRID_API_KEY=your_api_key
 *    - SENDGRID_FROM_EMAIL=your_verified_email@domain.com
 *    - PUBLIC_URL=https://your-domain.com (optional)
 */

import sgMail from '@sendgrid/mail';

// Initialize SendGrid with API key
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'alerts@stratus.weather';
const fromName = process.env.SENDGRID_FROM_NAME || 'Stratus Weather Server';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface AlarmEmailData {
  stationName: string;
  stationId: number;
  alarmName: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  condition: string;
  threshold: number;
  currentValue: number;
  unit: string;
  triggeredAt: Date;
  dashboardUrl?: string;
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY && !!process.env.SENDGRID_FROM_EMAIL;
}

/**
 * Send a generic email
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[Email] SendGrid not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.');
    return false;
  }

  try {
    const msg = {
      to: options.to,
      from: {
        email: fromEmail,
        name: fromName,
      },
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
    };

    await sgMail.send(msg);
    console.log(`[Email] Sent to ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
    return true;
  } catch (error: any) {
    console.error('[Email] Failed to send:', error.response?.body || error.message);
    return false;
  }
}

/**
 * Get severity color for email styling
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc2626'; // red-600
    case 'error': return '#ea580c'; // orange-600
    case 'warning': return '#ca8a04'; // yellow-600
    case 'info': return '#2563eb'; // blue-600
    default: return '#6b7280'; // gray-500
  }
}

/**
 * Get severity emoji for subject line
 */
function getSeverityEmoji(severity: string): string {
  switch (severity) {
    case 'critical': return '🚨';
    case 'error': return '⚠️';
    case 'warning': return '⚡';
    case 'info': return 'ℹ️';
    default: return '📊';
  }
}

/**
 * Send alarm notification email
 */
export async function sendAlarmEmail(
  recipients: string[],
  data: AlarmEmailData
): Promise<boolean> {
  if (recipients.length === 0) {
    console.warn('[Email] No recipients specified for alarm notification');
    return false;
  }

  const severityColor = getSeverityColor(data.severity);
  const severityEmoji = getSeverityEmoji(data.severity);
  const dashboardUrl = data.dashboardUrl || process.env.PUBLIC_URL || 'http://localhost:5000';

  const subject = `${severityEmoji} [${data.severity.toUpperCase()}] ${data.alarmName} - ${data.stationName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, ${severityColor} 0%, ${severityColor}dd 100%); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">
        ${severityEmoji} Weather Alert
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
        ${data.stationName}
      </p>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <!-- Alarm Details -->
      <div style="background: ${severityColor}10; border-left: 4px solid ${severityColor}; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; color: ${severityColor}; font-size: 18px;">
          ${data.alarmName}
        </h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">
          Severity: <strong style="color: ${severityColor}; text-transform: uppercase;">${data.severity}</strong>
        </p>
      </div>
      
      <!-- Values Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Condition</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px; font-weight: 500;">${data.condition}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Threshold</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px; font-weight: 500;">${data.threshold} ${data.unit}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Current Value</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: ${severityColor}; font-size: 16px; font-weight: 600;">${data.currentValue} ${data.unit}</td>
        </tr>
        <tr>
          <td style="padding: 12px; color: #6b7280; font-size: 14px;">Triggered At</td>
          <td style="padding: 12px; color: #111827; font-size: 14px;">${data.triggeredAt.toLocaleString()}</td>
        </tr>
      </table>
      
      <!-- Action Button -->
      <div style="text-align: center; margin-top: 24px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 500; font-size: 14px;">
          View Dashboard
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0;">
        Stratus Weather Server<br>
        Station ID: ${data.stationId}
      </p>
      <p style="margin: 8px 0 0 0;">
        You're receiving this because you're subscribed to alerts for ${data.stationName}.
      </p>
    </div>
  </div>
</body>
</html>
`;

  const text = `
${data.severity.toUpperCase()} ALERT: ${data.alarmName}

Station: ${data.stationName} (ID: ${data.stationId})
Condition: ${data.condition}
Threshold: ${data.threshold} ${data.unit}
Current Value: ${data.currentValue} ${data.unit}
Triggered At: ${data.triggeredAt.toLocaleString()}

View Dashboard: ${dashboardUrl}

--
Stratus Weather Server
`;

  return sendEmail({
    to: recipients,
    subject,
    html,
    text,
  });
}

/**
 * Send alarm resolution email
 */
export async function sendAlarmResolvedEmail(
  recipients: string[],
  data: AlarmEmailData & { resolvedAt: Date }
): Promise<boolean> {
  if (recipients.length === 0) return false;

  const dashboardUrl = data.dashboardUrl || process.env.PUBLIC_URL || 'http://localhost:5000';

  const subject = `✅ [RESOLVED] ${data.alarmName} - ${data.stationName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 12px 12px 0 0; padding: 24px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">
        ✅ Alert Resolved
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
        ${data.stationName}
      </p>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #dcfce7; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; color: #166534; font-size: 18px;">
          ${data.alarmName}
        </h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">
          The alarm condition has returned to normal.
        </p>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Current Value</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #22c55e; font-size: 16px; font-weight: 600;">${data.currentValue} ${data.unit}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Triggered At</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #111827; font-size: 14px;">${data.triggeredAt.toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 12px; color: #6b7280; font-size: 14px;">Resolved At</td>
          <td style="padding: 12px; color: #111827; font-size: 14px;">${data.resolvedAt.toLocaleString()}</td>
        </tr>
      </table>
      
      <div style="text-align: center; margin-top: 24px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 500; font-size: 14px;">
          View Dashboard
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0;">Stratus Weather Server</p>
    </div>
  </div>
</body>
</html>
`;

  return sendEmail({
    to: recipients,
    subject,
    html,
  });
}

/**
 * Send test email to verify configuration
 */
export async function sendTestEmail(to: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: '✅ Stratus Weather Server - Email Test',
    html: `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0;">
    <h2 style="color: #22c55e; margin: 0 0 16px 0;">✅ Email Configuration Successful!</h2>
    <p style="color: #4b5563; margin: 0;">
      Your Stratus Weather Server is now configured to send email alerts.
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      Sent at: ${new Date().toLocaleString()}
    </p>
  </div>
</body>
</html>
`,
  });
}

// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * Email Service for Stratus Weather Server
 * Uses MailerSend for transactional email delivery
 * 
 * Setup:
 * 1. Sign up at https://www.mailersend.com (free tier: 3,000 emails/month)
 * 2. Add and verify your domain in Domains
 * 3. Create an API token in API Tokens
 * 4. Set environment variables:
 *    - MAILERSEND_API_KEY=your_api_token
 *    - MAILERSEND_FROM_EMAIL=noreply@yourdomain.com
 *    - MAILERSEND_FROM_NAME=Stratus Weather (optional)
 *    - PUBLIC_URL=https://your-domain.com (optional)
 */

// MailerSend REST API - no SDK needed
const MAILERSEND_API_URL = 'https://api.mailersend.com/v1/email';

const apiKey = process.env.MAILERSEND_API_KEY;
const fromEmail = process.env.MAILERSEND_FROM_EMAIL || 'noreply@stratusweather.co.za';
const fromName = process.env.MAILERSEND_FROM_NAME || 'Stratus Weather';
const alertsEmail = process.env.MAILERSEND_ALERTS_EMAIL || 'alerts@stratusweather.co.za';

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
  return !!process.env.MAILERSEND_API_KEY && !!process.env.MAILERSEND_FROM_EMAIL;
}

/**
 * Send a generic email via MailerSend API
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[Email] MailerSend not configured. Set MAILERSEND_API_KEY and MAILERSEND_FROM_EMAIL environment variables.');
    return false;
  }

  try {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    
    const payload = {
      from: {
        email: fromEmail,
        name: fromName,
      },
      to: recipients.map(email => ({ email })),
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
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

    console.log(`[Email] Sent to ${recipients.join(', ')}`);
    return true;
  } catch (error: any) {
    console.error('[Email] Failed to send:', error.message);
    return false;
  }
}

/**
 * Send email using alerts address (for alarm notifications)
 */
export async function sendAlertEmail(options: EmailOptions): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[Email] MailerSend not configured.');
    return false;
  }

  try {
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    
    const payload = {
      from: {
        email: alertsEmail,
        name: 'Stratus Weather Alerts',
      },
      to: recipients.map(email => ({ email })),
      subject: options.subject,
      text: options.text || '',
      html: options.html || options.text || '',
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

    console.log(`[Email/Alert] Sent to ${recipients.join(', ')}`);
    return true;
  } catch (error: any) {
    console.error('[Email/Alert] Failed to send:', error.message);
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
 * Get severity label for subject line
 */
function getSeverityLabel(severity: string): string {
  switch (severity) {
    case 'critical': return 'CRITICAL';
    case 'error': return 'ERROR';
    case 'warning': return 'WARNING';
    case 'info': return 'INFO';
    default: return 'ALERT';
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
  const severityLabel = getSeverityLabel(data.severity);
  const dashboardUrl = data.dashboardUrl || process.env.APP_BASE_URL || 'https://stratusweather.co.za';

  const subject = `[${severityLabel}] ${data.alarmName} - ${data.stationName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, ${severityColor} 0%, ${severityColor}dd 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; font-family: Arial, Helvetica, sans-serif;">
        Weather Alert
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
        ${data.stationName}
      </p>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <!-- Alarm Details -->
      <div style="background: ${severityColor}10; border-left: 4px solid ${severityColor}; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: ${severityColor}; font-size: 20px; font-family: Arial, Helvetica, sans-serif;">
          ${data.alarmName}
        </h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
          Severity: <strong style="color: ${severityColor}; text-transform: uppercase;">${data.severity}</strong>
        </p>
      </div>
      
      <!-- Values Table -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-family: Arial, Helvetica, sans-serif;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Condition</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${data.condition}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Threshold</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${data.threshold} ${data.unit}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Current Value</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: ${severityColor}; font-size: 16px; font-weight: 600;">${data.currentValue} ${data.unit}</td>
        </tr>
        <tr>
          <td style="padding: 12px; color: #6b7280; font-size: 14px;">Triggered At</td>
          <td style="padding: 12px; color: #1e3a5f; font-size: 14px;">${data.triggeredAt.toLocaleString()}</td>
        </tr>
      </table>
      
      <!-- Action Button -->
      <div style="text-align: center; margin-top: 32px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px; font-family: Arial, Helvetica, sans-serif;">
          View Dashboard
        </a>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather Station Server</p>
      <p style="margin: 0;">Station ID: ${data.stationId}</p>
      <p style="margin: 8px 0 0 0;">
        You're receiving this because you're subscribed to alerts for ${data.stationName}.
      </p>
      <p style="margin: 12px 0 0 0; font-size: 11px;">Stratus Weather Station Server</p>
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

  return sendAlertEmail({
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

  const dashboardUrl = data.dashboardUrl || process.env.PUBLIC_URL || process.env.APP_BASE_URL || 'https://stratusweather.co.za';

  const subject = `[RESOLVED] ${data.alarmName} - ${data.stationName}`;

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
        Alert Resolved
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
    <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather Server</p>
      <p style="margin: 0; font-size: 11px;">Stratus Weather Station Server</p>
    </div>
  </div>
</body>
</html>
`;

  const text = `RESOLVED: ${data.alarmName}

Station: ${data.stationName} (ID: ${data.stationId})
Status: Alarm condition has returned to normal.
Current Value: ${data.currentValue} ${data.unit}
Triggered At: ${data.triggeredAt.toLocaleString()}
Resolved At: ${data.resolvedAt.toLocaleString()}

View Dashboard: ${dashboardUrl}

--
Stratus Weather Server
`;

  return sendAlertEmail({
    to: recipients,
    subject,
    html,
    text,
  });
}

/**
 * Send user invitation email with password setup link
 */
export async function sendUserInvitationEmail(
  to: string,
  data: {
    firstName?: string;
    inviterName?: string;
    setupToken: string;
    customMessage?: string;
  }
): Promise<boolean> {
  const publicUrl = process.env.APP_BASE_URL || 'https://stratusweather.co.za';
  const setupUrl = `${publicUrl}/setup-password?token=${data.setupToken}`;

  const subject = `Welcome to Stratus Weather - Set Up Your Account`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; font-family: Arial, Helvetica, sans-serif;">
        Stratus Weather
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
        Weather Station Management
      </p>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <h2 style="color: #1e3a5f; margin: 0 0 16px 0; font-size: 22px; font-family: Arial, Helvetica, sans-serif;">
        ${data.firstName ? `Welcome, ${data.firstName}!` : 'Welcome to Stratus Weather!'}
      </h2>
      
      <p style="color: #4b5563; line-height: 1.7; margin: 0 0 24px 0; font-size: 15px; font-family: Arial, Helvetica, sans-serif;">
        ${data.inviterName ? `<strong>${data.inviterName}</strong> has invited you` : 'You have been invited'} to join Stratus Weather Server. 
        Click the button below to set up your password and access your account.
      </p>
      
      ${data.customMessage ? `
      <div style="background: #f0f4f8; border-left: 4px solid #2563eb; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="margin: 0; color: #4b5563; font-style: italic; font-family: Arial, Helvetica, sans-serif;">"${data.customMessage}"</p>
        ${data.inviterName ? `<p style="margin: 8px 0 0 0; color: #6b7280; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">— ${data.inviterName}</p>` : ''}
      </div>
      ` : ''}
      
      <!-- Action Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${setupUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px; font-family: Arial, Helvetica, sans-serif;">
          Set Up Your Password
        </a>
      </div>
      
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0 0 24px 0; font-family: Arial, Helvetica, sans-serif;">
        This link will expire in <strong>72 hours</strong>.
      </p>
      
      <div style="background: #f0f4f8; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #6b7280; font-size: 13px; margin: 0; font-family: Arial, Helvetica, sans-serif;">
          <strong>Can't click the button?</strong> Copy and paste this link into your browser:<br>
          <span style="color: #2563eb; word-break: break-all;">${setupUrl}</span>
        </p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      
      <p style="color: #9ca3af; font-size: 12px; margin: 0; font-family: Arial, Helvetica, sans-serif;">
        If you didn't expect this email, you can safely ignore it.
      </p>
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather Station Server</p>
    </div>
  </div>
</body>
</html>
`;

  const text = `
${data.firstName ? `Welcome to Stratus Weather, ${data.firstName}!` : 'Welcome to Stratus Weather!'}

${data.inviterName ? `${data.inviterName} has invited you` : 'You have been invited'} to join Stratus Weather Server.

Set up your password here: ${setupUrl}

${data.customMessage ? `Message from ${data.inviterName || 'Admin'}: "${data.customMessage}"` : ''}

This link will expire in 72 hours.

--
Stratus Weather Server
`;

  return sendEmail({
    to,
    subject,
    html,
    text,
  });
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: string,
  data: {
    firstName?: string;
    resetToken: string;
  }
): Promise<boolean> {
  const publicUrl = process.env.APP_BASE_URL || 'https://stratusweather.co.za';
  const resetUrl = `${publicUrl}/reset-password?token=${data.resetToken}`;

  const subject = `Password Reset Request - Stratus Weather`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700; font-family: Arial, Helvetica, sans-serif;">
        Stratus Weather
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px; font-family: Arial, Helvetica, sans-serif;">
        Password Reset Request
      </p>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      ${data.firstName ? `
      <h2 style="color: #1e3a5f; margin: 0 0 16px 0; font-size: 22px; font-family: Arial, Helvetica, sans-serif;">
        Hi ${data.firstName},
      </h2>
      ` : ''}
      <p style="color: #4b5563; line-height: 1.7; margin: 0 0 24px 0; font-size: 15px; font-family: Arial, Helvetica, sans-serif;">
        We received a request to reset your password for your Stratus Weather account. Click the button below to create a new password.
      </p>
      
      <!-- Action Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px; font-family: Arial, Helvetica, sans-serif;">
          Reset Password
        </a>
      </div>
      
      <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 0 0 24px 0; font-family: Arial, Helvetica, sans-serif;">
        This link will expire in <strong>1 hour</strong> for security.
      </p>
      
      <div style="background: #f0f4f8; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #6b7280; font-size: 13px; margin: 0; font-family: Arial, Helvetica, sans-serif;">
          <strong>Can't click the button?</strong> Copy and paste this link into your browser:<br>
          <span style="color: #2563eb; word-break: break-all;">${resetUrl}</span>
        </p>
      </div>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      
      <p style="color: #9ca3af; font-size: 12px; margin: 0; font-family: Arial, Helvetica, sans-serif;">
        If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
      </p>
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather Station Server</p>
    </div>
  </div>
</body>
</html>
`;

  const text = `${data.firstName ? `Hi ${data.firstName},\n\n` : ''}We received a request to reset your password for Stratus Weather Server.

Reset your password here: ${resetUrl}

This link will expire in 1 hour.

If you didn't request a password reset, you can safely ignore this email.

--
Stratus Weather Server
`;

  return sendEmail({
    to,
    subject,
    html,
    text,
  });
}

/**
 * Send test email to verify configuration
 */
export async function sendTestEmail(to: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: 'Stratus Weather Server - Email Test',
    html: `
<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
  <div style="max-width: 500px; margin: 0 auto; background: #f8fafc; padding: 24px; border-radius: 12px; border: 1px solid #e2e8f0;">
    <h2 style="color: #22c55e; margin: 0 0 16px 0;">Email Configuration Successful</h2>
    <p style="color: #4b5563; margin: 0;">
      Your Stratus Weather Server is now configured to send email alerts.
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      Sent at: ${new Date().toLocaleString()}
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0 12px 0;">
    <p style="color: #9ca3af; font-size: 11px; margin: 0;">Stratus Weather Station Server</p>
  </div>
</body>
</html>
`,
  });
}

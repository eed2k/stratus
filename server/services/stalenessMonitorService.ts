// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * Station Data Staleness Monitor Service
 * 
 * Periodically checks all active stations for data staleness.
 * If a station has not received data within a configurable threshold,
 * sends an email alert to admin users via MailerSend.
 * 
 * Features:
 * - Checks every 15 minutes (configurable)
 * - Default staleness threshold: 2 hours (configurable)
 * - Cooldown to avoid spam: won't re-alert for same station within 6 hours
 * - Sends recovery email when station comes back online
 * - Works with both SQLite and PostgreSQL backends
 */

import { isEmailConfigured, sendAlertEmail } from './emailService';

// Configuration
const CHECK_INTERVAL_MS = parseInt(process.env.STALENESS_CHECK_INTERVAL || '900000', 10); // 15 minutes
const STALENESS_THRESHOLD_MS = parseInt(process.env.STALENESS_THRESHOLD || '7200000', 10); // 2 hours
const ALERT_COOLDOWN_MS = parseInt(process.env.STALENESS_COOLDOWN || '21600000', 10); // 6 hours

// Track which stations have been alerted (stationId -> last alert timestamp)
const alertedStations = new Map<number, number>();
// Track which stations were previously stale (for recovery detection)
const previouslyStale = new Set<number>();

let checkInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// Import database functions dynamically based on mode
let getAllStations: () => Promise<any[]>;
let getAllUsers: () => Promise<any[]>;
let usePostgres = false;

/**
 * Initialize the staleness monitor
 */
export async function initStalenessMonitor(): Promise<void> {
  // Check if staleness alerts are enabled (disabled by default for now)
  const alertsEnabled = process.env.STALENESS_ALERTS_ENABLED === 'true';
  if (!alertsEnabled) {
    console.log('[StalenessMonitor] Staleness alerts disabled. Set STALENESS_ALERTS_ENABLED=true to enable.');
    return;
  }

  // Determine database mode
  usePostgres = !!process.env.DATABASE_URL;

  if (usePostgres) {
    const pg = await import('../db-postgres');
    getAllStations = pg.getAllStations;
    getAllUsers = pg.getAllUsers;
  } else {
    const sqlite = await import('../db');
    getAllStations = async () => sqlite.getAllStations();
    getAllUsers = async () => sqlite.getAllActiveUsers();
  }

  if (!isEmailConfigured()) {
    console.log('[StalenessMonitor] Email not configured - staleness alerts disabled. Set MAILERSEND_API_KEY and MAILERSEND_FROM_EMAIL.');
    return;
  }

  console.log(`[StalenessMonitor] Starting staleness monitor:`);
  console.log(`  - Check interval: ${CHECK_INTERVAL_MS / 60000} minutes`);
  console.log(`  - Staleness threshold: ${STALENESS_THRESHOLD_MS / 3600000} hours`);
  console.log(`  - Alert cooldown: ${ALERT_COOLDOWN_MS / 3600000} hours`);

  isRunning = true;

  // Run first check after a short delay (let data sync settle)
  setTimeout(async () => {
    if (isRunning) {
      await checkAllStations();
    }
  }, 60000); // 1 minute after startup

  // Then run periodically
  checkInterval = setInterval(async () => {
    if (isRunning) {
      await checkAllStations();
    }
  }, CHECK_INTERVAL_MS);

  console.log('[StalenessMonitor] Staleness monitor started successfully');
}

/**
 * Stop the staleness monitor
 */
export function stopStalenessMonitor(): void {
  isRunning = false;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  console.log('[StalenessMonitor] Staleness monitor stopped');
}

/**
 * Check all active stations for staleness
 */
async function checkAllStations(): Promise<void> {
  try {
    const stations = await getAllStations();
    const now = Date.now();
    let staleCount = 0;
    let recoveredCount = 0;

    for (const station of stations) {
      // Skip inactive stations
      if (station.isActive === false || station.is_active === false) continue;
      // Skip demo stations
      if (station.connectionType === 'demo' || station.connection_type === 'demo') continue;

      const lastConnected = station.lastConnected || station.last_connected;
      
      if (!lastConnected) {
        // Station has never connected - skip (it might be newly created)
        continue;
      }

      const lastConnectedTime = new Date(lastConnected).getTime();
      const timeSinceLastData = now - lastConnectedTime;

      if (timeSinceLastData > STALENESS_THRESHOLD_MS) {
        staleCount++;
        // Station is stale - check cooldown before alerting
        const lastAlertTime = alertedStations.get(station.id);
        
        if (!lastAlertTime || (now - lastAlertTime) > ALERT_COOLDOWN_MS) {
          await sendStalenessAlert(station, timeSinceLastData);
          alertedStations.set(station.id, now);
        }

        previouslyStale.add(station.id);
      } else {
        // Station has recent data - check if it was previously stale (recovery)
        if (previouslyStale.has(station.id)) {
          recoveredCount++;
          await sendRecoveryAlert(station, lastConnected);
          previouslyStale.delete(station.id);
          alertedStations.delete(station.id);
        }
      }
    }

    if (staleCount > 0 || recoveredCount > 0) {
      console.log(`[StalenessMonitor] Check complete: ${staleCount} stale, ${recoveredCount} recovered`);
    }
  } catch (error: any) {
    console.error('[StalenessMonitor] Error checking stations:', error.message);
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days} day${days !== 1 ? 's' : ''}, ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
  }
  
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }
  
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

/**
 * Get admin email recipients
 */
async function getAdminEmails(): Promise<string[]> {
  try {
    const users = await getAllUsers();
    return users
      .filter((u: any) => u.role === 'admin' && u.email)
      .map((u: any) => u.email);
  } catch (error: any) {
    console.error('[StalenessMonitor] Error fetching admin emails:', error.message);
    return [];
  }
}

/**
 * Send staleness alert email (plain text, no emojis or favicons)
 */
async function sendStalenessAlert(station: any, timeSinceLastData: number): Promise<void> {
  const adminEmails = await getAdminEmails();
  if (adminEmails.length === 0) {
    console.warn('[StalenessMonitor] No admin users found for staleness alert');
    return;
  }

  const stationName = station.name || `Station #${station.id}`;
  const duration = formatDuration(timeSinceLastData);
  const lastConnected = station.lastConnected || station.last_connected;
  const lastConnectedDate = new Date(lastConnected);
  const dashboardUrl = process.env.APP_BASE_URL || process.env.PUBLIC_URL || 'https://stratusweather.co.za';

  const subject = `[ALERT] Station Offline: ${stationName} - No data for ${duration}`;

  const text = `STATION DATA STALENESS ALERT

Station: ${stationName} (ID: ${station.id})
Status: NO DATA RECEIVED
Duration: ${duration}
Last Data Received: ${lastConnectedDate.toUTCString()}
Connection Type: ${station.connectionType || station.connection_type || 'unknown'}
Staleness Threshold: ${STALENESS_THRESHOLD_MS / 3600000} hours

This station has not sent any new data in over ${duration}.

Possible causes:
- Station power failure or battery depletion
- Communication link failure (cellular modem, WiFi, etc.)
- Datalogger malfunction or program error
- Dropbox sync issue or cloud storage problem

Recommended actions:
1. Check station power supply and battery voltage
2. Verify communication link (modem, network connection)
3. Check Dropbox sync status in the dashboard
4. Contact field technician if remote diagnostics fail

Dashboard: ${dashboardUrl}

--
Stratus Weather - Station Monitoring
Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)
This is an automated alert from the staleness monitor.
Alert cooldown: ${ALERT_COOLDOWN_MS / 3600000} hours (no repeat alerts within this period)`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">
        STATION OFFLINE
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
        ${stationName}
      </p>
    </div>
    
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: #dc2626; font-size: 18px;">
          No Data for ${duration}
        </h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">
          This station has stopped sending data and may require attention.
        </p>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Station</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${stationName} (ID: ${station.id})</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Last Data</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-size: 14px; font-weight: 600;">${lastConnectedDate.toUTCString()}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Offline Duration</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${duration}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Connection Type</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px;">${station.connectionType || station.connection_type || 'unknown'}</td>
        </tr>
        <tr>
          <td style="padding: 12px; color: #6b7280; font-size: 14px;">Threshold</td>
          <td style="padding: 12px; color: #1e3a5f; font-size: 14px;">${STALENESS_THRESHOLD_MS / 3600000} hours</td>
        </tr>
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
        <a href="${dashboardUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          View Dashboard
        </a>
      </div>
    </div>
    
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 4px 0; color: #6b7280;">Stratus Weather - Station Monitoring</p>
      <p style="margin: 0;">Alert cooldown: ${ALERT_COOLDOWN_MS / 3600000} hours</p>
      <p style="margin: 12px 0 0 0; font-size: 11px;">Developed by <strong>Lukas Esterhuizen</strong></p>
      <p style="margin: 4px 0 0 0; font-size: 11px;">esterhuizen2k@proton.me</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const sent = await sendAlertEmail({
      to: adminEmails,
      subject,
      text,
      html,
    });

    if (sent) {
      console.log(`[StalenessMonitor] Staleness alert sent for ${stationName} (offline ${duration}) to ${adminEmails.join(', ')}`);
    } else {
      console.error(`[StalenessMonitor] Failed to send staleness alert for ${stationName}`);
    }
  } catch (error: any) {
    console.error(`[StalenessMonitor] Error sending staleness alert:`, error.message);
  }
}

/**
 * Send recovery alert when a previously-stale station comes back online
 */
async function sendRecoveryAlert(station: any, lastConnected: string): Promise<void> {
  const adminEmails = await getAdminEmails();
  if (adminEmails.length === 0) return;

  const stationName = station.name || `Station #${station.id}`;
  const lastConnectedDate = new Date(lastConnected);
  const dashboardUrl = process.env.APP_BASE_URL || process.env.PUBLIC_URL || 'https://stratusweather.co.za';

  const subject = `[RESOLVED] Station Online: ${stationName} - Data receiving resumed`;

  const text = `STATION RECOVERY NOTICE

Station: ${stationName} (ID: ${station.id})
Status: BACK ONLINE
Latest Data: ${lastConnectedDate.toUTCString()}

This station has resumed sending data and is no longer flagged as offline.

Dashboard: ${dashboardUrl}

--
Stratus Weather - Station Monitoring
Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)
This is an automated recovery notice from the staleness monitor.`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">
        STATION BACK ONLINE
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
        ${stationName}
      </p>
    </div>
    
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #dcfce7; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: #166534; font-size: 18px;">
          Data Receiving Resumed
        </h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">
          The station is sending data again and is no longer flagged as offline.
        </p>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Station</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${stationName} (ID: ${station.id})</td>
        </tr>
        <tr>
          <td style="padding: 12px; color: #6b7280; font-size: 14px;">Latest Data</td>
          <td style="padding: 12px; color: #22c55e; font-size: 14px; font-weight: 600;">${lastConnectedDate.toUTCString()}</td>
        </tr>
      </table>
      
      <div style="text-align: center; margin-top: 32px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          View Dashboard
        </a>
      </div>
    </div>
    
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather - Station Monitoring</p>
      <p style="margin: 0; font-size: 11px;">Developed by <strong>Lukas Esterhuizen</strong></p>
      <p style="margin: 4px 0 0 0; font-size: 11px;">esterhuizen2k@proton.me</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const sent = await sendAlertEmail({
      to: adminEmails,
      subject,
      text,
      html,
    });

    if (sent) {
      console.log(`[StalenessMonitor] Recovery alert sent for ${stationName} to ${adminEmails.join(', ')}`);
    }
  } catch (error: any) {
    console.error(`[StalenessMonitor] Error sending recovery alert:`, error.message);
  }
}

/**
 * Manually trigger a staleness check (for testing/API use)
 */
export async function triggerStalenessCheck(): Promise<{ stale: any[]; healthy: any[] }> {
  const stations = await getAllStations();
  const now = Date.now();
  const stale: any[] = [];
  const healthy: any[] = [];

  for (const station of stations) {
    if (station.isActive === false || station.is_active === false) continue;
    if (station.connectionType === 'demo' || station.connection_type === 'demo') continue;

    const lastConnected = station.lastConnected || station.last_connected;
    const stationName = station.name || `Station #${station.id}`;

    if (!lastConnected) {
      continue; // Never connected
    }

    const lastConnectedTime = new Date(lastConnected).getTime();
    const timeSinceLastData = now - lastConnectedTime;

    if (timeSinceLastData > STALENESS_THRESHOLD_MS) {
      stale.push({
        id: station.id,
        name: stationName,
        lastConnected,
        offlineDuration: formatDuration(timeSinceLastData),
        offlineMs: timeSinceLastData,
      });
    } else {
      healthy.push({
        id: station.id,
        name: stationName,
        lastConnected,
      });
    }
  }

  return { stale, healthy };
}

/**
 * Send a test staleness alert email to verify the system works
 */
export async function sendTestStalenessAlert(recipientEmail?: string): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.error('[StalenessMonitor] Email not configured');
    return false;
  }

  const recipients = recipientEmail ? [recipientEmail] : await getAdminEmails();
  if (recipients.length === 0) {
    console.error('[StalenessMonitor] No recipients for test email');
    return false;
  }

  const dashboardUrl = process.env.APP_BASE_URL || process.env.PUBLIC_URL || 'https://stratusweather.co.za';

  const subject = `[TEST] Stratus Weather - Staleness Monitor Active`;

  const text = `STALENESS MONITOR TEST

This is a test email to confirm that the Stratus Weather staleness monitor is active and email delivery is working correctly.

Configuration:
- Check interval: ${CHECK_INTERVAL_MS / 60000} minutes
- Staleness threshold: ${STALENESS_THRESHOLD_MS / 3600000} hours
- Alert cooldown: ${ALERT_COOLDOWN_MS / 3600000} hours

If a station stops sending data for more than ${STALENESS_THRESHOLD_MS / 3600000} hours, you will receive an alert email similar to this one.

Dashboard: ${dashboardUrl}

--
Stratus Weather - Station Monitoring
Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)
Test sent at: ${new Date().toUTCString()}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0f4f8;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); border-radius: 12px 12px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">
        Staleness Monitor Active
      </h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
        Test Email - Configuration Verified
      </p>
    </div>
    
    <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <h2 style="margin: 0 0 8px 0; color: #1d4ed8; font-size: 18px;">
          Email Delivery Confirmed
        </h2>
        <p style="margin: 0; color: #4b5563; font-size: 14px;">
          The staleness monitor is active and will alert you when stations go offline.
        </p>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Check Interval</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">Every ${CHECK_INTERVAL_MS / 60000} minutes</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Staleness Threshold</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${STALENESS_THRESHOLD_MS / 3600000} hours</td>
        </tr>
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">Alert Cooldown</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1e3a5f; font-size: 14px; font-weight: 500;">${ALERT_COOLDOWN_MS / 3600000} hours</td>
        </tr>
        <tr>
          <td style="padding: 12px; color: #6b7280; font-size: 14px;">Test Sent At</td>
          <td style="padding: 12px; color: #1e3a5f; font-size: 14px;">${new Date().toUTCString()}</td>
        </tr>
      </table>
      
      <div style="text-align: center; margin-top: 32px;">
        <a href="${dashboardUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          View Dashboard
        </a>
      </div>
    </div>
    
    <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px; font-family: Arial, Helvetica, sans-serif;">
      <p style="margin: 0 0 8px 0; color: #6b7280;">Stratus Weather - Station Monitoring</p>
      <p style="margin: 0; font-size: 11px;">Developed by <strong>Lukas Esterhuizen</strong></p>
      <p style="margin: 4px 0 0 0; font-size: 11px;">esterhuizen2k@proton.me</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const sent = await sendAlertEmail({
      to: recipients,
      subject,
      text,
      html,
    });

    if (sent) {
      console.log(`[StalenessMonitor] Test email sent to ${recipients.join(', ')}`);
    }
    return sent;
  } catch (error: any) {
    console.error(`[StalenessMonitor] Error sending test email:`, error.message);
    return false;
  }
}

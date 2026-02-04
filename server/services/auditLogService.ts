/**
 * Audit Logging Service
 * Tracks all admin actions for security compliance and accountability
 */

import fs from 'fs';
import path from 'path';

export interface AuditLogEntry {
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceId?: string | number;
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  status: 'success' | 'failure';
  errorMessage?: string;
}

// Audit log actions
export const AUDIT_ACTIONS = {
  // Authentication
  LOGIN: 'USER_LOGIN',
  LOGOUT: 'USER_LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET_REQUEST: 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_ACTIVATED: 'USER_ACTIVATED',
  
  // User Management
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',
  
  // Station Management
  STATION_CREATE: 'STATION_CREATE',
  STATION_UPDATE: 'STATION_UPDATE',
  STATION_DELETE: 'STATION_DELETE',
  STATION_CONNECT: 'STATION_CONNECT',
  STATION_DISCONNECT: 'STATION_DISCONNECT',
  
  // Data Collection
  DATA_COLLECT: 'DATA_COLLECT',
  DATA_EXPORT: 'DATA_EXPORT',
  DATA_DELETE: 'DATA_DELETE',
  
  // Alarm Management
  ALARM_CREATE: 'ALARM_CREATE',
  ALARM_UPDATE: 'ALARM_UPDATE',
  ALARM_DELETE: 'ALARM_DELETE',
  ALARM_ACKNOWLEDGE: 'ALARM_ACKNOWLEDGE',
  
  // Organization Management
  ORG_CREATE: 'ORG_CREATE',
  ORG_UPDATE: 'ORG_UPDATE',
  ORG_DELETE: 'ORG_DELETE',
  
  // Settings
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  
  // System
  SYSTEM_STARTUP: 'SYSTEM_STARTUP',
  SYSTEM_SHUTDOWN: 'SYSTEM_SHUTDOWN',
  CONFIG_CHANGE: 'CONFIG_CHANGE',
} as const;

export type AuditAction = typeof AUDIT_ACTIONS[keyof typeof AUDIT_ACTIONS];

class AuditLogService {
  private logDir: string;
  private currentLogFile: string;
  private inMemoryLogs: AuditLogEntry[] = [];
  private maxInMemoryLogs: number = 1000;

  constructor() {
    this.logDir = path.join(process.cwd(), 'logs', 'audit');
    this.currentLogFile = this.getLogFileName();
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create audit log directory:', error);
    }
  }

  private getLogFileName(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `audit-${date}.log`);
  }

  private formatLogEntry(entry: AuditLogEntry): string {
    return JSON.stringify(entry) + '\n';
  }

  /**
   * Log an admin action
   */
  async log(
    action: AuditAction,
    resource: string,
    options: {
      userId?: string;
      userEmail?: string;
      resourceId?: string | number;
      details?: Record<string, any>;
      ip?: string;
      userAgent?: string;
      status?: 'success' | 'failure';
      errorMessage?: string;
    } = {}
  ): Promise<void> {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      userId: options.userId || 'system',
      userEmail: options.userEmail || 'system@stratus.local',
      action,
      resource,
      resourceId: options.resourceId,
      details: this.sanitizeDetails(options.details),
      ip: options.ip,
      userAgent: options.userAgent,
      status: options.status || 'success',
      errorMessage: options.errorMessage,
    };

    // Store in memory
    this.inMemoryLogs.push(entry);
    if (this.inMemoryLogs.length > this.maxInMemoryLogs) {
      this.inMemoryLogs.shift();
    }

    // Write to file
    try {
      // Check if we need a new log file (date changed)
      const newLogFile = this.getLogFileName();
      if (newLogFile !== this.currentLogFile) {
        this.currentLogFile = newLogFile;
      }

      fs.appendFileSync(this.currentLogFile, this.formatLogEntry(entry));
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[AUDIT] ${entry.action} - ${entry.resource} by ${entry.userEmail} (${entry.status})`);
    }
  }

  /**
   * Sanitize details to remove sensitive information
   */
  private sanitizeDetails(details?: Record<string, any>): Record<string, any> | undefined {
    if (!details) return undefined;

    const sensitiveKeys = ['password', 'passwordHash', 'token', 'secret', 'apiKey', 'accessToken', 'refreshToken'];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(details)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeDetails(value as Record<string, any>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get recent audit logs from memory
   */
  getRecentLogs(limit: number = 100): AuditLogEntry[] {
    return this.inMemoryLogs.slice(-limit);
  }

  /**
   * Get audit logs for a specific date
   */
  async getLogsForDate(date: string): Promise<AuditLogEntry[]> {
    const logFile = path.join(this.logDir, `audit-${date}.log`);
    
    if (!fs.existsSync(logFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);
      return lines.map(line => JSON.parse(line) as AuditLogEntry);
    } catch (error) {
      console.error('Failed to read audit log:', error);
      return [];
    }
  }

  /**
   * Get audit logs for a specific user
   */
  async getLogsForUser(userId: string, days: number = 30): Promise<AuditLogEntry[]> {
    const logs: AuditLogEntry[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayLogs = await this.getLogsForDate(dateStr);
      logs.push(...dayLogs.filter(log => log.userId === userId));
    }

    return logs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Get audit logs for a specific action
   */
  async getLogsForAction(action: AuditAction, days: number = 30): Promise<AuditLogEntry[]> {
    const logs: AuditLogEntry[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayLogs = await this.getLogsForDate(dateStr);
      logs.push(...dayLogs.filter(log => log.action === action));
    }

    return logs.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Search audit logs
   */
  async searchLogs(
    criteria: {
      action?: AuditAction;
      userId?: string;
      resource?: string;
      startDate?: string;
      endDate?: string;
      status?: 'success' | 'failure';
    },
    limit: number = 500
  ): Promise<AuditLogEntry[]> {
    const startDate = criteria.startDate ? new Date(criteria.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = criteria.endDate ? new Date(criteria.endDate) : new Date();
    
    const logs: AuditLogEntry[] = [];
    const current = new Date(endDate);

    while (current >= startDate && logs.length < limit) {
      const dateStr = current.toISOString().split('T')[0];
      const dayLogs = await this.getLogsForDate(dateStr);
      
      const filtered = dayLogs.filter(log => {
        if (criteria.action && log.action !== criteria.action) return false;
        if (criteria.userId && log.userId !== criteria.userId) return false;
        if (criteria.resource && !log.resource.includes(criteria.resource)) return false;
        if (criteria.status && log.status !== criteria.status) return false;
        return true;
      });

      logs.push(...filtered);
      current.setDate(current.getDate() - 1);
    }

    return logs.slice(0, limit).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }
}

// Singleton instance
export const auditLog = new AuditLogService();
export default auditLog;

// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * Logger Utility
 * 
 * Centralized logging for the Stratus server.
 * In production, logs can be configured to write to files, 
 * or be silenced based on log level.
 * 
 * Log Levels:
 * - error: Critical errors that need attention
 * - warn: Warning conditions
 * - info: Informational messages (default in production)
 * - debug: Detailed debugging information (disabled in production)
 */

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
  silent?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Get log level from environment or default to 'info' in production, 'debug' in development
const getDefaultLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level || getDefaultLevel(),
      prefix: config.prefix,
      silent: config.silent || false,
    };
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.config.silent) return false;
    return LOG_LEVELS[level] <= LOG_LEVELS[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const prefix = this.config.prefix ? `[${this.config.prefix}]` : '';
    return `${timestamp} ${level.toUpperCase()} ${prefix} ${message}`;
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  /**
   * Create a child logger with a specific prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: this.config.prefix ? `${this.config.prefix}:${prefix}` : prefix,
    });
  }
}

// Default logger instance
const logger = new Logger();

// Named loggers for different modules
export const authLogger = logger.child('Auth');
export const dbLogger = logger.child('DB');
export const campbellLogger = logger.child('Campbell');
export const apiLogger = logger.child('API');
export const wsLogger = logger.child('WebSocket');
export const syncLogger = logger.child('Sync');
export const fileWatcherLogger = logger.child('FileWatcher');
export const emailLogger = logger.child('Email');

export { Logger };
export default logger;

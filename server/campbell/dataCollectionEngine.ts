// Stratus Weather System
// Created by Lukas Esterhuizen

/// <reference types="node" />
/**
 * Data Collection Engine
 * Handles scheduled data collection, gap filling, and data processing
 */

import { EventEmitter } from "events";
import { connectionManager, ConnectionHealth } from "./connectionManager";
import { PakBusProtocol, TableDefinition, CollectedRecord } from "./pakbusProtocol";
import * as cron from "node-cron";

export interface CollectionSchedule {
  stationId: number;
  tableName: string;
  schedule: string; // Cron expression
  enabled: boolean;
  lastCollection?: Date;
  nextCollection?: Date;
  recordsCollected?: number;
  retention?: number; // Days to keep data
}

export interface DataProcessingRule {
  id: string;
  stationId: number;
  tableName: string;
  column: string;
  type: "scale" | "offset" | "calibration" | "qc" | "aggregate";
  parameters: Record<string, any>;
  enabled: boolean;
}

export interface CollectionResult {
  stationId: number;
  tableName: string;
  timestamp: Date;
  recordsCollected: number;
  success: boolean;
  error?: string;
  duration: number;
}

interface ScheduledTask {
  schedule: CollectionSchedule;
  task: cron.ScheduledTask | null;
}

export class DataCollectionEngine extends EventEmitter {
  private schedules: Map<string, ScheduledTask> = new Map();
  private processingRules: Map<string, DataProcessingRule> = new Map();
  private collectionHistory: CollectionResult[] = [];
  private maxHistoryLength: number = 1000;
  
  // Gap tracking
  private lastRecordNumbers: Map<string, number> = new Map();

  constructor() {
    super();
    this.setupConnectionEvents();
  }

  /**
   * Setup connection manager event handlers
   */
  private setupConnectionEvents(): void {
    connectionManager.on("connected", (stationId: number) => {
      // Check for data gaps when connection is restored
      this.checkForGaps(stationId);
    });

    connectionManager.on("data", (stationId: number, data: any) => {
      this.processIncomingData(stationId, data);
    });
  }

  /**
   * Add collection schedule
   */
  addSchedule(schedule: CollectionSchedule): void {
    const key = `${schedule.stationId}-${schedule.tableName}`;
    
    // Remove existing schedule if any
    this.removeSchedule(schedule.stationId, schedule.tableName);

    // Create cron task
    let task: cron.ScheduledTask | null = null;
    
    if (schedule.enabled) {
      task = cron.schedule(schedule.schedule, () => {
        this.collectTable(schedule.stationId, schedule.tableName);
      });
    }

    this.schedules.set(key, { schedule, task });
    this.emit("schedule-added", schedule);
  }

  /**
   * Remove collection schedule
   */
  removeSchedule(stationId: number, tableName: string): void {
    const key = `${stationId}-${tableName}`;
    const existing = this.schedules.get(key);
    
    if (existing) {
      if (existing.task) {
        existing.task.stop();
      }
      this.schedules.delete(key);
      this.emit("schedule-removed", { stationId, tableName });
    }
  }

  /**
   * Enable/disable schedule
   */
  setScheduleEnabled(stationId: number, tableName: string, enabled: boolean): void {
    const key = `${stationId}-${tableName}`;
    const existing = this.schedules.get(key);
    
    if (existing) {
      existing.schedule.enabled = enabled;
      
      if (enabled && !existing.task) {
        existing.task = cron.schedule(existing.schedule.schedule, () => {
          this.collectTable(stationId, tableName);
        });
      } else if (!enabled && existing.task) {
        existing.task.stop();
        existing.task = null;
      }
      
      this.emit("schedule-updated", existing.schedule);
    }
  }

  /**
   * Get all schedules for a station
   */
  getSchedules(stationId?: number): CollectionSchedule[] {
    const schedules: CollectionSchedule[] = [];
    
    for (const [key, value] of this.schedules) {
      if (stationId === undefined || value.schedule.stationId === stationId) {
        schedules.push(value.schedule);
      }
    }
    
    return schedules;
  }

  /**
   * Collect data from a specific table
   */
  async collectTable(stationId: number, tableName: string): Promise<CollectionResult> {
    const startTime = Date.now();
    const result: CollectionResult = {
      stationId,
      tableName,
      timestamp: new Date(),
      recordsCollected: 0,
      success: false,
      duration: 0,
    };

    try {
      const pakbus = connectionManager.getPakBus(stationId);
      if (!pakbus) {
        throw new Error("Station not connected");
      }

      // Get last record number to collect only new records
      const lastRecordKey = `${stationId}-${tableName}`;
      const lastRecord = this.lastRecordNumbers.get(lastRecordKey) || 0;

      // Collect data
      const collectResult = await pakbus.collectData(tableName, lastRecord + 1);
      
      if (!collectResult.success) {
        throw new Error(collectResult.error || "Collection failed");
      }

      const records = collectResult.data as CollectedRecord[];
      result.recordsCollected = records.length;
      result.success = true;

      // Update last record number
      if (records.length > 0) {
        const maxRecord = Math.max(...records.map(r => r.recordNumber));
        this.lastRecordNumbers.set(lastRecordKey, maxRecord);
      }

      // Process records
      for (const record of records) {
        const processedRecord = this.applyProcessingRules(stationId, tableName, record);
        this.emit("data-collected", stationId, tableName, processedRecord);
      }

      // Update schedule info
      const scheduleKey = `${stationId}-${tableName}`;
      const schedule = this.schedules.get(scheduleKey);
      if (schedule) {
        schedule.schedule.lastCollection = new Date();
        schedule.schedule.recordsCollected = (schedule.schedule.recordsCollected || 0) + records.length;
      }

    } catch (error: any) {
      result.success = false;
      result.error = error.message;
      this.emit("collection-error", stationId, tableName, error);
    }

    result.duration = Date.now() - startTime;
    this.addToHistory(result);
    this.emit("collection-complete", result);
    
    return result;
  }

  /**
   * Collect all tables for a station
   */
  async collectAll(stationId: number): Promise<CollectionResult[]> {
    const results: CollectionResult[] = [];
    const schedules = this.getSchedules(stationId);

    for (const schedule of schedules) {
      const result = await this.collectTable(stationId, schedule.tableName);
      results.push(result);
    }

    return results;
  }

  /**
   * Check for data gaps and fill them
   */
  async checkForGaps(stationId: number): Promise<void> {
    const schedules = this.getSchedules(stationId);
    
    for (const schedule of schedules) {
      await this.fillGaps(stationId, schedule.tableName);
    }
  }

  /**
   * Fill data gaps for a table
   */
  async fillGaps(stationId: number, tableName: string): Promise<number> {
    let gapsFilled = 0;
    
    try {
      const pakbus = connectionManager.getPakBus(stationId);
      if (!pakbus) return 0;

      // Get table definitions to understand record structure
      const tableDefsResult = await pakbus.getTableDefinitions();
      if (!tableDefsResult.success) return 0;

      const tableDef = (tableDefsResult.data as TableDefinition[])
        .find(t => t.tableName === tableName);
      if (!tableDef) return 0;

      // Calculate expected records based on last collection and interval
      const lastRecordKey = `${stationId}-${tableName}`;
      const lastRecord = this.lastRecordNumbers.get(lastRecordKey) || 0;

      // Request any missing records
      const collectResult = await pakbus.collectData(tableName, lastRecord + 1);
      if (collectResult.success) {
        const records = collectResult.data as CollectedRecord[];
        gapsFilled = records.length;

        for (const record of records) {
          const processedRecord = this.applyProcessingRules(stationId, tableName, record);
          this.emit("gap-filled", stationId, tableName, processedRecord);
        }

        // Update last record
        if (records.length > 0) {
          const maxRecord = Math.max(...records.map(r => r.recordNumber));
          this.lastRecordNumbers.set(lastRecordKey, maxRecord);
        }
      }
    } catch (error) {
      console.error(`Error filling gaps for ${stationId}/${tableName}:`, error);
    }

    return gapsFilled;
  }

  /**
   * Add data processing rule
   */
  addProcessingRule(rule: DataProcessingRule): void {
    this.processingRules.set(rule.id, rule);
    this.emit("rule-added", rule);
  }

  /**
   * Remove data processing rule
   */
  removeProcessingRule(ruleId: string): void {
    this.processingRules.delete(ruleId);
    this.emit("rule-removed", ruleId);
  }

  /**
   * Get processing rules for a table
   */
  getProcessingRules(stationId: number, tableName?: string): DataProcessingRule[] {
    const rules: DataProcessingRule[] = [];
    
    for (const rule of this.processingRules.values()) {
      if (rule.stationId === stationId) {
        if (tableName === undefined || rule.tableName === tableName) {
          rules.push(rule);
        }
      }
    }
    
    return rules;
  }

  /**
   * Apply processing rules to a record
   */
  private applyProcessingRules(
    stationId: number,
    tableName: string,
    record: CollectedRecord
  ): CollectedRecord {
    const rules = this.getProcessingRules(stationId, tableName);
    const processed = { ...record, values: { ...record.values } };

    for (const rule of rules) {
      if (!rule.enabled) continue;

      const value = processed.values[rule.column];
      if (value === undefined) continue;

      switch (rule.type) {
        case "scale":
          if (typeof value === "number") {
            processed.values[rule.column] = value * (rule.parameters.factor || 1);
          }
          break;

        case "offset":
          if (typeof value === "number") {
            processed.values[rule.column] = value + (rule.parameters.offset || 0);
          }
          break;

        case "calibration":
          if (typeof value === "number") {
            // Apply polynomial calibration: y = a0 + a1*x + a2*x^2 + ...
            const coeffs = rule.parameters.coefficients || [0, 1];
            let result = 0;
            for (let i = 0; i < coeffs.length; i++) {
              result += coeffs[i] * Math.pow(value, i);
            }
            processed.values[rule.column] = result;
          }
          break;

        case "qc":
          if (typeof value === "number") {
            // Quality control - flag or remove out-of-range values
            const min = rule.parameters.min ?? -Infinity;
            const max = rule.parameters.max ?? Infinity;
            if (value < min || value > max) {
              if (rule.parameters.action === "null") {
                processed.values[rule.column] = null as any;
              } else if (rule.parameters.action === "flag") {
                processed.values[`${rule.column}_qc`] = "out_of_range";
              }
            }
          }
          break;
      }
    }

    return processed;
  }

  /**
   * Process incoming data (push mode)
   */
  private processIncomingData(stationId: number, data: any): void {
    // Handle pushed data from station
    if (data.tableName && data.records) {
      for (const record of data.records) {
        const processed = this.applyProcessingRules(stationId, data.tableName, record);
        this.emit("data-received", stationId, data.tableName, processed);
      }

      // Update last record number
      const lastRecordKey = `${stationId}-${data.tableName}`;
      if (data.records.length > 0) {
        const maxRecord = Math.max(...data.records.map((r: CollectedRecord) => r.recordNumber));
        const currentLast = this.lastRecordNumbers.get(lastRecordKey) || 0;
        if (maxRecord > currentLast) {
          this.lastRecordNumbers.set(lastRecordKey, maxRecord);
        }
      }
    }
  }

  /**
   * Add result to history
   */
  private addToHistory(result: CollectionResult): void {
    this.collectionHistory.unshift(result);
    if (this.collectionHistory.length > this.maxHistoryLength) {
      this.collectionHistory.pop();
    }
  }

  /**
   * Get collection history
   */
  getHistory(
    stationId?: number,
    tableName?: string,
    limit: number = 100
  ): CollectionResult[] {
    let history = this.collectionHistory;

    if (stationId !== undefined) {
      history = history.filter(h => h.stationId === stationId);
    }

    if (tableName !== undefined) {
      history = history.filter(h => h.tableName === tableName);
    }

    return history.slice(0, limit);
  }

  /**
   * Get collection statistics
   */
  getStatistics(stationId?: number): {
    totalCollections: number;
    successfulCollections: number;
    failedCollections: number;
    totalRecords: number;
    averageDuration: number;
  } {
    let history = this.collectionHistory;

    if (stationId !== undefined) {
      history = history.filter(h => h.stationId === stationId);
    }

    const successful = history.filter(h => h.success);
    const failed = history.filter(h => !h.success);
    const totalRecords = successful.reduce((sum, h) => sum + h.recordsCollected, 0);
    const avgDuration = history.length > 0
      ? history.reduce((sum, h) => sum + h.duration, 0) / history.length
      : 0;

    return {
      totalCollections: history.length,
      successfulCollections: successful.length,
      failedCollections: failed.length,
      totalRecords,
      averageDuration: Math.round(avgDuration),
    };
  }

  /**
   * Stop all scheduled tasks
   */
  stopAll(): void {
    for (const [key, value] of this.schedules) {
      if (value.task) {
        value.task.stop();
      }
    }
    this.emit("stopped");
  }

  /**
   * Start all enabled scheduled tasks
   */
  startAll(): void {
    for (const [key, value] of this.schedules) {
      if (value.schedule.enabled && !value.task) {
        value.task = cron.schedule(value.schedule.schedule, () => {
          this.collectTable(value.schedule.stationId, value.schedule.tableName);
        });
      }
    }
    this.emit("started");
  }
}

export const dataCollectionEngine = new DataCollectionEngine();

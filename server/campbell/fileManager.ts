// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * Campbell Scientific File Manager
 * Handles file operations on dataloggers: listing, download, upload, delete, backup/restore
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PakBusProtocol, MESSAGE_TYPES } from './pakbusProtocol';

// File attributes from Campbell dataloggers
export interface DataloggerFile {
  name: string;
  size: number;
  lastModified: Date;
  attributes: FileAttributes;
  path: string;
}

export interface FileAttributes {
  readOnly: boolean;
  hidden: boolean;
  system: boolean;
  paused: boolean;
  runOnPowerUp: boolean;
  runNow: boolean;
}

export interface TransferProgress {
  fileName: string;
  totalBytes: number;
  transferredBytes: number;
  percentComplete: number;
  bytesPerSecond: number;
  estimatedTimeRemaining: number;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface StorageInfo {
  device: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  percentUsed: number;
}

export interface BackupInfo {
  id: string;
  stationId: string;
  stationName: string;
  timestamp: Date;
  files: string[];
  totalSize: number;
  backupPath: string;
  notes?: string;
}

// File control commands for PakBus
const FILE_COMMANDS = {
  COMPILE_RUN: 0x01,
  COMPILE_SET_RUN_ON_PU: 0x02,
  RUN_NOW: 0x03,
  SET_RUN_ON_PU: 0x04,
  RUN_ON_PU_COMPILE_RUN: 0x05,
  STOP_PROGRAM: 0x06,
  DELETE_STOP_PROGRAM: 0x07,
  STOP_DELETE_RUN_ON_PU: 0x08,
  PAUSE: 0x09,
  RESUME: 0x0A,
  MARK_FOR_DELETE: 0x0B,
  GET_FILE: 0x0C,
  SEND_FILE: 0x0D,
  DIR_LIST: 0x0E,
  FORMAT_DEVICE: 0x0F,
  FILE_INFO: 0x10,
  CLOSE_FILE: 0x11
};

// Default storage devices on Campbell dataloggers
const STORAGE_DEVICES = {
  CPU: 'CPU:',
  USR: 'USR:',
  CRD: 'CRD:',  // CF card
  USB: 'USB:'
};

export class FileManager extends EventEmitter {
  private pakbus: PakBusProtocol;
  private activeTransfers: Map<string, TransferProgress> = new Map();
  private backupDir: string;
  private chunkSize: number = 512; // Bytes per transfer chunk

  constructor(pakbus: PakBusProtocol, backupDir?: string) {
    super();
    this.pakbus = pakbus;
    this.backupDir = backupDir || this.getDefaultBackupDir();
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Get a writable default backup directory (same logic as db.ts)
   */
  private getDefaultBackupDir(): string {
    if (process.env.STRATUS_DATA_DIR) {
      return path.join(process.env.STRATUS_DATA_DIR, 'backups');
    }
    const platform = process.platform;
    let appDataPath: string;
    if (platform === 'win32') {
      appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (platform === 'darwin') {
      appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
      appDataPath = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    }
    return path.join(appDataPath, 'Stratus Weather Server', 'backups');
  }

  /**
   * List files on a storage device
   */
  async listFiles(stationAddress: number, device: string = 'CPU:'): Promise<DataloggerFile[]> {
    const files: DataloggerFile[] = [];
    
    try {
      // Build directory listing request
      const payload = this.buildDirListPayload(device);
      
      const response = await this.pakbus.sendTransaction(
        stationAddress,
        MESSAGE_TYPES.FILE_CONTROL,
        payload
      );

      if (response && response.data) {
        const parsedFiles = this.parseDirectoryListing(response.data, device);
        files.push(...parsedFiles);
      }

      this.emit('files-listed', { stationAddress, device, files });
      return files;
    } catch (error) {
      this.emit('error', { operation: 'listFiles', error });
      throw error;
    }
  }

  /**
   * Get information about a specific file
   */
  async getFileInfo(stationAddress: number, filePath: string): Promise<DataloggerFile | null> {
    try {
      const payload = this.buildFileInfoPayload(filePath);
      
      const response = await this.pakbus.sendTransaction(
        stationAddress,
        MESSAGE_TYPES.FILE_CONTROL,
        payload
      );

      if (response && response.data) {
        return this.parseFileInfo(response.data, filePath);
      }

      return null;
    } catch (error) {
      this.emit('error', { operation: 'getFileInfo', error });
      throw error;
    }
  }

  /**
   * Download a file from the datalogger
   * Includes path sanitization to prevent directory traversal attacks
   */
  async downloadFile(
    stationAddress: number,
    remoteFilePath: string,
    localFilePath: string
  ): Promise<boolean> {
    const transferId = `download-${Date.now()}`;
    
    // SECURITY: Sanitize and validate local file path to prevent directory traversal
    const resolvedPath = path.resolve(localFilePath);
    const allowedDir = path.resolve(this.backupDir);
    
    if (!resolvedPath.startsWith(allowedDir + path.sep) && resolvedPath !== allowedDir) {
      throw new Error(`Invalid file path: must be within backup directory (${allowedDir})`);
    }
    
    // Initialize progress tracking
    const progress: TransferProgress = {
      fileName: remoteFilePath,
      totalBytes: 0,
      transferredBytes: 0,
      percentComplete: 0,
      bytesPerSecond: 0,
      estimatedTimeRemaining: 0,
      status: 'pending'
    };
    this.activeTransfers.set(transferId, progress);

    try {
      // Get file info first to know total size
      const fileInfo = await this.getFileInfo(stationAddress, remoteFilePath);
      if (!fileInfo) {
        throw new Error(`File not found: ${remoteFilePath}`);
      }

      progress.totalBytes = fileInfo.size;
      progress.status = 'in-progress';
      this.emitProgress(transferId, progress);

      // Ensure local directory exists (using sanitized path)
      const localDir = path.dirname(resolvedPath);
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }

      // Open local file for writing (using sanitized path)
      const writeStream = fs.createWriteStream(resolvedPath);
      const startTime = Date.now();
      let offset = 0;

      // Download in chunks
      while (offset < fileInfo.size) {
        const bytesToRead = Math.min(this.chunkSize, fileInfo.size - offset);
        
        const payload = this.buildGetFilePayload(remoteFilePath, offset, bytesToRead);
        
        const response = await this.pakbus.sendTransaction(
          stationAddress,
          MESSAGE_TYPES.FILE_CONTROL,
          payload
        );

        if (response && response.data) {
          const chunk = this.extractFileChunk(response.data);
          if (chunk.length > 0) {
            writeStream.write(chunk);
            offset += chunk.length;
            
            // Update progress
            progress.transferredBytes = offset;
            progress.percentComplete = (offset / fileInfo.size) * 100;
            
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            progress.bytesPerSecond = offset / elapsedSeconds;
            progress.estimatedTimeRemaining = 
              (fileInfo.size - offset) / progress.bytesPerSecond;
            
            this.emitProgress(transferId, progress);
          }
        } else {
          throw new Error('Failed to receive file chunk');
        }
      }

      writeStream.end();
      
      progress.status = 'completed';
      progress.percentComplete = 100;
      this.emitProgress(transferId, progress);
      this.activeTransfers.delete(transferId);

      this.emit('download-complete', { 
        stationAddress, 
        remoteFilePath, 
        localFilePath,
        size: fileInfo.size 
      });

      return true;
    } catch (error) {
      progress.status = 'failed';
      progress.error = error instanceof Error ? error.message : String(error);
      this.emitProgress(transferId, progress);
      this.activeTransfers.delete(transferId);
      
      this.emit('error', { operation: 'downloadFile', error });
      throw error;
    }
  }

  /**
   * Upload a file to the datalogger
   */
  async uploadFile(
    stationAddress: number,
    localFilePath: string,
    remoteFilePath: string,
    options?: { compileRun?: boolean; setRunOnPowerUp?: boolean }
  ): Promise<boolean> {
    const transferId = `upload-${Date.now()}`;

    // Check if local file exists
    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Local file not found: ${localFilePath}`);
    }

    const stats = fs.statSync(localFilePath);
    
    // Initialize progress tracking
    const progress: TransferProgress = {
      fileName: localFilePath,
      totalBytes: stats.size,
      transferredBytes: 0,
      percentComplete: 0,
      bytesPerSecond: 0,
      estimatedTimeRemaining: 0,
      status: 'pending'
    };
    this.activeTransfers.set(transferId, progress);

    try {
      progress.status = 'in-progress';
      this.emitProgress(transferId, progress);

      const fileBuffer = fs.readFileSync(localFilePath);
      const startTime = Date.now();
      let offset = 0;

      // Start file send
      const startPayload = this.buildSendFileStartPayload(remoteFilePath, stats.size);
      await this.pakbus.sendTransaction(
        stationAddress,
        MESSAGE_TYPES.FILE_CONTROL,
        startPayload
      );

      // Upload in chunks
      while (offset < fileBuffer.length) {
        const bytesToSend = Math.min(this.chunkSize, fileBuffer.length - offset);
        const chunk = fileBuffer.slice(offset, offset + bytesToSend);
        
        const payload = this.buildSendFileChunkPayload(
          remoteFilePath, 
          offset, 
          chunk,
          offset + bytesToSend >= fileBuffer.length // Last chunk
        );
        
        const response = await this.pakbus.sendTransaction(
          stationAddress,
          MESSAGE_TYPES.FILE_CONTROL,
          payload
        );

        if (response && response.success) {
          offset += bytesToSend;
          
          // Update progress
          progress.transferredBytes = offset;
          progress.percentComplete = (offset / stats.size) * 100;
          
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          progress.bytesPerSecond = offset / elapsedSeconds;
          progress.estimatedTimeRemaining = 
            (stats.size - offset) / progress.bytesPerSecond;
          
          this.emitProgress(transferId, progress);
        } else {
          throw new Error('Failed to send file chunk');
        }
      }

      // Close the file
      const closePayload = this.buildCloseFilePayload(remoteFilePath);
      await this.pakbus.sendTransaction(
        stationAddress,
        MESSAGE_TYPES.FILE_CONTROL,
        closePayload
      );

      // Optionally compile and run
      if (options?.compileRun || options?.setRunOnPowerUp) {
        const command = options.setRunOnPowerUp 
          ? FILE_COMMANDS.COMPILE_SET_RUN_ON_PU 
          : FILE_COMMANDS.COMPILE_RUN;
        
        const runPayload = this.buildFileCommandPayload(remoteFilePath, command);
        await this.pakbus.sendTransaction(
          stationAddress,
          MESSAGE_TYPES.FILE_CONTROL,
          runPayload
        );
      }

      progress.status = 'completed';
      progress.percentComplete = 100;
      this.emitProgress(transferId, progress);
      this.activeTransfers.delete(transferId);

      this.emit('upload-complete', { 
        stationAddress, 
        localFilePath, 
        remoteFilePath,
        size: stats.size 
      });

      return true;
    } catch (error) {
      progress.status = 'failed';
      progress.error = error instanceof Error ? error.message : String(error);
      this.emitProgress(transferId, progress);
      this.activeTransfers.delete(transferId);
      
      this.emit('error', { operation: 'uploadFile', error });
      throw error;
    }
  }

  /**
   * Delete a file from the datalogger
   */
  async deleteFile(stationAddress: number, filePath: string): Promise<boolean> {
    try {
      const payload = this.buildFileCommandPayload(filePath, FILE_COMMANDS.MARK_FOR_DELETE);
      
      const response = await this.pakbus.sendTransaction(
        stationAddress,
        MESSAGE_TYPES.FILE_CONTROL,
        payload
      );

      if (response && response.success) {
        this.emit('file-deleted', { stationAddress, filePath });
        return true;
      }

      return false;
    } catch (error) {
      this.emit('error', { operation: 'deleteFile', error });
      throw error;
    }
  }

  /**
   * Get storage device information
   */
  async getStorageInfo(stationAddress: number, device: string = 'CPU:'): Promise<StorageInfo> {
    try {
      // Request device status - typically from public status table
      const status = await this.pakbus.sendTransaction(
        stationAddress,
        MESSAGE_TYPES.COLLECT_DATA,
        this.buildStorageInfoPayload(device)
      );

      if (status && status.data) {
        return this.parseStorageInfo(status.data, device);
      }

      // Return default if unable to get info
      return {
        device,
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        percentUsed: 0
      };
    } catch (error) {
      this.emit('error', { operation: 'getStorageInfo', error });
      throw error;
    }
  }

  /**
   * Create a backup of station files
   */
  async createBackup(
    stationAddress: number,
    stationName: string,
    files?: string[],
    notes?: string
  ): Promise<BackupInfo> {
    const backupId = `backup-${stationAddress}-${Date.now()}`;
    const backupPath = path.join(this.backupDir, stationName, backupId);
    
    // Create backup directory
    fs.mkdirSync(backupPath, { recursive: true });

    try {
      // If no files specified, get all files from CPU:
      let filesToBackup = files;
      if (!filesToBackup || filesToBackup.length === 0) {
        const allFiles = await this.listFiles(stationAddress, 'CPU:');
        filesToBackup = allFiles.map(f => f.path);
      }

      const backedUpFiles: string[] = [];
      let totalSize = 0;

      // Download each file
      for (const remoteFile of filesToBackup) {
        try {
          const fileName = path.basename(remoteFile);
          const localPath = path.join(backupPath, fileName);
          
          await this.downloadFile(stationAddress, remoteFile, localPath);
          
          const stats = fs.statSync(localPath);
          totalSize += stats.size;
          backedUpFiles.push(fileName);
          
          this.emit('backup-progress', {
            backupId,
            currentFile: fileName,
            filesComplete: backedUpFiles.length,
            filesTotal: filesToBackup.length
          });
        } catch (error) {
          console.error(`Failed to backup ${remoteFile}:`, error);
        }
      }

      // Create backup manifest
      const backupInfo: BackupInfo = {
        id: backupId,
        stationId: String(stationAddress),
        stationName,
        timestamp: new Date(),
        files: backedUpFiles,
        totalSize,
        backupPath,
        notes
      };

      // Save manifest
      const manifestPath = path.join(backupPath, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(backupInfo, null, 2));

      this.emit('backup-complete', backupInfo);
      return backupInfo;
    } catch (error) {
      this.emit('error', { operation: 'createBackup', error });
      throw error;
    }
  }

  /**
   * Restore files from a backup
   */
  async restoreBackup(
    stationAddress: number,
    backupId: string,
    files?: string[],
    options?: { compileRun?: boolean; setRunOnPowerUp?: boolean }
  ): Promise<boolean> {
    try {
      // Find the backup manifest
      const backupInfo = this.loadBackupInfo(backupId);
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      const filesToRestore = files || backupInfo.files;
      let restoredCount = 0;

      for (const fileName of filesToRestore) {
        try {
          const localPath = path.join(backupInfo.backupPath, fileName);
          
          if (!fs.existsSync(localPath)) {
            console.warn(`Backup file not found: ${localPath}`);
            continue;
          }

          const remotePath = `CPU:${fileName}`;
          
          // Determine if this is a program file
          const isProgramFile = fileName.endsWith('.CR1') || 
                               fileName.endsWith('.CR2') ||
                               fileName.endsWith('.CR3') ||
                               fileName.endsWith('.CR6') ||
                               fileName.endsWith('.CRB');
          
          await this.uploadFile(
            stationAddress,
            localPath,
            remotePath,
            isProgramFile ? options : undefined
          );
          
          restoredCount++;
          
          this.emit('restore-progress', {
            backupId,
            currentFile: fileName,
            filesComplete: restoredCount,
            filesTotal: filesToRestore.length
          });
        } catch (error) {
          console.error(`Failed to restore ${fileName}:`, error);
        }
      }

      this.emit('restore-complete', {
        backupId,
        filesRestored: restoredCount,
        filesTotal: filesToRestore.length
      });

      return restoredCount > 0;
    } catch (error) {
      this.emit('error', { operation: 'restoreBackup', error });
      throw error;
    }
  }

  /**
   * List all available backups
   */
  listBackups(stationName?: string): BackupInfo[] {
    const backups: BackupInfo[] = [];
    
    try {
      const searchDir = stationName 
        ? path.join(this.backupDir, stationName)
        : this.backupDir;

      if (!fs.existsSync(searchDir)) {
        return backups;
      }

      const searchBackupsInDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const manifestPath = path.join(dir, entry.name, 'manifest.json');
            
            if (fs.existsSync(manifestPath)) {
              try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                backups.push(manifest);
              } catch (e) {
                console.error(`Failed to read manifest: ${manifestPath}`);
              }
            } else {
              // Search subdirectories
              searchBackupsInDir(path.join(dir, entry.name));
            }
          }
        }
      };

      searchBackupsInDir(searchDir);
      
      // Sort by timestamp descending
      backups.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return backups;
    } catch (error) {
      console.error('Failed to list backups:', error);
      return backups;
    }
  }

  /**
   * Delete a backup
   */
  deleteBackup(backupId: string): boolean {
    try {
      const backupInfo = this.loadBackupInfo(backupId);
      if (!backupInfo) {
        return false;
      }

      // Remove backup directory
      fs.rmSync(backupInfo.backupPath, { recursive: true, force: true });
      
      this.emit('backup-deleted', backupId);
      return true;
    } catch (error) {
      console.error(`Failed to delete backup: ${backupId}`, error);
      return false;
    }
  }

  /**
   * Cancel an active transfer
   */
  cancelTransfer(transferId: string): boolean {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer && transfer.status === 'in-progress') {
      transfer.status = 'cancelled';
      this.activeTransfers.delete(transferId);
      this.emit('transfer-cancelled', transferId);
      return true;
    }
    return false;
  }

  /**
   * Get active transfer status
   */
  getTransferStatus(transferId: string): TransferProgress | undefined {
    return this.activeTransfers.get(transferId);
  }

  /**
   * Get all active transfers
   */
  getActiveTransfers(): Map<string, TransferProgress> {
    return new Map(this.activeTransfers);
  }

  // 

  private emitProgress(transferId: string, progress: TransferProgress): void {
    this.emit('transfer-progress', { transferId, ...progress });
  }

  private loadBackupInfo(backupId: string): BackupInfo | null {
    // Search for backup by ID
    const allBackups = this.listBackups();
    return allBackups.find(b => b.id === backupId) || null;
  }

  private buildDirListPayload(device: string): Buffer {
    const command = Buffer.alloc(1);
    command.writeUInt8(FILE_COMMANDS.DIR_LIST, 0);
    
    const deviceBytes = Buffer.from(device + '\0', 'ascii');
    return Buffer.concat([command, deviceBytes]);
  }

  private buildFileInfoPayload(filePath: string): Buffer {
    const command = Buffer.alloc(1);
    command.writeUInt8(FILE_COMMANDS.FILE_INFO, 0);
    
    const pathBytes = Buffer.from(filePath + '\0', 'ascii');
    return Buffer.concat([command, pathBytes]);
  }

  private buildGetFilePayload(filePath: string, offset: number, length: number): Buffer {
    const command = Buffer.alloc(9);
    command.writeUInt8(FILE_COMMANDS.GET_FILE, 0);
    command.writeUInt32LE(offset, 1);
    command.writeUInt32LE(length, 5);
    
    const pathBytes = Buffer.from(filePath + '\0', 'ascii');
    return Buffer.concat([command, pathBytes]);
  }

  private buildSendFileStartPayload(filePath: string, fileSize: number): Buffer {
    const command = Buffer.alloc(5);
    command.writeUInt8(FILE_COMMANDS.SEND_FILE, 0);
    command.writeUInt32LE(fileSize, 1);
    
    const pathBytes = Buffer.from(filePath + '\0', 'ascii');
    return Buffer.concat([command, pathBytes]);
  }

  private buildSendFileChunkPayload(
    filePath: string, 
    offset: number, 
    data: Buffer,
    isLast: boolean
  ): Buffer {
    const header = Buffer.alloc(10);
    header.writeUInt8(FILE_COMMANDS.SEND_FILE, 0);
    header.writeUInt32LE(offset, 1);
    header.writeUInt32LE(data.length, 5);
    header.writeUInt8(isLast ? 1 : 0, 9);
    
    return Buffer.concat([header, data]);
  }

  private buildCloseFilePayload(filePath: string): Buffer {
    const command = Buffer.alloc(1);
    command.writeUInt8(FILE_COMMANDS.CLOSE_FILE, 0);
    
    const pathBytes = Buffer.from(filePath + '\0', 'ascii');
    return Buffer.concat([command, pathBytes]);
  }

  private buildFileCommandPayload(filePath: string, command: number): Buffer {
    const commandByte = Buffer.alloc(1);
    commandByte.writeUInt8(command, 0);
    
    const pathBytes = Buffer.from(filePath + '\0', 'ascii');
    return Buffer.concat([commandByte, pathBytes]);
  }

  private buildStorageInfoPayload(device: string): Buffer {
    // Request Status table for storage info
    const tableNumber = 1; // Public table
    const payload = Buffer.alloc(3);
    payload.writeUInt8(0x05, 0); // Collect mode
    payload.writeUInt16LE(tableNumber, 1);
    return payload;
  }

  private parseDirectoryListing(data: Buffer, device: string): DataloggerFile[] {
    const files: DataloggerFile[] = [];
    let offset = 0;

    while (offset < data.length) {
      // Each file entry: name (null-terminated), size (4 bytes), time (4 bytes), attributes (1 byte)
      const nameEnd = data.indexOf(0, offset);
      if (nameEnd === -1) break;

      const name = data.slice(offset, nameEnd).toString('ascii');
      offset = nameEnd + 1;

      if (offset + 9 > data.length) break;

      const size = data.readUInt32LE(offset);
      offset += 4;

      const timestamp = data.readUInt32LE(offset);
      offset += 4;

      const attrs = data.readUInt8(offset);
      offset += 1;

      files.push({
        name,
        size,
        lastModified: new Date(timestamp * 1000),
        attributes: this.parseFileAttributes(attrs),
        path: `${device}${name}`
      });
    }

    return files;
  }

  private parseFileAttributes(attrs: number): FileAttributes {
    return {
      readOnly: (attrs & 0x01) !== 0,
      hidden: (attrs & 0x02) !== 0,
      system: (attrs & 0x04) !== 0,
      paused: (attrs & 0x08) !== 0,
      runOnPowerUp: (attrs & 0x10) !== 0,
      runNow: (attrs & 0x20) !== 0
    };
  }

  private parseFileInfo(data: Buffer, filePath: string): DataloggerFile {
    const size = data.readUInt32LE(0);
    const timestamp = data.readUInt32LE(4);
    const attrs = data.readUInt8(8);

    return {
      name: path.basename(filePath),
      size,
      lastModified: new Date(timestamp * 1000),
      attributes: this.parseFileAttributes(attrs),
      path: filePath
    };
  }

  private extractFileChunk(data: Buffer): Buffer {
    // First byte is status, rest is file data
    if (data.length < 1) return Buffer.alloc(0);
    
    const status = data.readUInt8(0);
    if (status !== 0) {
      console.warn(`File chunk status: ${status}`);
    }
    
    return data.slice(1);
  }

  private parseStorageInfo(data: Buffer, device: string): StorageInfo {
    // Parse storage info from status table response
    // Format varies by datalogger model
    let totalBytes = 0;
    let freeBytes = 0;

    if (data.length >= 8) {
      totalBytes = data.readUInt32LE(0);
      freeBytes = data.readUInt32LE(4);
    }

    const usedBytes = totalBytes - freeBytes;
    const percentUsed = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

    return {
      device,
      totalBytes,
      usedBytes,
      freeBytes,
      percentUsed
    };
  }
}

export default FileManager;

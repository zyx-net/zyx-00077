import { openDB, IDBPDatabase } from 'idb';
import type {
  Batch,
  ScheduleRecord,
  PunchRecord,
  LeaveRecord,
  Anomaly,
  Correction,
  RuleVersion,
  MatchedRecord,
  AuditLogEntry,
  AuditExportSnapshot,
  Preset,
  Appeal,
  Simulator,
} from '../types';

const DB_NAME = 'attendance-reconciliation-db';
const DB_VERSION = 5;

export interface DBSchema {
  batches: {
    key: string;
    value: Batch;
    indexes: { 'by-createdAt': Date };
  };
  schedules: {
    key: string;
    value: ScheduleRecord;
    indexes: { 'by-batchId': string; 'by-employeeId': string; 'by-date': string };
  };
  punches: {
    key: string;
    value: PunchRecord;
    indexes: { 'by-batchId': string; 'by-employeeId': string; 'by-punchTime': Date };
  };
  leaves: {
    key: string;
    value: LeaveRecord;
    indexes: { 'by-batchId': string; 'by-employeeId': string; 'by-date': string };
  };
  anomalies: {
    key: string;
    value: Anomaly;
    indexes: { 'by-batchId': string; 'by-employeeId': string; 'by-type': string; 'by-status': string };
  };
  corrections: {
    key: string;
    value: Correction;
    indexes: { 'by-batchId': string; 'by-anomalyId': string; 'by-createdAt': Date };
  };
  ruleVersions: {
    key: string;
    value: RuleVersion;
    indexes: { 'by-version': number; 'by-isActive': boolean; 'by-createdAt': Date };
  };
  matchedRecords: {
    key: string;
    value: MatchedRecord;
    indexes: { 'by-batchId': string; 'by-employeeId': string; 'by-date': string };
  };
  auditLogs: {
    key: string;
    value: AuditLogEntry;
    indexes: { 'by-batchId': string; 'by-timestamp': Date; 'by-action': string; 'by-batchId-timestamp': [string, Date] };
  };
  auditExportSnapshots: {
    key: string;
    value: AuditExportSnapshot;
    indexes: { 'by-batchId': string; 'by-timestamp': Date; 'by-exportId': string };
  };
  presets: {
    key: string;
    value: Preset;
    indexes: { 'by-type': string; 'by-name': string; 'by-createdAt': Date; 'by-type-createdAt': [string, Date] };
  };
  appeals: {
    key: string;
    value: Appeal;
    indexes: {
      'by-batchId': string;
      'by-anomalyId': string;
      'by-status': string;
      'by-employeeId': string;
      'by-createdAt': Date;
      'by-batchId-status': [string, string];
      'by-batchId-createdAt': [string, Date];
    };
  };
  simulators: {
    key: string;
    value: Simulator;
    indexes: {
      'by-sourceBatchId': string;
      'by-status': string;
      'by-name': string;
      'by-createdAt': Date;
      'by-createdBy': string;
      'by-sourceBatchId-createdAt': [string, Date];
    };
  };
}

let dbInstance: IDBPDatabase<DBSchema> | null = null;

export const initDB = async (): Promise<IDBPDatabase<DBSchema>> => {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<DBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('batches')) {
        const batchStore = db.createObjectStore('batches', { keyPath: 'id' });
        batchStore.createIndex('by-createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('schedules')) {
        const scheduleStore = db.createObjectStore('schedules', { keyPath: 'id' });
        scheduleStore.createIndex('by-batchId', 'batchId');
        scheduleStore.createIndex('by-employeeId', 'employeeId');
        scheduleStore.createIndex('by-date', 'scheduleDate');
      }

      if (!db.objectStoreNames.contains('punches')) {
        const punchStore = db.createObjectStore('punches', { keyPath: 'id' });
        punchStore.createIndex('by-batchId', 'batchId');
        punchStore.createIndex('by-employeeId', 'employeeId');
        punchStore.createIndex('by-punchTime', 'punchTime');
      }

      if (!db.objectStoreNames.contains('leaves')) {
        const leaveStore = db.createObjectStore('leaves', { keyPath: 'id' });
        leaveStore.createIndex('by-batchId', 'batchId');
        leaveStore.createIndex('by-employeeId', 'employeeId');
        leaveStore.createIndex('by-date', 'leaveDate');
      }

      if (!db.objectStoreNames.contains('anomalies')) {
        const anomalyStore = db.createObjectStore('anomalies', { keyPath: 'id' });
        anomalyStore.createIndex('by-batchId', 'batchId');
        anomalyStore.createIndex('by-employeeId', 'employeeId');
        anomalyStore.createIndex('by-type', 'type');
        anomalyStore.createIndex('by-status', 'status');
      }

      if (!db.objectStoreNames.contains('corrections')) {
        const correctionStore = db.createObjectStore('corrections', { keyPath: 'id' });
        correctionStore.createIndex('by-batchId', 'batchId');
        correctionStore.createIndex('by-anomalyId', 'anomalyId');
        correctionStore.createIndex('by-createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('ruleVersions')) {
        const ruleStore = db.createObjectStore('ruleVersions', { keyPath: 'id' });
        ruleStore.createIndex('by-version', 'version');
        ruleStore.createIndex('by-isActive', 'isActive');
        ruleStore.createIndex('by-createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('matchedRecords')) {
        const matchedStore = db.createObjectStore('matchedRecords', { keyPath: 'id' });
        matchedStore.createIndex('by-batchId', 'batchId');
        matchedStore.createIndex('by-employeeId', 'employeeId');
        matchedStore.createIndex('by-date', 'date');
      }

      if (!db.objectStoreNames.contains('auditLogs')) {
        const auditStore = db.createObjectStore('auditLogs', { keyPath: 'id' });
        auditStore.createIndex('by-batchId', 'batchId');
        auditStore.createIndex('by-timestamp', 'timestamp');
        auditStore.createIndex('by-action', 'action');
        auditStore.createIndex('by-batchId-timestamp', ['batchId', 'timestamp']);
      }

      if (!db.objectStoreNames.contains('auditExportSnapshots')) {
        const snapshotStore = db.createObjectStore('auditExportSnapshots', { keyPath: 'id' });
        snapshotStore.createIndex('by-batchId', 'batchId');
        snapshotStore.createIndex('by-timestamp', 'timestamp');
        snapshotStore.createIndex('by-exportId', 'exportId');
      }

      if (!db.objectStoreNames.contains('presets')) {
        const presetStore = db.createObjectStore('presets', { keyPath: 'id' });
        presetStore.createIndex('by-type', 'type');
        presetStore.createIndex('by-name', 'name');
        presetStore.createIndex('by-createdAt', 'createdAt');
        presetStore.createIndex('by-type-createdAt', ['type', 'createdAt']);
      }

      if (!db.objectStoreNames.contains('appeals')) {
        const appealStore = db.createObjectStore('appeals', { keyPath: 'id' });
        appealStore.createIndex('by-batchId', 'batchId');
        appealStore.createIndex('by-anomalyId', 'anomalyId');
        appealStore.createIndex('by-status', 'status');
        appealStore.createIndex('by-employeeId', 'employeeId');
        appealStore.createIndex('by-createdAt', 'createdAt');
        appealStore.createIndex('by-batchId-status', ['batchId', 'status']);
        appealStore.createIndex('by-batchId-createdAt', ['batchId', 'createdAt']);
      }

      if (!db.objectStoreNames.contains('simulators')) {
        const simulatorStore = db.createObjectStore('simulators', { keyPath: 'id' });
        simulatorStore.createIndex('by-sourceBatchId', 'sourceBatchId');
        simulatorStore.createIndex('by-status', 'status');
        simulatorStore.createIndex('by-name', 'name');
        simulatorStore.createIndex('by-createdAt', 'createdAt');
        simulatorStore.createIndex('by-createdBy', 'createdBy');
        simulatorStore.createIndex('by-sourceBatchId-createdAt', ['sourceBatchId', 'createdAt']);
      }
    },
  });

  return dbInstance;
};

export const getDB = async (): Promise<IDBPDatabase<DBSchema>> => {
  if (!dbInstance) {
    return initDB();
  }
  return dbInstance;
};

export const closeDB = (): void => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
};

export const clearDB = async (): Promise<void> => {
  const db = await getDB();
  const storeNames: string[] = [];
  for (let i = 0; i < db.objectStoreNames.length; i++) {
    const name = db.objectStoreNames[i];
    if (name) storeNames.push(name);
  }
  if (storeNames.length === 0) return;
  const tx = db.transaction(storeNames, 'readwrite');
  await Promise.all(
    storeNames.map(storeName => tx.objectStore(storeName).clear())
  );
  await tx.done;
};

export const batchOperations = {
  async getAll(): Promise<Batch[]> {
    const db = await getDB();
    return db.getAllFromIndex('batches', 'by-createdAt');
  },

  async getById(id: string): Promise<Batch | undefined> {
    const db = await getDB();
    return db.get('batches', id);
  },

  async add(batch: Batch): Promise<string> {
    const db = await getDB();
    return db.add('batches', batch) as Promise<string>;
  },

  async update(batch: Batch): Promise<string> {
    const db = await getDB();
    return db.put('batches', batch) as Promise<string>;
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction(['batches', 'schedules', 'punches', 'leaves', 'anomalies', 'corrections', 'matchedRecords', 'auditLogs', 'auditExportSnapshots', 'appeals', 'simulators'], 'readwrite');
    
    await tx.objectStore('batches').delete(id);
    
    let scheduleCursor = await tx.objectStore('schedules').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (scheduleCursor) {
      await scheduleCursor.delete();
      scheduleCursor = await scheduleCursor.continue();
    }
    
    let punchCursor = await tx.objectStore('punches').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (punchCursor) {
      await punchCursor.delete();
      punchCursor = await punchCursor.continue();
    }
    
    let leaveCursor = await tx.objectStore('leaves').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (leaveCursor) {
      await leaveCursor.delete();
      leaveCursor = await leaveCursor.continue();
    }
    
    let anomalyCursor = await tx.objectStore('anomalies').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (anomalyCursor) {
      await anomalyCursor.delete();
      anomalyCursor = await anomalyCursor.continue();
    }
    
    let correctionCursor = await tx.objectStore('corrections').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (correctionCursor) {
      await correctionCursor.delete();
      correctionCursor = await correctionCursor.continue();
    }
    
    let matchedCursor = await tx.objectStore('matchedRecords').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (matchedCursor) {
      await matchedCursor.delete();
      matchedCursor = await matchedCursor.continue();
    }
    
    let auditCursor = await tx.objectStore('auditLogs').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (auditCursor) {
      await auditCursor.delete();
      auditCursor = await auditCursor.continue();
    }
    
    let snapshotCursor = await tx.objectStore('auditExportSnapshots').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (snapshotCursor) {
      await snapshotCursor.delete();
      snapshotCursor = await snapshotCursor.continue();
    }
    
    let appealCursor = await tx.objectStore('appeals').index('by-batchId').openCursor(IDBKeyRange.only(id));
    while (appealCursor) {
      await appealCursor.delete();
      appealCursor = await appealCursor.continue();
    }
    
    let simulatorCursor = await tx.objectStore('simulators').index('by-sourceBatchId').openCursor(IDBKeyRange.only(id));
    while (simulatorCursor) {
      await simulatorCursor.delete();
      simulatorCursor = await simulatorCursor.continue();
    }
    
    await tx.done;
  },
};

export const scheduleOperations = {
  async getByBatchId(batchId: string): Promise<ScheduleRecord[]> {
    const db = await getDB();
    return db.getAllFromIndex('schedules', 'by-batchId', batchId);
  },

  async addMany(schedules: ScheduleRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('schedules', 'readwrite');
    await Promise.all(schedules.map(s => tx.store.add(s)));
    await tx.done;
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('schedules', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const punchOperations = {
  async getByBatchId(batchId: string): Promise<PunchRecord[]> {
    const db = await getDB();
    return db.getAllFromIndex('punches', 'by-batchId', batchId);
  },

  async addMany(punches: PunchRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('punches', 'readwrite');
    await Promise.all(punches.map(p => tx.store.add(p)));
    await tx.done;
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('punches', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const leaveOperations = {
  async getByBatchId(batchId: string): Promise<LeaveRecord[]> {
    const db = await getDB();
    return db.getAllFromIndex('leaves', 'by-batchId', batchId);
  },

  async addMany(leaves: LeaveRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('leaves', 'readwrite');
    await Promise.all(leaves.map(l => tx.store.add(l)));
    await tx.done;
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('leaves', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const anomalyOperations = {
  async getByBatchId(batchId: string): Promise<Anomaly[]> {
    const db = await getDB();
    return db.getAllFromIndex('anomalies', 'by-batchId', batchId);
  },

  async getById(id: string): Promise<Anomaly | undefined> {
    const db = await getDB();
    return db.get('anomalies', id);
  },

  async add(anomaly: Anomaly): Promise<string> {
    const db = await getDB();
    return db.add('anomalies', anomaly) as Promise<string>;
  },

  async addMany(anomalies: Anomaly[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('anomalies', 'readwrite');
    await Promise.all(anomalies.map(a => tx.store.add(a)));
    await tx.done;
  },

  async update(anomaly: Anomaly): Promise<string> {
    const db = await getDB();
    return db.put('anomalies', anomaly) as Promise<string>;
  },

  async updateMany(anomalies: Anomaly[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('anomalies', 'readwrite');
    await Promise.all(anomalies.map(a => tx.store.put(a)));
    await tx.done;
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('anomalies', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const correctionOperations = {
  async getByBatchId(batchId: string): Promise<Correction[]> {
    const db = await getDB();
    return db.getAllFromIndex('corrections', 'by-batchId', batchId);
  },

  async getByAnomalyId(anomalyId: string): Promise<Correction[]> {
    const db = await getDB();
    return db.getAllFromIndex('corrections', 'by-anomalyId', anomalyId);
  },

  async getById(id: string): Promise<Correction | undefined> {
    const db = await getDB();
    return db.get('corrections', id);
  },

  async add(correction: Correction): Promise<string> {
    const db = await getDB();
    return db.add('corrections', correction) as Promise<string>;
  },

  async addMany(corrections: Correction[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('corrections', 'readwrite');
    await Promise.all(corrections.map(c => tx.store.add(c)));
    await tx.done;
  },
};

export const ruleVersionOperations = {
  async getAll(): Promise<RuleVersion[]> {
    const db = await getDB();
    return db.getAllFromIndex('ruleVersions', 'by-createdAt');
  },

  async getById(id: string): Promise<RuleVersion | undefined> {
    const db = await getDB();
    return db.get('ruleVersions', id);
  },

  async getActive(): Promise<RuleVersion | undefined> {
    const db = await getDB();
    const allVersions = await db.getAll('ruleVersions');
    return allVersions.find(v => v.isActive);
  },

  async add(version: RuleVersion): Promise<string> {
    const db = await getDB();
    return db.add('ruleVersions', version) as Promise<string>;
  },

  async update(version: RuleVersion): Promise<string> {
    const db = await getDB();
    return db.put('ruleVersions', version) as Promise<string>;
  },

  async setActive(versionId: string): Promise<void> {
    const db = await getDB();
    const allVersions = await ruleVersionOperations.getAll();
    const tx = db.transaction('ruleVersions', 'readwrite');
    
    await Promise.all(
      allVersions.map(v => {
        v.isActive = v.id === versionId;
        return tx.store.put(v);
      })
    );
    
    await tx.done;
  },

  async getMaxVersion(): Promise<number> {
    const versions = await ruleVersionOperations.getAll();
    if (versions.length === 0) return 0;
    return Math.max(...versions.map(v => v.version));
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('ruleVersions', id);
  },
};

export const matchedRecordOperations = {
  async getByBatchId(batchId: string): Promise<MatchedRecord[]> {
    const db = await getDB();
    return db.getAllFromIndex('matchedRecords', 'by-batchId', batchId);
  },

  async addMany(records: MatchedRecord[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('matchedRecords', 'readwrite');
    await Promise.all(records.map(r => tx.store.add(r)));
    await tx.done;
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('matchedRecords', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const auditLogOperations = {
  async getByBatchId(batchId: string): Promise<AuditLogEntry[]> {
    const db = await getDB();
    const logs = await db.getAllFromIndex('auditLogs', 'by-batchId', batchId);
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  async getByBatchIdAndAction(batchId: string, action: string): Promise<AuditLogEntry[]> {
    const db = await getDB();
    const allLogs = await db.getAllFromIndex('auditLogs', 'by-batchId', batchId);
    return allLogs
      .filter(log => log.action === action)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  async getById(id: string): Promise<AuditLogEntry | undefined> {
    const db = await getDB();
    return db.get('auditLogs', id);
  },

  async add(log: AuditLogEntry): Promise<string> {
    const db = await getDB();
    return db.add('auditLogs', log) as Promise<string>;
  },

  async addMany(logs: AuditLogEntry[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('auditLogs', 'readwrite');
    await Promise.all(logs.map(l => tx.store.add(l)));
    await tx.done;
  },

  async getLatestStatsVersion(batchId: string): Promise<number> {
    const logs = await auditLogOperations.getByBatchId(batchId);
    if (logs.length === 0) return 0;
    return Math.max(...logs.map(l => l.statsVersion || 0));
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('auditLogs', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const auditExportSnapshotOperations = {
  async getByBatchId(batchId: string): Promise<AuditExportSnapshot[]> {
    const db = await getDB();
    const snapshots = await db.getAllFromIndex('auditExportSnapshots', 'by-batchId', batchId);
    return snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  async getById(id: string): Promise<AuditExportSnapshot | undefined> {
    const db = await getDB();
    return db.get('auditExportSnapshots', id);
  },

  async getByExportId(exportId: string): Promise<AuditExportSnapshot | undefined> {
    const db = await getDB();
    const snapshots = await db.getAllFromIndex('auditExportSnapshots', 'by-exportId', exportId);
    return snapshots[0];
  },

  async add(snapshot: AuditExportSnapshot): Promise<string> {
    const db = await getDB();
    return db.add('auditExportSnapshots', snapshot) as Promise<string>;
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('auditExportSnapshots', id);
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('auditExportSnapshots', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },
};

export const presetOperations = {
  async getAll(): Promise<Preset[]> {
    const db = await getDB();
    return db.getAllFromIndex('presets', 'by-createdAt');
  },

  async getByType(type: string): Promise<Preset[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex('presets', 'by-type', type);
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getById(id: string): Promise<Preset | undefined> {
    const db = await getDB();
    return db.get('presets', id);
  },

  async getByName(name: string, type?: string): Promise<Preset | undefined> {
    const db = await getDB();
    const all = await db.getAllFromIndex('presets', 'by-name', name);
    if (type) {
      return all.find(p => p.type === type);
    }
    return all[0];
  },

  async add(preset: Preset): Promise<string> {
    const db = await getDB();
    return db.add('presets', preset) as Promise<string>;
  },

  async update(preset: Preset): Promise<string> {
    const db = await getDB();
    return db.put('presets', preset) as Promise<string>;
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('presets', id);
  },

  async clear(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('presets', 'readwrite');
    await tx.store.clear();
    await tx.done;
  },

  async addMany(presets: Preset[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('presets', 'readwrite');
    await Promise.all(presets.map(p => tx.store.put(p)));
    await tx.done;
  },
};

export const appealOperations = {
  async getAll(): Promise<Appeal[]> {
    const db = await getDB();
    return db.getAllFromIndex('appeals', 'by-createdAt');
  },

  async getByBatchId(batchId: string): Promise<Appeal[]> {
    const db = await getDB();
    const appeals = await db.getAllFromIndex('appeals', 'by-batchId', batchId);
    return appeals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getByBatchIdAndStatus(batchId: string, status: string): Promise<Appeal[]> {
    const db = await getDB();
    const appeals = await db.getAllFromIndex('appeals', 'by-batchId-status', [batchId, status]);
    return appeals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getByAnomalyId(anomalyId: string): Promise<Appeal[]> {
    const db = await getDB();
    return db.getAllFromIndex('appeals', 'by-anomalyId', anomalyId);
  },

  async getPendingByAnomalyId(anomalyId: string): Promise<Appeal | undefined> {
    const db = await getDB();
    const appeals = await db.getAllFromIndex('appeals', 'by-anomalyId', anomalyId);
    return appeals.find(a => a.status === 'pending');
  },

  async getById(id: string): Promise<Appeal | undefined> {
    const db = await getDB();
    return db.get('appeals', id);
  },

  async add(appeal: Appeal): Promise<string> {
    const db = await getDB();
    return db.add('appeals', appeal) as Promise<string>;
  },

  async update(appeal: Appeal): Promise<string> {
    const db = await getDB();
    return db.put('appeals', appeal) as Promise<string>;
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('appeals', id);
  },

  async clearByBatchId(batchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('appeals', 'readwrite');
    let cursor = await tx.store.index('by-batchId').openCursor(IDBKeyRange.only(batchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },

  async addMany(appeals: Appeal[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('appeals', 'readwrite');
    await Promise.all(appeals.map(a => tx.store.add(a)));
    await tx.done;
  },
};

export const simulatorOperations = {
  async getAll(): Promise<Simulator[]> {
    const db = await getDB();
    return db.getAllFromIndex('simulators', 'by-createdAt');
  },

  async getBySourceBatchId(sourceBatchId: string): Promise<Simulator[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex('simulators', 'by-sourceBatchId', sourceBatchId);
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getById(id: string): Promise<Simulator | undefined> {
    const db = await getDB();
    return db.get('simulators', id);
  },

  async getByName(name: string, sourceBatchId?: string): Promise<Simulator | undefined> {
    const db = await getDB();
    const all = await db.getAllFromIndex('simulators', 'by-name', name);
    if (sourceBatchId) {
      return all.find(s => s.sourceBatchId === sourceBatchId);
    }
    return all[0];
  },

  async getByStatus(status: string): Promise<Simulator[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex('simulators', 'by-status', status);
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getByCreatedBy(createdBy: string): Promise<Simulator[]> {
    const db = await getDB();
    const all = await db.getAllFromIndex('simulators', 'by-createdBy', createdBy);
    return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async add(simulator: Simulator): Promise<string> {
    const db = await getDB();
    return db.add('simulators', simulator) as Promise<string>;
  },

  async addMany(simulators: Simulator[]): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('simulators', 'readwrite');
    await Promise.all(simulators.map(s => tx.store.put(s)));
    await tx.done;
  },

  async update(simulator: Simulator): Promise<string> {
    const db = await getDB();
    return db.put('simulators', simulator) as Promise<string>;
  },

  async delete(id: string): Promise<void> {
    const db = await getDB();
    await db.delete('simulators', id);
  },

  async clearBySourceBatchId(sourceBatchId: string): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('simulators', 'readwrite');
    let cursor = await tx.store.index('by-sourceBatchId').openCursor(IDBKeyRange.only(sourceBatchId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },

  async clear(): Promise<void> {
    const db = await getDB();
    const tx = db.transaction('simulators', 'readwrite');
    await tx.store.clear();
    await tx.done;
  },
};

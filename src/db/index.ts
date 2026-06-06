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
} from '../types';

const DB_NAME = 'attendance-reconciliation-db';
const DB_VERSION = 1;

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
    const tx = db.transaction(['batches', 'schedules', 'punches', 'leaves', 'anomalies', 'corrections', 'matchedRecords'], 'readwrite');
    
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

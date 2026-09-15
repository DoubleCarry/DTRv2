import bcrypt from 'bcryptjs';

export const inMemoryUsers = new Map();
export const inMemoryOJTs = new Map();
export const inMemoryDTRs = new Map();
export const inMemoryAuditLogs = new Map();
export const inMemoryHolidays = new Map();
export const inMemoryResetTokens = new Map();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function makeDoc(obj, map) {
  if (!obj) return null;
  const doc = { ...obj };
  doc.lean = function() {
    const copy = { ...this };
    delete copy.lean;
    delete copy.save;
    return copy;
  };
  doc.save = async function() {
    this.updatedAt = new Date().toISOString();
    map.set(String(this._id), { ...this });
    return this;
  };
  return doc;
}

function wrapQuery(promise) {
  promise.lean = () => promise.then(doc => (doc && typeof doc.lean === 'function' ? doc.lean() : doc));
  return promise;
}

function wrapListQuery(promise) {
  promise.sort = (sortObj) => wrapListQuery(promise.then(list => {
    return [...list].sort((a, b) => {
      for (const key of Object.keys(sortObj)) {
        const order = sortObj[key];
        const valA = a[key] ?? '';
        const valB = b[key] ?? '';
        if (valA !== valB) {
          return order > 0 ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
        }
      }
      return 0;
    });
  }));
  promise.limit = (n) => wrapListQuery(promise.then(list => list.slice(0, n)));
  promise.lean = () => promise.then(list => list.map(d => (d && typeof d.lean === 'function' ? d.lean() : d)));
  return promise;
}

export function seedInMemoryStore() {
  if (inMemoryUsers.size > 0) return;

  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const adminUser = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const adminName = process.env.ADMIN_NAME || 'System Administrator';

  // Seed Admin
  const adminId = 'u_admin';
  inMemoryUsers.set(adminId, {
    _id: adminId,
    username: adminUser,
    email: 'admin@dtr.local',
    name: adminName,
    passwordHash: bcrypt.hashSync(adminPass, 10),
    role: 'admin',
    studentId: 'ADM-001',
    school: 'University Administration',
    course: 'Academic Oversight',
    company: 'DTR Management Dept',
    department: 'OJT Coordination',
    supervisor: 'Dean of Student Affairs',
    isEmailVerified: true,
    settings: {
      dailyHours: 8,
      useFixedSchedule: true,
      scheduleMode: 'simple',
      scheduleStart: '08:00',
      scheduleEnd: '17:00',
      earlyArrivalCountsAsOvertime: false,
      workingDays: [1, 2, 3, 4, 5],
      lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
      showCharts: true,
      reportNotes: 'Certified accurate and in accordance with institutional guidelines.',
      signatureMode: 'blank',
      signatureData: '',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed User: John Reyes
  const johnId = 'u_john';
  inMemoryUsers.set(johnId, {
    _id: johnId,
    username: 'john',
    email: 'john.reyes@univ.edu.ph',
    name: 'John Reyes',
    passwordHash: bcrypt.hashSync('pass123', 10),
    role: 'user',
    studentId: '2022-04912',
    school: 'Technological University of the Philippines',
    course: 'BS Information Technology',
    company: 'Acme Software Solutions Inc.',
    department: 'Web Engineering & DevOps',
    supervisor: 'Engr. Roberto Santos',
    isEmailVerified: true,
    settings: {
      dailyHours: 8,
      useFixedSchedule: true,
      scheduleMode: 'simple',
      scheduleStart: '08:00',
      scheduleEnd: '17:00',
      earlyArrivalCountsAsOvertime: false,
      workingDays: [1, 2, 3, 4, 5],
      lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
      showCharts: true,
      reportNotes: 'All internship hours completed on-site under direct supervision.',
      signatureMode: 'blank',
      signatureData: '',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed John's OJTs
  const johnOjt1 = 'ojt_john_1';
  inMemoryOJTs.set(johnOjt1, {
    _id: johnOjt1,
    userId: johnId,
    name: 'OJT 1 - Web Development Practicum',
    targetHours: 300,
    startDate: '2026-08-01',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const johnOjt2 = 'ojt_john_2';
  inMemoryOJTs.set(johnOjt2, {
    _id: johnOjt2,
    userId: johnId,
    name: 'OJT 2 - Advanced Systems Integration',
    targetHours: 200,
    startDate: '2026-10-01',
    status: 'ARCHIVED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed User: Maria Santos
  const mariaId = 'u_maria';
  inMemoryUsers.set(mariaId, {
    _id: mariaId,
    username: 'maria',
    email: 'maria.santos@univ.edu.ph',
    name: 'Maria Santos',
    passwordHash: bcrypt.hashSync('pass123', 10),
    role: 'user',
    studentId: '2022-08119',
    school: 'Polytechnic University',
    course: 'BS Computer Science',
    company: 'CloudWorks Tech Labs',
    department: 'Quality Assurance',
    supervisor: 'Ms. Carmela Diaz',
    isEmailVerified: true,
    settings: {
      dailyHours: 8,
      useFixedSchedule: true,
      scheduleMode: 'simple',
      scheduleStart: '08:30',
      scheduleEnd: '17:30',
      earlyArrivalCountsAsOvertime: false,
      workingDays: [1, 2, 3, 4, 5],
      lunchBreak: { enabled: true, start: '12:00', end: '13:00' },
      showCharts: true,
      reportNotes: '',
      signatureMode: 'blank',
      signatureData: '',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const mariaOjt1 = 'ojt_maria_1';
  inMemoryOJTs.set(mariaOjt1, {
    _id: mariaOjt1,
    userId: mariaId,
    name: 'OJT 1 - Software Testing & QA',
    targetHours: 300,
    startDate: '2026-08-15',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed sample DTR records for John (with multiple entries per day and overnight shift!)
  const sampleRecords = [
    {
      userId: johnId,
      ojtRequirementId: johnOjt1,
      workDate: '2026-09-07',
      timeIn: '08:00',
      timeOut: '12:00',
      note: 'Morning backend refactoring session',
    },
    {
      userId: johnId,
      ojtRequirementId: johnOjt1,
      workDate: '2026-09-07',
      timeIn: '13:00',
      timeOut: '17:00',
      note: 'API unit testing & documentation',
    },
    {
      userId: johnId,
      ojtRequirementId: johnOjt1,
      workDate: '2026-09-08',
      timeIn: '08:00',
      timeOut: '18:00',
      note: 'Sprint deployment with 1h overtime',
    },
    {
      userId: johnId,
      ojtRequirementId: johnOjt1,
      workDate: '2026-09-09',
      timeIn: '08:15',
      timeOut: '17:00',
      note: 'Late arrival due to traffic',
    },
    {
      userId: johnId,
      ojtRequirementId: johnOjt1,
      workDate: '2026-09-10',
      timeIn: '08:00',
      timeOut: '16:00',
      note: 'Undertime scheduled exit for university seminar',
    },
    {
      userId: johnId,
      ojtRequirementId: johnOjt1,
      workDate: '2026-09-11',
      timeIn: '22:00',
      timeOut: '06:00',
      note: 'Overnight systems maintenance shift',
    },
  ];

  for (const r of sampleRecords) {
    const id = generateId();
    inMemoryDTRs.set(id, {
      _id: id,
      userId: r.userId,
      ojtRequirementId: r.ojtRequirementId,
      workDate: r.workDate,
      timeIn: r.timeIn,
      timeOut: r.timeOut,
      note: r.note,
      source: 'manual',
      createdBy: r.userId,
      updatedBy: r.userId,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Seed Maria sample records
  const mariaRecords = [
    {
      userId: mariaId,
      ojtRequirementId: mariaOjt1,
      workDate: '2026-09-08',
      timeIn: '08:30',
      timeOut: '17:30',
      note: 'Test case execution for v2 release',
    },
    {
      userId: mariaId,
      ojtRequirementId: mariaOjt1,
      workDate: '2026-09-09',
      timeIn: '08:30',
      timeOut: '18:30',
      note: 'Overtime test automation scripting',
    },
  ];

  for (const r of mariaRecords) {
    const id = generateId();
    inMemoryDTRs.set(id, {
      _id: id,
      userId: r.userId,
      ojtRequirementId: r.ojtRequirementId,
      workDate: r.workDate,
      timeIn: r.timeIn,
      timeOut: r.timeOut,
      note: r.note,
      source: 'manual',
      createdBy: r.userId,
      updatedBy: r.userId,
      deletedAt: null,
      deletedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  // Seed initial audit log
  const auditId = generateId();
  inMemoryAuditLogs.set(auditId, {
    _id: auditId,
    userId: adminId,
    performedBy: adminId,
    performedByRole: 'admin',
    action: 'SYSTEM_BOOT',
    details: { message: 'DTR in-memory service initialized and verified' },
    createdAt: new Date().toISOString(),
  });
}

export const InMemoryUser = {
  find(query = {}) {
    return wrapListQuery(Promise.resolve().then(() => {
      const list = [];
      for (const u of inMemoryUsers.values()) {
        let match = true;
        if (query.role && u.role !== query.role) match = false;
        if (match) list.push(makeDoc(u, inMemoryUsers));
      }
      return list;
    }));
  },

  findOne(query) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const u of inMemoryUsers.values()) {
        let match = true;
        if (query.username && u.username !== query.username) match = false;
        if (query.email && u.email !== query.email) match = false;
        if (query.$or) {
          const orMatch = query.$or.some(sub => {
            if (sub.username && u.username === sub.username) return true;
            if (sub.email && u.email === sub.email) return true;
            return false;
          });
          if (!orMatch) match = false;
        }
        if (query._id && String(u._id) !== String(query._id)) {
          if (query._id.$ne && String(u._id) === String(query._id.$ne)) match = false;
          else if (!query._id.$ne) match = false;
        }
        if (match) return makeDoc(u, inMemoryUsers);
      }
      return null;
    }));
  },

  findById(id) {
    return wrapQuery(Promise.resolve().then(() => {
      const u = inMemoryUsers.get(String(id));
      return makeDoc(u, inMemoryUsers);
    }));
  },

  create(data) {
    return Promise.resolve().then(() => {
      const id = data._id || generateId();
      const user = {
        _id: id,
        username: String(data.username || '').toLowerCase().trim(),
        email: String(data.email || '').toLowerCase().trim(),
        name: String(data.name || '').trim(),
        passwordHash: data.passwordHash,
        role: data.role || 'user',
        studentId: data.studentId || '',
        school: data.school || '',
        course: data.course || '',
        company: data.company || '',
        department: data.department || '',
        supervisor: data.supervisor || '',
        isEmailVerified: Boolean(data.isEmailVerified),
        settings: {
          dailyHours: Number(data.settings?.dailyHours ?? data.dailyHours ?? 8),
          useFixedSchedule: Boolean(data.settings?.useFixedSchedule ?? false),
          scheduleMode: data.settings?.scheduleMode || 'simple',
          scheduleStart: data.settings?.scheduleStart || data.scheduleStart || '08:00',
          scheduleEnd: data.settings?.scheduleEnd || data.scheduleEnd || '17:00',
          earlyArrivalCountsAsOvertime: Boolean(data.settings?.earlyArrivalCountsAsOvertime ?? false),
          workingDays: Array.isArray(data.settings?.workingDays) ? data.settings.workingDays : [1, 2, 3, 4, 5],
          lunchBreak: data.settings?.lunchBreak || data.lunchBreak || { enabled: true, start: '12:00', end: '13:00' },
          showCharts: data.settings?.showCharts !== false,
          reportNotes: data.settings?.reportNotes || '',
          signatureMode: data.settings?.signatureMode || 'blank',
          signatureData: data.settings?.signatureData || '',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      inMemoryUsers.set(id, user);
      return makeDoc(user, inMemoryUsers);
    });
  },

  updateOne(query, update) {
    return Promise.resolve().then(() => {
      for (const [id, u] of inMemoryUsers.entries()) {
        if (query._id && String(u._id) === String(query._id)) {
          const updated = { ...u, ...update, updatedAt: new Date().toISOString() };
          inMemoryUsers.set(id, updated);
          return { acknowledged: true, modifiedCount: 1 };
        }
      }
      return { acknowledged: true, modifiedCount: 0 };
    });
  },

  findByIdAndUpdate(id, update, options = {}) {
    return wrapQuery(Promise.resolve().then(() => {
      const u = inMemoryUsers.get(String(id));
      if (!u) return null;
      let newSettings = u.settings;
      if (update.settings) {
        newSettings = { ...u.settings, ...update.settings };
      }
      const updated = {
        ...u,
        ...update,
        settings: newSettings,
        updatedAt: new Date().toISOString(),
      };
      inMemoryUsers.set(String(id), updated);
      return makeDoc(updated, inMemoryUsers);
    }));
  },

  findByIdAndDelete(id) {
    return wrapQuery(Promise.resolve().then(() => {
      const u = inMemoryUsers.get(String(id));
      if (u) {
        inMemoryUsers.delete(String(id));
        return makeDoc(u, inMemoryUsers);
      }
      return null;
    }));
  },
};

export const InMemoryOJTRequirement = {
  find(query = {}) {
    return wrapListQuery(Promise.resolve().then(() => {
      const list = [];
      for (const o of inMemoryOJTs.values()) {
        let match = true;
        if (query.userId && String(o.userId) !== String(query.userId)) match = false;
        if (query.status && o.status !== query.status) match = false;
        if (match) list.push(makeDoc(o, inMemoryOJTs));
      }
      return list;
    }));
  },

  findOne(query) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const o of inMemoryOJTs.values()) {
        let match = true;
        if (query._id && String(o._id) !== String(query._id)) match = false;
        if (query.userId && String(o.userId) !== String(query.userId)) match = false;
        if (match) return makeDoc(o, inMemoryOJTs);
      }
      return null;
    }));
  },

  findById(id) {
    return wrapQuery(Promise.resolve().then(() => {
      const o = inMemoryOJTs.get(String(id));
      return makeDoc(o, inMemoryOJTs);
    }));
  },

  create(data) {
    return Promise.resolve().then(() => {
      const id = data._id || generateId();
      const ojt = {
        _id: id,
        userId: String(data.userId),
        name: String(data.name || 'OJT Requirement').trim(),
        targetHours: Number(data.targetHours || 300),
        startDate: String(data.startDate || new Date().toISOString().slice(0, 10)),
        status: data.status || 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      inMemoryOJTs.set(id, ojt);
      return makeDoc(ojt, inMemoryOJTs);
    });
  },

  findOneAndUpdate(query, update, options = {}) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const [id, o] of inMemoryOJTs.entries()) {
        if (String(o._id) === String(query._id)) {
          if (query.userId && String(o.userId) !== String(query.userId)) continue;
          const updated = { ...o, ...update, updatedAt: new Date().toISOString() };
          inMemoryOJTs.set(id, updated);
          return makeDoc(updated, inMemoryOJTs);
        }
      }
      return null;
    }));
  },

  findOneAndDelete(query) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const [id, o] of inMemoryOJTs.entries()) {
        if (String(o._id) === String(query._id)) {
          if (query.userId && String(o.userId) !== String(query.userId)) continue;
          inMemoryOJTs.delete(id);
          return makeDoc(o, inMemoryOJTs);
        }
      }
      return null;
    }));
  },
};

export const InMemoryDTRRecord = {
  find(query = {}) {
    return wrapListQuery(Promise.resolve().then(() => {
      const list = [];
      for (const r of inMemoryDTRs.values()) {
        let match = true;
        if (query.userId && String(r.userId) !== String(query.userId)) match = false;
        if (query.ojtRequirementId && String(r.ojtRequirementId) !== String(query.ojtRequirementId)) match = false;
        if (query.deletedAt === null && r.deletedAt !== null) match = false;
        if (query.workDate && r.workDate !== query.workDate) match = false;
        if (query.startDate && r.workDate < query.startDate) match = false;
        if (query.endDate && r.workDate > query.endDate) match = false;
        if (match) list.push(makeDoc(r, inMemoryDTRs));
      }
      return list;
    }));
  },

  findOne(query) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const r of inMemoryDTRs.values()) {
        let match = true;
        if (query._id && String(r._id) !== String(query._id)) match = false;
        if (query.userId && String(r.userId) !== String(query.userId)) match = false;
        if (query.deletedAt === null && r.deletedAt !== null) match = false;
        if (match) return makeDoc(r, inMemoryDTRs);
      }
      return null;
    }));
  },

  findById(id) {
    return wrapQuery(Promise.resolve().then(() => {
      const r = inMemoryDTRs.get(String(id));
      return makeDoc(r, inMemoryDTRs);
    }));
  },

  create(data) {
    return Promise.resolve().then(() => {
      const id = data._id || generateId();
      const record = {
        _id: id,
        userId: String(data.userId),
        ojtRequirementId: String(data.ojtRequirementId),
        workDate: String(data.workDate),
        timeIn: String(data.timeIn || '--'),
        timeOut: String(data.timeOut || '--'),
        hours: Number(data.hours || 0),
        regularHours: Number(data.regularHours || 0),
        overtimeHours: Number(data.overtimeHours || 0),
        lateMinutes: Number(data.lateMinutes || 0),
        undertimeMinutes: Number(data.undertimeMinutes || 0),
        note: String(data.note || ''),
        source: data.source || 'manual',
        createdBy: String(data.createdBy || data.userId),
        updatedBy: String(data.updatedBy || data.userId),
        deletedAt: data.deletedAt || null,
        deletedBy: data.deletedBy || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      inMemoryDTRs.set(id, record);
      return makeDoc(record, inMemoryDTRs);
    });
  },

  insertMany(docs) {
    return Promise.resolve().then(() => {
      const created = [];
      for (const data of docs) {
        const id = data._id || generateId();
        const record = {
          _id: id,
          userId: String(data.userId),
          ojtRequirementId: String(data.ojtRequirementId),
          workDate: String(data.workDate),
          timeIn: String(data.timeIn || '--'),
          timeOut: String(data.timeOut || '--'),
          hours: Number(data.hours || 0),
          regularHours: Number(data.regularHours || 0),
          overtimeHours: Number(data.overtimeHours || 0),
          lateMinutes: Number(data.lateMinutes || 0),
          undertimeMinutes: Number(data.undertimeMinutes || 0),
          note: String(data.note || ''),
          source: data.source || 'import',
          createdBy: String(data.createdBy || data.userId),
          updatedBy: String(data.updatedBy || data.userId),
          deletedAt: null,
          deletedBy: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        inMemoryDTRs.set(id, record);
        created.push(makeDoc(record, inMemoryDTRs));
      }
      return created;
    });
  },

  findOneAndUpdate(query, update, options = {}) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const [id, r] of inMemoryDTRs.entries()) {
        if (String(r._id) === String(query._id)) {
          if (query.userId && String(r.userId) !== String(query.userId)) continue;
          if (query.deletedAt === null && r.deletedAt !== null) continue;
          const updated = { ...r, ...update, updatedAt: new Date().toISOString() };
          inMemoryDTRs.set(id, updated);
          return makeDoc(updated, inMemoryDTRs);
        }
      }
      return null;
    }));
  },

  deleteMany(query) {
    return Promise.resolve().then(() => {
      let count = 0;
      for (const [id, r] of inMemoryDTRs.entries()) {
        if (query.userId && String(r.userId) === String(query.userId)) {
          inMemoryDTRs.delete(id);
          count++;
        }
      }
      return { acknowledged: true, deletedCount: count };
    });
  },
};

export const InMemoryAuditLog = {
  find(query = {}) {
    return wrapListQuery(Promise.resolve().then(() => {
      const list = [];
      for (const a of inMemoryAuditLogs.values()) {
        let match = true;
        if (query.userId && String(a.userId) !== String(query.userId)) match = false;
        if (query.performedBy && String(a.performedBy) !== String(query.performedBy)) match = false;
        if (match) list.push(makeDoc(a, inMemoryAuditLogs));
      }
      return list;
    }));
  },

  create(data) {
    return Promise.resolve().then(() => {
      const id = generateId();
      const log = {
        _id: id,
        userId: data.userId ? String(data.userId) : null,
        performedBy: String(data.performedBy),
        performedByRole: data.performedByRole || 'user',
        action: String(data.action),
        details: data.details || {},
        createdAt: new Date().toISOString(),
      };
      inMemoryAuditLogs.set(id, log);
      return makeDoc(log, inMemoryAuditLogs);
    });
  },
};

export const InMemoryHoliday = {
  find(query = {}) {
    return wrapListQuery(Promise.resolve().then(() => {
      const list = [];
      for (const h of inMemoryHolidays.values()) {
        let match = true;
        if (query.userId !== undefined && String(h.userId) !== String(query.userId)) match = false;
        if (match) list.push(makeDoc(h, inMemoryHolidays));
      }
      return list;
    }));
  },

  create(data) {
    return Promise.resolve().then(() => {
      const id = generateId();
      const holiday = {
        _id: id,
        userId: data.userId ? String(data.userId) : null,
        date: String(data.date),
        name: String(data.name),
        type: data.type || 'custom',
        createdAt: new Date().toISOString(),
      };
      inMemoryHolidays.set(id, holiday);
      return makeDoc(holiday, inMemoryHolidays);
    });
  },

  findOneAndDelete(query) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const [id, h] of inMemoryHolidays.entries()) {
        if (String(h._id) === String(query._id)) {
          inMemoryHolidays.delete(id);
          return makeDoc(h, inMemoryHolidays);
        }
      }
      return null;
    }));
  },
};

export const InMemoryPasswordResetToken = {
  findOne(query) {
    return wrapQuery(Promise.resolve().then(() => {
      for (const t of inMemoryResetTokens.values()) {
        let match = true;
        if (query.token && t.token !== query.token) match = false;
        if (query.used !== undefined && t.used !== query.used) match = false;
        if (match) return makeDoc(t, inMemoryResetTokens);
      }
      return null;
    }));
  },

  create(data) {
    return Promise.resolve().then(() => {
      const id = generateId();
      const record = {
        _id: id,
        userId: String(data.userId),
        token: String(data.token),
        expiresAt: data.expiresAt,
        used: Boolean(data.used),
        createdAt: new Date().toISOString(),
      };
      inMemoryResetTokens.set(id, record);
      return makeDoc(record, inMemoryResetTokens);
    });
  },

  updateOne(query, update) {
    return Promise.resolve().then(() => {
      for (const [id, t] of inMemoryResetTokens.entries()) {
        if (query.token && t.token === query.token) {
          const updated = { ...t, ...update };
          inMemoryResetTokens.set(id, updated);
          return { acknowledged: true, modifiedCount: 1 };
        }
      }
      return { acknowledged: true, modifiedCount: 0 };
    });
  },
};

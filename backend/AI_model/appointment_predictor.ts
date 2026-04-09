/**
 * Appointment Wait Time Prediction Module
 * Database-backed predictor used by the Node backend.
 */

import * as MedicalRecord from '../models/MedicalRecord';
import * as QueueModel from '../models/Queue';

export interface AppointmentInput {
    emergency?: string | boolean | number;
    doctor_id?: string;
    doctorId?: unknown;
    clinicId?: unknown;
    visit_type?: string;
    visitType?: string;
    time?: string;
    appointmentTime?: string;
    age?: number | string;
    token_no?: number | string;
    tokenNumber?: number | string;
    problem?: string;
    reason?: string;
    diagnosis?: string;
    notes?: string;
    consultationNotes?: string;
}

export interface WaitTimeContext extends AppointmentInput {
    clinicId?: unknown;
    doctorId?: unknown;
    peopleAhead?: number;
    isEmergency?: boolean;
}

type AverageBucket = { sum: number; count: number };

type PredictorState = {
    hasModel: boolean;
    globalMeanServiceTime: number;
    lastTrainingTime: Date | null;
    trainingInProgress: boolean;
    totalSamples: number;
    problemLookup: Record<string, number>;
    doctorLookup: Record<string, number>;
    clinicLookup: Record<string, number>;
    visitTypeLookup: Record<string, number>;
    emergencyLookup: Record<string, number>;
    timeSlotLookup: Record<string, number>;
};

type MedicalRecordLike = {
    duration?: number;
    diagnosis?: string;
    notes?: string;
    clinicId?: unknown;
    doctorId?: unknown;
};

type QueueHistoryLike = {
    clinicId?: unknown;
    doctorId?: unknown;
    visitType?: string;
    isEmergency?: boolean;
    reason?: string;
    diagnosis?: string;
    consultationNotes?: string;
    startTime?: string | Date;
    endTime?: string | Date;
    status?: string;
    createdAt?: string | Date;
};

let modelReady = false;
let globalMeanServiceTime = 20;
let lastTrainingTime: Date | null = null;
let trainingInProgress = false;
let totalSamples = 0;

let problemBuckets: Record<string, AverageBucket> = {};
let doctorBuckets: Record<string, AverageBucket> = {};
let clinicBuckets: Record<string, AverageBucket> = {};
let visitTypeBuckets: Record<string, AverageBucket> = {};
let emergencyBuckets: Record<string, AverageBucket> = {};
let timeSlotBuckets: Record<string, AverageBucket> = {};

let problemLookup: Record<string, number> = {};
let doctorLookup: Record<string, number> = {};
let clinicLookup: Record<string, number> = {};
let visitTypeLookup: Record<string, number> = {};
let emergencyLookup: Record<string, number> = {};
let timeSlotLookup: Record<string, number> = {};

function safeStringifyId(value: unknown): string {
    if (!value) {
        return '';
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
        return safeStringifyId((value as { _id?: unknown })._id);
    }

    return String(value).trim();
}

function cleanBasic(value: unknown): string {
    if (value === null || value === undefined) {
        return 'missing';
    }

    const normalized = String(value).trim().toLowerCase();

    if (normalized.includes('follow')) {
        return 'followup';
    }

    if (normalized.includes('new')) {
        return 'new';
    }

    if (['true', 'yes', '1'].includes(normalized)) {
        return 'emergency';
    }

    if (['false', 'no', '0'].includes(normalized)) {
        return 'normal';
    }

    return normalized;
}

export function convertTimeToMin(value: unknown): number {
    try {
        if (!value) {
            return 540;
        }

        const timeString = String(value).trim().toUpperCase();
        const parsed = timeString.match(/^(\d{1,2}):(\d{2})/);

        if (!parsed) {
            const fallbackDate = new Date(timeString);
            if (Number.isNaN(fallbackDate.getTime())) {
                return 540;
            }

            return fallbackDate.getHours() * 60 + fallbackDate.getMinutes();
        }

        const hours = Number.parseInt(parsed[1], 10);
        const minutes = Number.parseInt(parsed[2], 10);

        if (Number.isNaN(hours) || Number.isNaN(minutes)) {
            return 540;
        }

        return hours * 60 + minutes;
    } catch {
        return 540;
    }
}

function addSample(bucketMap: Record<string, AverageBucket>, key: string, value: number): void {
    if (!key) {
        return;
    }

    const bucket = bucketMap[key] || { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count += 1;
    bucketMap[key] = bucket;
}

function rebuildLookup(bucketMap: Record<string, AverageBucket>): Record<string, number> {
    const lookup: Record<string, number> = {};

    for (const [key, bucket] of Object.entries(bucketMap)) {
        if (bucket.count > 0) {
            lookup[key] = bucket.sum / bucket.count;
        }
    }

    return lookup;
}

function normalizeServiceDuration(value: unknown): number {
    const numericValue = Number.parseFloat(String(value ?? ''));
    if (Number.isNaN(numericValue) || numericValue <= 0) {
        return 0;
    }

    return numericValue;
}

function extractProblemKey(record: {
    diagnosis?: unknown;
    notes?: unknown;
    reason?: unknown;
    consultationNotes?: unknown;
    problem?: unknown;
}): string {
    return cleanBasic(record.diagnosis || record.notes || record.reason || record.consultationNotes || record.problem || 'missing');
}

function extractDoctorKey(value: unknown): string {
    const key = safeStringifyId(value);
    return key || 'unknown-doctor';
}

function extractClinicKey(value: unknown): string {
    const key = safeStringifyId(value);
    return key || 'unknown-clinic';
}

function normalizeVisitType(value: unknown): string {
    const normalized = cleanBasic(value);
    if (normalized.includes('walk')) {
        return 'walk-in';
    }
    if (normalized.includes('appoint')) {
        return 'appointment';
    }
    return normalized;
}

function getTimeSlotKey(value: unknown): string {
    const minutes = convertTimeToMin(value);
    if (minutes < 540) {
        return 'early-morning';
    }
    if (minutes < 720) {
        return 'morning';
    }
    if (minutes < 900) {
        return 'afternoon';
    }
    if (minutes < 1080) {
        return 'evening';
    }
    return 'late';
}

function getDurationFromQueueRecord(record: QueueHistoryLike): number {
    if (record.startTime && record.endTime) {
        const start = new Date(record.startTime).getTime();
        const end = new Date(record.endTime).getTime();
        if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
            return (end - start) / 60000;
        }
    }

    return 0;
}

function isCompletedQueueRecord(record: QueueHistoryLike): boolean {
    return String(record.status || '').toLowerCase() === 'completed';
}

function rebuildDerivedLookups(): void {
    problemLookup = rebuildLookup(problemBuckets);
    doctorLookup = rebuildLookup(doctorBuckets);
    clinicLookup = rebuildLookup(clinicBuckets);
    visitTypeLookup = rebuildLookup(visitTypeBuckets);
    emergencyLookup = rebuildLookup(emergencyBuckets);
    timeSlotLookup = rebuildLookup(timeSlotBuckets);
}

async function loadHistoricalStats(options: { clinicId?: unknown; doctorId?: unknown; limit?: number } = {}): Promise<void> {
    if (trainingInProgress) {
        return;
    }

    trainingInProgress = true;

    try {
        const query: Record<string, unknown> = { duration: { $gt: 0 } };

        if (options.clinicId) {
            query.clinicId = options.clinicId;
        }

        if (options.doctorId) {
            query.doctorId = options.doctorId;
        }

        const [medicalRecords, queueRecords] = await Promise.all([
            MedicalRecord.find(query)
            .sort({ visitDate: -1 })
            .limit(options.limit || 500)
            .select('clinicId doctorId diagnosis notes duration')
            .lean(),
            QueueModel.find({
                status: 'Completed'
            })
            .sort({ endTime: -1, createdAt: -1 })
            .limit(options.limit || 500)
            .select('clinicId doctorId visitType isEmergency reason diagnosis consultationNotes startTime endTime status createdAt')
            .lean()
        ]);

        const records = medicalRecords as MedicalRecordLike[];
        const queueHistory = queueRecords as QueueHistoryLike[];

        problemBuckets = {};
        doctorBuckets = {};
        clinicBuckets = {};
        visitTypeBuckets = {};
        emergencyBuckets = {};
        timeSlotBuckets = {};
        totalSamples = 0;
        globalMeanServiceTime = 20;

        for (const record of records) {
            const duration = normalizeServiceDuration(record.duration);
            if (!duration) {
                continue;
            }

            totalSamples += 1;
            globalMeanServiceTime = totalSamples === 1
                ? duration
                : ((globalMeanServiceTime * (totalSamples - 1)) + duration) / totalSamples;

            addSample(problemBuckets, extractProblemKey(record), duration);
            addSample(doctorBuckets, extractDoctorKey(record.doctorId), duration);
            addSample(clinicBuckets, extractClinicKey(record.clinicId), duration);
        }

        for (const record of queueHistory) {
            const duration = getDurationFromQueueRecord(record);
            if (!duration) {
                continue;
            }

            const problem = extractProblemKey(record);
            const doctorId = extractDoctorKey(record.doctorId);
            const clinicId = extractClinicKey(record.clinicId);
            const visitType = normalizeVisitType(record.visitType || 'walk-in');
            const emergencyKey = record.isEmergency ? 'emergency' : 'normal';
            const timeSlot = getTimeSlotKey(record.createdAt || record.startTime || record.endTime);

            totalSamples += 1;
            globalMeanServiceTime = totalSamples === 1
                ? duration
                : ((globalMeanServiceTime * (totalSamples - 1)) + duration) / totalSamples;

            addSample(problemBuckets, problem, duration);
            addSample(doctorBuckets, doctorId, duration);
            addSample(clinicBuckets, clinicId, duration);
            addSample(visitTypeBuckets, visitType, duration);
            addSample(emergencyBuckets, emergencyKey, duration);
            addSample(timeSlotBuckets, timeSlot, duration);
        }

        rebuildDerivedLookups();
        modelReady = totalSamples > 0;
        lastTrainingTime = new Date();
    } catch {
        modelReady = totalSamples > 0;
    } finally {
        trainingInProgress = false;
    }
}

function getBaseServiceTime(userData: AppointmentInput): number {
    const doctorId = extractDoctorKey(userData.doctor_id ?? userData.doctorId);
    const clinicId = extractClinicKey(userData.clinicId);
    const problem = extractProblemKey(userData);

    return doctorLookup[doctorId] || clinicLookup[clinicId] || problemLookup[problem] || globalMeanServiceTime || 20;
}

function calculatePrediction(userData: AppointmentInput, peopleAhead = 0): number {
    const emergencyKey = cleanBasic(userData.emergency ?? 'normal');
    const visitType = normalizeVisitType(userData.visit_type ?? userData.visitType ?? 'new');
    const timeMin = convertTimeToMin(userData.time ?? userData.appointmentTime ?? '09:00');
    const tokenNo = Number.parseInt(String(userData.token_no ?? userData.tokenNumber ?? 1), 10);
    const doctorId = extractDoctorKey(userData.doctor_id ?? userData.doctorId);
    const clinicId = extractClinicKey(userData.clinicId);
    const problem = extractProblemKey(userData);
    const timeSlot = getTimeSlotKey(userData.time ?? userData.appointmentTime ?? '09:00');

    const baseServiceTime = getBaseServiceTime(userData);
    const problemServiceTime = problemLookup[problem] || baseServiceTime;
    const doctorServiceTime = doctorLookup[doctorId] || baseServiceTime;
    const clinicServiceTime = clinicLookup[clinicId] || baseServiceTime;
    const visitTypeServiceTime = visitTypeLookup[visitType] || baseServiceTime;
    const emergencyServiceTime = emergencyLookup[emergencyKey] || baseServiceTime;
    const timeSlotServiceTime = timeSlotLookup[timeSlot] || baseServiceTime;

    let prediction = (
        (problemServiceTime * 0.30) +
        (doctorServiceTime * 0.22) +
        (clinicServiceTime * 0.18) +
        (visitTypeServiceTime * 0.12) +
        (emergencyServiceTime * 0.10) +
        (timeSlotServiceTime * 0.08)
    );

    if (visitType === 'followup') {
        prediction *= 0.8;
    } else if (visitType === 'new') {
        prediction *= 1.12;
    }

    if (emergencyKey === 'emergency') {
        prediction *= 0.55;
    }

    if (timeMin < 540 || timeMin > 1020) {
        prediction *= 1.08;
    }

    prediction += Math.max(peopleAhead, 0) * Math.max(baseServiceTime, 8);
    prediction += Math.max(tokenNo - 1, 0) * 1.25;

    return Math.max(Math.round(prediction), 1);
}

export function predictSingleUser(userData: AppointmentInput): number {
    return calculatePrediction(userData, 0);
}

export async function estimateWaitTimeFromDb(context: WaitTimeContext): Promise<number> {
    if (context.clinicId || context.doctorId) {
        await loadHistoricalStats({ clinicId: context.clinicId, doctorId: context.doctorId, limit: 500 });
    } else if (!modelReady) {
        await loadHistoricalStats({ limit: 500 });
    }

    let peopleAhead = Math.max(context.peopleAhead || 0, 0);

    if (!peopleAhead && (context.clinicId || context.doctorId)) {
        const queueQuery: Record<string, unknown> = {
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] }
        };

        if (context.clinicId) {
            queueQuery.clinicId = context.clinicId;
        }

        if (context.doctorId) {
            queueQuery.doctorId = context.doctorId;
        }

        const activeQueue = (await QueueModel.find(queueQuery)
            .sort({ createdAt: 1 })
            .select('createdAt appointmentDate isEmergency tokenNumber clinicId doctorId visitType reason diagnosis consultationNotes')
            .lean()) as Array<Record<string, unknown>>;

        if (activeQueue.length > 0) {
            const currentKey = context.tokenNumber ? String(context.tokenNumber) : '';
            const currentTime = context.time || context.appointmentTime || '';
            peopleAhead = activeQueue.filter((entry) => {
                if (currentKey && String(entry.tokenNumber || '') === currentKey) {
                    return false;
                }

                return true;
            }).length;

            if (!context.time && currentTime) {
                context.time = currentTime;
            }
        }
    }

    return calculatePrediction({
        ...context,
        visit_type: context.visit_type || context.visitType || 'new'
    }, peopleAhead);
}

export function updatePredictorWithData(appointmentData: {
    clinicId?: unknown;
    doctorId?: unknown;
    visit_type?: unknown;
    emergency?: unknown;
    time?: unknown;
    problem?: string;
    diagnosis?: string;
    notes?: string;
    duration?: number | string;
}): void {
    const duration = normalizeServiceDuration(appointmentData.duration);

    if (!duration) {
        return;
    }

    const problem = extractProblemKey(appointmentData);
    const doctorId = extractDoctorKey(appointmentData.doctorId);
    const clinicId = extractClinicKey(appointmentData.clinicId);
    const visitType = normalizeVisitType(appointmentData.visit_type || appointmentData.diagnosis || appointmentData.notes || appointmentData.problem || 'walk-in');
    const emergencyKey = cleanBasic(appointmentData.emergency ?? 'normal');
    const timeSlot = getTimeSlotKey(appointmentData.time ?? '09:00');

    addSample(problemBuckets, problem, duration);
    addSample(doctorBuckets, doctorId, duration);
    addSample(clinicBuckets, clinicId, duration);
    addSample(visitTypeBuckets, visitType, duration);
    addSample(emergencyBuckets, emergencyKey, duration);
    addSample(timeSlotBuckets, timeSlot, duration);

    totalSamples += 1;
    globalMeanServiceTime = totalSamples === 1
        ? duration
        : ((globalMeanServiceTime * (totalSamples - 1)) + duration) / totalSamples;

    rebuildDerivedLookups();
    modelReady = true;
    lastTrainingTime = new Date();
}

export async function initializePredictor(): Promise<void> {
    await loadHistoricalStats({ limit: 500 });
}

export function getPredictorState(): PredictorState {
    return {
        hasModel: modelReady,
        globalMeanServiceTime,
        lastTrainingTime,
        trainingInProgress,
        totalSamples,
        problemLookup,
        doctorLookup,
        clinicLookup,
        visitTypeLookup,
        emergencyLookup,
        timeSlotLookup
    };
}

/**
 * Appointment Wait Time Prediction Module
 * Database-backed predictor used by the Node backend.
 */


import * as MedicalRecord from '../models/MedicalRecord.js';
import * as QueueModel from '../models/Queue.js';

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
    currentStage?: string;
    appointmentDate?: string | Date;
    slot?: string;
    queueId?: string;
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
let dayOfWeekBuckets: Record<string, AverageBucket> = {};

let problemLookup: Record<string, number> = {};
let doctorLookup: Record<string, number> = {};
let clinicLookup: Record<string, number> = {};
let visitTypeLookup: Record<string, number> = {};
let emergencyLookup: Record<string, number> = {};
let timeSlotLookup: Record<string, number> = {};
let dayOfWeekLookup: Record<string, number> = {};

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

function addSample(bucketMap: Record<string, AverageBucket>, key: string, value: number, isLiveUpdate = false): void {
    if (!key) {
        return;
    }

    const bucket = bucketMap[key] || { sum: 0, count: 0 };
    
    // Exponential Moving Average (EMA) for Recency Bias
    // Deep Learning concept: Act like an optimizer (SGD/Adam) with a learning rate (alpha)
    if (isLiveUpdate && bucket.count > 0) {
        const alpha = 0.35; // Learning Rate
        const currentAvg = bucket.sum / bucket.count;
        const newAvg = (alpha * value) + ((1 - alpha) * currentAvg);
        
        // Adjust sum so sum/count equals the new moving average
        bucket.sum = newAvg * bucket.count;
        // Cap count to prevent integer overflow over long periods
        if (bucket.count < 1000) {
            bucket.count += 1;
        }
    } else {
        bucket.sum += value;
        bucket.count += 1;
    }
    
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
    dayOfWeekLookup = rebuildLookup(dayOfWeekBuckets);
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
        dayOfWeekBuckets = {};
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
            const recordDate = new Date((record.createdAt || record.startTime || record.endTime) as string | Date || Date.now());
            const dayOfWeek = recordDate.getDay().toString();

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
            addSample(dayOfWeekBuckets, dayOfWeek, duration);
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

    // Extract digits from token like "P-1" or "T-12"
    const rawToken = String(userData.token_no ?? userData.tokenNumber ?? '1');
    const digitsOnly = rawToken.replace(/\D/g, '');
    const tokenNo = digitsOnly ? Number.parseInt(digitsOnly, 10) : 1;

    const doctorId = extractDoctorKey(userData.doctor_id ?? userData.doctorId);
    const clinicId = extractClinicKey(userData.clinicId);
    const problem = extractProblemKey(userData);
    const timeSlot = getTimeSlotKey(userData.time ?? userData.appointmentTime ?? '09:00');

    const recordDate = new Date(userData.appointmentDate || Date.now());
    const dayOfWeek = recordDate.getDay().toString();

    const baseServiceTime = getBaseServiceTime(userData);
    
    // Deep Learning Concept: Attention Mechanism (Confidence-based Weights)
    // Instead of static weights, we calculate confidence based on sample count.
    // If a bucket has many samples (high confidence), it gets a higher attention weight.
    const getConfidenceWeight = (lookupDict: Record<string, number>, key: string, baseWeight: number) => {
        // We look at the count in the buckets (which we can access via global maps)
        const count = problemBuckets[key]?.count || doctorBuckets[key]?.count || clinicBuckets[key]?.count || 1;
        // Sigmoid-like scaling for confidence: maxes out at 1.5x the base weight if >50 samples
        const confidenceMultiplier = 0.5 + (1 - Math.exp(-count / 20)); 
        return baseWeight * confidenceMultiplier;
    };

    const wProblem = getConfidenceWeight(problemLookup, problem, 0.25);
    const wDoctor = getConfidenceWeight(doctorLookup, doctorId, 0.20);
    const wClinic = getConfidenceWeight(clinicLookup, clinicId, 0.15);
    const wVisit = 0.12;
    const wEmergency = 0.10;
    const wTimeSlot = 0.08;
    const wDayOfWeek = 0.10;

    // Normalize weights so they sum to 1.0 (Softmax principle)
    const totalWeight = wProblem + wDoctor + wClinic + wVisit + wEmergency + wTimeSlot + wDayOfWeek;

    const problemServiceTime = problemLookup[problem] || baseServiceTime;
    const doctorServiceTime = doctorLookup[doctorId] || baseServiceTime;
    const clinicServiceTime = clinicLookup[clinicId] || baseServiceTime;
    const visitTypeServiceTime = visitTypeLookup[visitType] || baseServiceTime;
    const emergencyServiceTime = emergencyLookup[emergencyKey] || baseServiceTime;
    const timeSlotServiceTime = timeSlotLookup[timeSlot] || baseServiceTime;
    const dayOfWeekServiceTime = dayOfWeekLookup[dayOfWeek] || baseServiceTime;

    let prediction = (
        (problemServiceTime * (wProblem / totalWeight)) +
        (doctorServiceTime * (wDoctor / totalWeight)) +
        (clinicServiceTime * (wClinic / totalWeight)) +
        (visitTypeServiceTime * (wVisit / totalWeight)) +
        (emergencyServiceTime * (wEmergency / totalWeight)) +
        (timeSlotServiceTime * (wTimeSlot / totalWeight)) +
        (dayOfWeekServiceTime * (wDayOfWeek / totalWeight))
    );

    if (visitType === 'followup') {
        prediction *= 0.8;
    } else if (visitType === 'new') {
        prediction *= 1.12;
    }

    if (emergencyKey === 'emergency') {
        prediction *= 0.55;
    }

    if (timeMin < 540) {
        prediction *= 1.08;
    }

    // "ghani var time over thay gaya pachi speed karta hoy"
    // If it is late in the day (after 7 PM), doctors speed up to finish the queue
    const currentHour = new Date().getHours();
    if (currentHour >= 21) {
        prediction *= 0.65; // 35% faster after 9 PM
    } else if (currentHour >= 19) {
        prediction *= 0.75; // 25% faster after 7 PM
    } else if (currentHour >= 18) {
        prediction *= 0.85; // 15% faster after 6 PM
    }

    // Scale prediction by 1.5x for patients referred to the lab
    if (userData.currentStage === 'Lab-Pending' || userData.currentStage === 'Lab-Processing') {
        prediction *= 1.5;
    }

    // Deep Learning Concept: Non-linear Activation (Soft Bounding)
    // Prevents extreme outliers (e.g. 500+ mins) by flattening the curve at the top
    const MAX_ALLOWED_TIME = 120; // Cap single consultation baseline prediction at 120 mins
    prediction = MAX_ALLOWED_TIME * (1 - Math.exp(-prediction / (MAX_ALLOWED_TIME * 0.6)));

    prediction += Math.max(peopleAhead, 0) * Math.max(baseServiceTime, 8);
    prediction += Math.max(tokenNo - 1, 0) * 1.25;

    return Math.max(Math.round(prediction), 1);
}

export function predictSingleUser(userData: AppointmentInput): number {
    return calculatePrediction(userData, 0);
}

export async function estimateWaitTimeFromDb(context: WaitTimeContext): Promise<number> {
    if (!modelReady && !trainingInProgress) {
        await loadHistoricalStats({ limit: 2000 });
    }

    let peopleAhead = Math.max(context.peopleAhead || 0, 0);

    if (!peopleAhead && (context.clinicId || context.doctorId)) {
        const targetDayStart = new Date();
        const targetDayEnd = new Date();

        if (context.appointmentDate) {
            const dateObj = new Date(context.appointmentDate);
            if (!isNaN(dateObj.getTime())) {
                targetDayStart.setTime(dateObj.getTime());
                targetDayStart.setHours(0, 0, 0, 0);
                targetDayEnd.setTime(dateObj.getTime());
                targetDayEnd.setHours(23, 59, 59, 999);
            } else {
                targetDayStart.setHours(0, 0, 0, 0);
                targetDayEnd.setHours(23, 59, 59, 999);
            }
        } else {
            targetDayStart.setHours(0, 0, 0, 0);
            targetDayEnd.setHours(23, 59, 59, 999);
        }

        const queueQuery: Record<string, unknown> = {
            isApproved: true,
            status: { $in: ['Waiting', 'In-Consultation'] },
            $or: [
                { appointmentDate: { $gte: targetDayStart, $lte: targetDayEnd } },
                { createdAt: { $gte: targetDayStart, $lte: targetDayEnd } }
            ]
        };

        if (context.clinicId) {
            queueQuery.clinicId = context.clinicId;
        }

        if (context.doctorId) {
            queueQuery.doctorId = context.doctorId;
        }

        const activeQueue = (await QueueModel.find(queueQuery)
            .select('createdAt appointmentDate isEmergency tokenNumber clinicId doctorId visitType reason diagnosis consultationNotes currentStage status')
            .lean()) as Array<Record<string, unknown>>;

        let targetTimeMin: number | null = null;
        const slotTime = context.appointmentTime || context.time || context.slot;
        if (slotTime) {
            targetTimeMin = convertTimeToMin(slotTime);
        }

        if (activeQueue.length > 0) {
            // Sort queue: In-Consultation first, then emergency first, then by time (appointmentDate or createdAt)
            const sortedQueue = [...activeQueue].sort((a, b) => {
                const aInConsult = a.status === 'In-Consultation';
                const bInConsult = b.status === 'In-Consultation';
                if (aInConsult !== bInConsult) return aInConsult ? -1 : 1;

                if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1;

                const aTime = new Date((a.appointmentDate || a.createdAt) as string).getTime();
                const bTime = new Date((b.appointmentDate || b.createdAt) as string).getTime();
                return aTime - bTime;
            });

            // Find context patient in the sorted list
            const contextIndex = sortedQueue.findIndex((entry) =>
                (context.tokenNumber && String(entry.tokenNumber) === String(context.tokenNumber)) ||
                (context.queueId && String(entry._id) === String(context.queueId))
            );

            if (contextIndex !== -1) {
                peopleAhead = contextIndex;
            } else {
                if (targetTimeMin !== null) {
                    peopleAhead = sortedQueue.filter((entry) => {
                        const entryTime = (entry.appointmentDate || entry.createdAt) as string | Date;
                        const entryTimeMin = convertTimeToMin(entryTime);
                        return entryTimeMin < (targetTimeMin as number);
                    }).length;
                } else {
                    peopleAhead = sortedQueue.length;
                }
            }

            // Add weight for lab patients
            const labCount = activeQueue.filter(entry => entry.currentStage === 'Lab-Pending' || entry.currentStage === 'Lab-Processing').length;
            peopleAhead += labCount * 0.5; // Lab patients add 50% more weight to wait time
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
    
    const recordDate = new Date(appointmentData.time as string | Date || Date.now());
    const dayOfWeek = recordDate.getDay().toString();

    addSample(problemBuckets, problem, duration, true);
    addSample(doctorBuckets, doctorId, duration, true);
    addSample(clinicBuckets, clinicId, duration, true);
    addSample(visitTypeBuckets, visitType, duration, true);
    addSample(emergencyBuckets, emergencyKey, duration, true);
    addSample(timeSlotBuckets, timeSlot, duration, true);
    addSample(dayOfWeekBuckets, dayOfWeek, duration, true);

    // Update global mean with EMA for global recency bias
    const globalAlpha = 0.1;
    totalSamples += 1;
    globalMeanServiceTime = totalSamples === 1
        ? duration
        : (globalAlpha * duration) + ((1 - globalAlpha) * globalMeanServiceTime);

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

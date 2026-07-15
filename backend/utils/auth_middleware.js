const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const protect = (req, res, next) => {
    let token = req.headers.authorization;

    if (token && token.startsWith('Bearer')) {
        try {
            token = token.split(' ')[1];
            // Use the constant secret
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            next();
        } catch (error) {
            res.status(401).json({ message: "Not authorized, token failed" });
        }
    } else {
        res.status(401).json({ message: "No token, authorization denied" });
    }
};

// Role-based authorization
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: `Role ${req.user.role} is not allowed to access this route` });
        }
        next();
    };
};
const protectPatient = async (req, res, next) => {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) return res.status(401).json({ message: "No token, authorization denied" });

    try {
        // 🚨 FIXED: Now uses the same secret as the protect function
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error("JWT Verification Error:", err.message);
        res.status(401).json({ message: "Session expired, please login again" });
    }
};

// ============================================================
// 🔬 PROTECT INDEPENDENT LAB ROUTES
// Verifies JWT and checks role === 'independent_lab'
// ============================================================
const protectLab = (req, res, next) => {
    let token = req.headers.authorization;

    if (token && token.startsWith('Bearer')) {
        try {
            token = token.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);

            if (decoded.role !== 'independent_lab') {
                return res.status(403).json({ message: 'Access denied. Independent lab token required.' });
            }

            req.lab = decoded; // { id, role: 'independent_lab' }
            next();
        } catch (error) {
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    } else {
        res.status(401).json({ message: 'No token, authorization denied' });
    }
};

const checkSubscription = async (req, res, next) => {
    try {
        if (req.originalUrl && req.originalUrl.includes('/public/')) {
            return next();
        }

        const SystemConfig = require('../models/SystemConfig');
        const Clinic = require('../models/Clinic');
        const IndependentLab = require('../models/IndependentLab');

        const config = await SystemConfig.findOne();
        if (!config || !config.isSubscriptionEnforced) {
            return next();
        }

        let user = req.user;
        let lab = req.lab;

        // If not populated by protect/protectLab middleware yet, try decoding the token directly
        if (!user && !lab && req.headers.authorization?.startsWith('Bearer ')) {
            const jwt = require('jsonwebtoken');
            const JWT_SECRET = process.env.JWT_SECRET;
            const token = req.headers.authorization.split(' ')[1];
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                if (decoded.role === 'independent_lab') {
                    lab = decoded;
                } else {
                    user = decoded;
                }
            } catch (err) {
                // Ignore token verify error here, let protect middleware handle it
            }
        }

        // Check if user is staff (has user.clinicId) or lab (has lab.id)
        if (user && user.clinicId) {
            if (user.role === 'superadmin') {
                return next();
            }

            const clinic = await Clinic.findById(user.clinicId);
            if (!clinic) return res.status(404).json({ message: 'Clinic not found' });

            if (!clinic.subscriptionExpiresAt || new Date(clinic.subscriptionExpiresAt) < new Date()) {
                return res.status(402).json({
                    success: false,
                    subscriptionRequired: true,
                    message: 'Active subscription required. Please purchase or renew your subscription.'
                });
            }
        } else if (lab && lab.id) {
            const labDoc = await IndependentLab.findById(lab.id);
            if (!labDoc) return res.status(404).json({ message: 'Lab not found' });

            if (!labDoc.subscriptionExpiresAt || new Date(labDoc.subscriptionExpiresAt) < new Date()) {
                return res.status(402).json({
                    success: false,
                    subscriptionRequired: true,
                    message: 'Active subscription required. Please purchase or renew your subscription.'
                });
            }
        }
        next();
    } catch (err) {
        next(err);
    }
};

const checkMaintenanceMode = async (req, res, next) => {
    try {
        // Skip check for public config lookups and options
        if (req.path === '/api/superadmin/config/public' || req.method === 'OPTIONS') {
            return next();
        }

        const SystemConfig = require('../models/SystemConfig');
        const config = await SystemConfig.findOne();
        if (config && config.isMaintenanceMode) {
            // Allow superadmins to bypass maintenance mode
            if (req.user && req.user.role === 'superadmin') {
                return next();
            }
            // Also allow logins for superadmin, so we need to inspect role or allow auth login check
            // However, to keep it simple, we let the frontend or request fail for standard users.
            // If they are trying to log in as a superadmin, they should be allowed.
            // Let's check if it's the login route and check if user trying to log in is superadmin.
            // To prevent blocking superadmins before they log in:
            if (req.path === '/api/auth/login') {
                const User = require('../models/User');
                const { email } = req.body;
                const user = await User.findOne({ email });
                if (user && user.role === 'superadmin') {
                    return next();
                }
            }

            return res.status(503).json({
                success: false,
                isMaintenanceMode: true,
                message: config.maintenanceMessage || 'System is undergoing scheduled maintenance.'
            });
        }
        next();
    } catch (err) {
        next(err);
    }
};

const getFacilityLimits = async (facilityId, type) => {
    try {
        const Clinic = require('../models/Clinic');
        const IndependentLab = require('../models/IndependentLab');
        const SubscriptionPlan = require('../models/SubscriptionPlan');

        let facility;
        if (type === 'clinic') {
            facility = await Clinic.findById(facilityId);
        } else {
            facility = await IndependentLab.findById(facilityId);
        }

        if (!facility) return null;

        // Default limits: 0 = unlimited
        let limits = { maxStaff: 0, maxPatients: 0, maxQueues: 0 };

        // 1. Fetch limit from subscription plan if active
        const isExpired = facility.subscriptionExpiresAt && new Date(facility.subscriptionExpiresAt) < new Date();
        if (facility.subscriptionPlan && facility.subscriptionPlan !== 'free' && !isExpired) {
            const plan = await SubscriptionPlan.findOne({ key: facility.subscriptionPlan });
            if (plan && plan.trafficLimits) {
                limits.maxStaff = plan.trafficLimits.maxStaff || 0;
                limits.maxPatients = plan.trafficLimits.maxPatients || 0;
                limits.maxQueues = plan.trafficLimits.maxQueues || 0;
            }
        }

        // 2. Override with custom traffic limits on the facility itself if set
        if (facility.customTrafficLimits) {
            if (facility.customTrafficLimits.maxStaff !== null && facility.customTrafficLimits.maxStaff !== undefined) {
                limits.maxStaff = facility.customTrafficLimits.maxStaff;
            }
            if (facility.customTrafficLimits.maxPatients !== null && facility.customTrafficLimits.maxPatients !== undefined) {
                limits.maxPatients = facility.customTrafficLimits.maxPatients;
            }
            if (facility.customTrafficLimits.maxQueues !== null && facility.customTrafficLimits.maxQueues !== undefined) {
                limits.maxQueues = facility.customTrafficLimits.maxQueues;
            }
        }

        return limits;
    } catch (err) {
        console.error("Error fetching facility limits:", err);
        return null;
    }
};

const checkAndLinkPatient = async (patientPhone, clinicId) => {
    try {
        const Patient = require('../models/Patient');
        if (!patientPhone || !clinicId) return true;

        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
        const patient = await Patient.findOne({ phone: new RegExp(cleanPhone + '$') });
        if (!patient) return true; // Locker not set up yet

        const isAlreadyVisited = patient.visitedClinics.some(id => id.toString() === clinicId.toString());
        if (isAlreadyVisited) return true;

        const limits = await getFacilityLimits(clinicId, 'clinic');
        if (limits && limits.maxPatients > 0) {
            const currentPatientCount = await Patient.countDocuments({ visitedClinics: clinicId });
            if (currentPatientCount >= limits.maxPatients) {
                throw new Error(`Patient limit reached. Your subscription plan allows up to ${limits.maxPatients} registered patients.`);
            }
        }

        patient.visitedClinics.addToSet(clinicId);
        await patient.save();
        return true;
    } catch (err) {
        throw err;
    }
};

module.exports = { protect, authorize, protectPatient, protectLab, checkSubscription, checkMaintenanceMode, getFacilityLimits, checkAndLinkPatient };
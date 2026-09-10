const Clinic = require('../models/Clinic');
const IndependentLab = require('../models/IndependentLab');

/**
 * Service Gate Middleware Factory
 * Usage: router.post('/invoice', requireService('billing'), controllerAction);
 * Checks if the requesting facility has an active subscription for the required service module.
 */
const requireService = (serviceName) => {
    return async (req, res, next) => {
        try {
            // Find facility context from req.user (Clinic) or req.lab (Lab)
            let facilityId = null;
            let isLab = false;

            if (req.user && req.user.clinicId) {
                facilityId = req.user.clinicId;
            } else if (req.lab && req.lab.id) {
                facilityId = req.lab.id;
                isLab = true;
            }

            // Super Admin bypass
            if (req.user && req.user.role === 'superadmin') {
                return next();
            }

            // If no facility context, pass through
            if (!facilityId) {
                return next();
            }

            let facility = null;
            if (isLab) {
                facility = await IndependentLab.findById(facilityId);
            } else {
                facility = await Clinic.findById(facilityId);
            }

            if (!facility) {
                return res.status(404).json({ success: false, message: 'Facility account not found.' });
            }

            const now = new Date();

            // 1. Check legacy full subscription (backward compatibility)
            // If subscriptionExpiresAt is valid and plan is active, allow all services
            if (facility.subscriptionExpiresAt && new Date(facility.subscriptionExpiresAt) > now) {
                return next();
            }

            // 2. Check modular activeServices array
            if (facility.activeServices && facility.activeServices.length > 0) {
                const serviceDoc = facility.activeServices.find(s => s.service === serviceName);
                if (serviceDoc && serviceDoc.expiresAt && new Date(serviceDoc.expiresAt) > now) {
                    return next();
                }
            }

            // 3. Fallback: Allow basic features if service is not explicitly locked
            // Billing and Messaging require explicit active subscription if main subscription expired
            if (serviceName !== 'billing' && serviceName !== 'messaging') {
                return next();
            }

            return res.status(403).json({
                success: false,
                serviceLocked: true,
                serviceName,
                message: `The '${serviceName}' module is not active in your subscription. Please upgrade your plan to unlock ${serviceName}.`
            });

        } catch (err) {
            console.error(`Service gate error (${serviceName}):`, err.message);
            return res.status(500).json({ success: false, message: err.message });
        }
    };
};

module.exports = { requireService };

const Clinic = require('../models/Clinic');
const IndependentLab = require('../models/IndependentLab');
const User = require('../models/User');
const Patient = require('../models/Patient');
const ExternalLabRequest = require('../models/ExternalLabRequest');
const PromoCode = require('../models/PromoCode');
const SystemConfig = require('../models/SystemConfig');
const SupportTicket = require('../models/SupportTicket');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { sendEmail } = require('../utils/send_email');
const { encrypt, decrypt } = require('../utils/crypto_helper');

// Helper to get or initialize system config
const getOrCreateConfig = async () => {
    let config = await SystemConfig.findOne();
    if (!config) {
        config = await SystemConfig.create({
            isMaintenanceMode: false,
            isSubscriptionEnforced: false
        });
    }
    return config;
};

// GET /api/superadmin/facilities
exports.getFacilities = async (req, res) => {
    try {
        const clinics = await Clinic.find().sort({ createdAt: -1 });
        const labs = await IndependentLab.find().sort({ createdAt: -1 });
        const allPayments = await SubscriptionPayment.find().populate('facilityId').sort({ createdAt: -1 });
        const payments = allPayments.filter(p => p.status === 'captured');

        const clinicsData = await Promise.all(clinics.map(async (c) => {
            const staffCount = await User.countDocuments({ clinicId: c._id });
            const patientCount = await Patient.countDocuments({ visitedClinics: c._id });
            
            // Total revenue contributed by this clinic
            const facilityPayments = payments.filter(p => p.facilityId && p.facilityId._id.toString() === c._id.toString());
            const revenueContributed = facilityPayments.reduce((acc, p) => acc + p.amount, 0);

            return {
                ...c.toObject(),
                staffCount,
                patientCount,
                revenueContributed
            };
        }));

        const labsData = await Promise.all(labs.map(async (l) => {
            const reportCount = await ExternalLabRequest.countDocuments({ labId: l._id });
            const staffCount = 1; // Standalone tech
            
            // Total revenue contributed by this lab
            const facilityPayments = payments.filter(p => p.facilityId && p.facilityId._id.toString() === l._id.toString());
            const revenueContributed = facilityPayments.reduce((acc, p) => acc + p.amount, 0);

            return {
                ...l.toObject(),
                staffCount,
                reportCount,
                revenueContributed
            };
        }));

        const totalRevenue = payments.reduce((acc, p) => acc + p.amount, 0);
        const activeClinicsSubscribers = clinics.filter(c => c.subscriptionExpiresAt && new Date(c.subscriptionExpiresAt) > new Date()).length;
        const activeLabsSubscribers = labs.filter(l => l.subscriptionExpiresAt && new Date(l.subscriptionExpiresAt) > new Date()).length;

        res.status(200).json({
            success: true,
            clinics: clinicsData,
            labs: labsData,
            payments: allPayments,
            totalRevenue,
            activeSubscribersCount: activeClinicsSubscribers + activeLabsSubscribers
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /api/superadmin/subscription/payment/:id
exports.deleteSubscriptionPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const payment = await SubscriptionPayment.findByIdAndDelete(id);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment record not found' });
        }
        res.status(200).json({ success: true, message: 'Subscription payment transaction record deleted successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/facility/:id/premium
exports.togglePremium = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'clinic' or 'lab'

        if (type === 'clinic') {
            const clinic = await Clinic.findById(id);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
            clinic.isPremium = !clinic.isPremium;
            await clinic.save();
            return res.status(200).json({ success: true, isPremium: clinic.isPremium });
        } else {
            const lab = await IndependentLab.findById(id);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
            lab.isPremium = !lab.isPremium;
            await lab.save();
            return res.status(200).json({ success: true, isPremium: lab.isPremium });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/facility/:id/network
exports.toggleNetwork = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'clinic' or 'lab'

        if (type === 'clinic') {
            const clinic = await Clinic.findById(id);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
            clinic.showOnNetwork = clinic.showOnNetwork === false ? true : false;
            await clinic.save();
            return res.status(200).json({ success: true, showOnNetwork: clinic.showOnNetwork });
        } else {
            const lab = await IndependentLab.findById(id);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
            lab.showOnNetwork = lab.showOnNetwork === false ? true : false;
            await lab.save();
            return res.status(200).json({ success: true, showOnNetwork: lab.showOnNetwork });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/superadmin/facility/:id/gift-subscription
exports.giftSubscription = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, months } = req.body; // type: 'clinic'|'lab', months: 1|2

        const additionMs = months * 30 * 24 * 60 * 60 * 1000;
        let expiresAt = new Date(Date.now() + additionMs);

        if (type === 'clinic') {
            const clinic = await Clinic.findById(id);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
            
            if (clinic.subscriptionExpiresAt && clinic.subscriptionExpiresAt > new Date()) {
                expiresAt = new Date(clinic.subscriptionExpiresAt.getTime() + additionMs);
            }
            clinic.subscriptionExpiresAt = expiresAt;
            if (clinic.subscriptionPlan === 'free') {
                clinic.subscriptionPlan = 'clinic-only';
            }
            await clinic.save();
        } else {
            const lab = await IndependentLab.findById(id);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
            
            if (lab.subscriptionExpiresAt && lab.subscriptionExpiresAt > new Date()) {
                expiresAt = new Date(lab.subscriptionExpiresAt.getTime() + additionMs);
            }
            lab.subscriptionExpiresAt = expiresAt;
            if (lab.subscriptionPlan === 'free') {
                lab.subscriptionPlan = 'independent-lab';
            }
            await lab.save();
        }

        res.status(200).json({ success: true, message: `Gifted ${months} months subscription successfully!`, expiresAt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/facility/:id/subscription-price
exports.setSubscriptionPrice = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, customSubscriptionPrice } = req.body;

        if (type === 'clinic') {
            const clinic = await Clinic.findByIdAndUpdate(id, { customSubscriptionPrice }, { new: true });
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
        } else {
            const lab = await IndependentLab.findByIdAndUpdate(id, { customSubscriptionPrice }, { new: true });
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
        }

        res.status(200).json({ success: true, message: 'Custom subscription price set successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /api/superadmin/facility/:id
exports.deleteFacility = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.query;

        const LabConnection = require('../models/LabConnection');
        const ExternalLabRequest = require('../models/ExternalLabRequest');

        if (type === 'clinic') {
            await Clinic.findByIdAndDelete(id);
            // Delete all clinic users (doctors, receptionists, etc.)
            await User.deleteMany({ clinicId: id });
            // Clean up clinic connections and test requests
            await LabConnection.deleteMany({ clinicId: id });
            await ExternalLabRequest.deleteMany({ clinicId: id });
        } else {
            await IndependentLab.findByIdAndDelete(id);
            // Clean up lab connections and test requests
            await LabConnection.deleteMany({ labId: id });
            await ExternalLabRequest.deleteMany({ labId: id });
        }

        res.status(200).json({ success: true, message: 'Facility and all related staff and records removed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/facility/:id/active
exports.toggleActive = async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'clinic' or 'lab'

        if (type === 'clinic') {
            const clinic = await Clinic.findById(id);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
            clinic.isActive = !clinic.isActive;
            await clinic.save();
            return res.status(200).json({ success: true, isActive: clinic.isActive, message: `Clinic status set to ${clinic.isActive ? 'Active' : 'Temporarily Closed'}` });
        } else {
            const lab = await IndependentLab.findById(id);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
            lab.isActive = !lab.isActive;
            await lab.save();
            return res.status(200).json({ success: true, isActive: lab.isActive, message: `Lab status set to ${lab.isActive ? 'Active' : 'Temporarily Closed'}` });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/superadmin/config
exports.getSystemConfig = async (req, res) => {
    try {
        const config = await getOrCreateConfig();
        res.status(200).json({ success: true, data: config });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// PATCH /api/superadmin/config
exports.updateSystemConfig = async (req, res) => {
    try {
        const { 
            isMaintenanceMode, 
            maintenanceMessage, 
            isSubscriptionEnforced,
            trialPeriodDays,
            legacyDiscountPercentage,
            legacyDiscountThresholdDays,
            legacyCutoffDate,
            legacyDiscountStartDate,
            legacyDiscountEndDate,
            legacyDiscountLabel,
            taxRatePercentage,
            isGstEnabled,
            gstNumber,
            cgstRatePercentage,
            sgstRatePercentage,
            igstRatePercentage,
            gstState,
            gstStateCode,
            smtpHost,
            smtpPort,
            smtpUser,
            smtpPass,
            smtpSecure,
            superadminEmail
        } = req.body;
        const config = await getOrCreateConfig();

        if (isMaintenanceMode !== undefined) config.isMaintenanceMode = isMaintenanceMode;
        if (maintenanceMessage !== undefined) config.maintenanceMessage = maintenanceMessage;
        if (isSubscriptionEnforced !== undefined) config.isSubscriptionEnforced = isSubscriptionEnforced;
        if (trialPeriodDays !== undefined) config.trialPeriodDays = trialPeriodDays;
        if (legacyDiscountPercentage !== undefined) config.legacyDiscountPercentage = legacyDiscountPercentage;
        if (legacyDiscountThresholdDays !== undefined) config.legacyDiscountThresholdDays = legacyDiscountThresholdDays;
        if (legacyCutoffDate !== undefined) config.legacyCutoffDate = legacyCutoffDate;
        if (legacyDiscountStartDate !== undefined) config.legacyDiscountStartDate = legacyDiscountStartDate;
        if (legacyDiscountEndDate !== undefined) config.legacyDiscountEndDate = legacyDiscountEndDate;
        if (legacyDiscountLabel !== undefined) config.legacyDiscountLabel = legacyDiscountLabel;
        if (taxRatePercentage !== undefined) config.taxRatePercentage = taxRatePercentage;
        if (isGstEnabled !== undefined) config.isGstEnabled = isGstEnabled;
        if (gstNumber !== undefined) config.gstNumber = gstNumber;
        if (cgstRatePercentage !== undefined) config.cgstRatePercentage = cgstRatePercentage;
        if (sgstRatePercentage !== undefined) config.sgstRatePercentage = sgstRatePercentage;
        if (igstRatePercentage !== undefined) config.igstRatePercentage = igstRatePercentage;
        if (gstState !== undefined) config.gstState = gstState;
        if (gstStateCode !== undefined) config.gstStateCode = gstStateCode;
        if (smtpHost !== undefined) config.smtpHost = smtpHost;
        if (smtpPort !== undefined) config.smtpPort = smtpPort;
        if (smtpUser !== undefined) config.smtpUser = smtpUser;
        if (smtpPass !== undefined && smtpPass !== '') {
            const decrypted = decrypt(smtpPass);
            config.smtpPass = (decrypted !== smtpPass) ? smtpPass : encrypt(smtpPass);
        }
        if (smtpSecure !== undefined) config.smtpSecure = smtpSecure;
        if (superadminEmail !== undefined) config.superadminEmail = superadminEmail;

        await config.save();
        res.status(200).json({ success: true, data: config });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/superadmin/config/public (Public lookup for login pages/frontends)
exports.getPublicConfig = async (req, res) => {
    try {
        const config = await getOrCreateConfig();
        res.status(200).json({
            success: true,
            isMaintenanceMode: config.isMaintenanceMode,
            maintenanceMessage: config.maintenanceMessage,
            isSubscriptionEnforced: config.isSubscriptionEnforced
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/superadmin/tickets
exports.getTickets = async (req, res) => {
    try {
        const tickets = await SupportTicket.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: tickets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// PATCH /api/superadmin/tickets/:id/resolve
exports.resolveTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolutionText } = req.body;
        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

        ticket.status = 'resolved';
        ticket.resolutionText = resolutionText || 'Your ticket has been resolved.';
        await ticket.save();

        const { sendResolutionEmail } = require('../utils/send_email');
        sendResolutionEmail(ticket, ticket.resolutionText).catch(err => console.error('Failed to send resolution email:', err.message));

        res.status(200).json({ success: true, message: 'Ticket resolved and user notified.', data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/superadmin/tickets/create (Called by clinic/lab to report issues)
exports.createTicket = async (req, res) => {
    try {
        const { senderName, senderEmail, facilityType, facilityName, subject, message } = req.body;
        const ticket = await SupportTicket.create({
            senderName,
            senderEmail,
            facilityType,
            facilityName,
            subject,
            message
        });

        const config = await SystemConfig.findOne();
        const superadminEmail = config ? config.superadminEmail : null;

        const { sendSupportConfirmationEmail } = require('../utils/send_email');
        sendSupportConfirmationEmail(ticket, superadminEmail).catch(err => console.error('Failed to send support confirmation email:', err.message));

        res.status(201).json({ success: true, message: 'Support request sent successfully!', data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// Promo code endpoints
exports.getPromoCodes = async (req, res) => {
    try {
        const promos = await PromoCode.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: promos });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.createPromoCode = async (req, res) => {
    try {
        const { code, discountPercentage, expiryDate } = req.body;
        const promo = await PromoCode.create({ code, discountPercentage, expiryDate });
        res.status(201).json({ success: true, data: promo });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.deletePromoCode = async (req, res) => {
    try {
        const { id } = req.params;
        await PromoCode.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Promo code deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/superadmin/subscription/checkout
exports.generateRazorpayOrder = async (req, res) => {
    try {
        const { plan, promoCode } = req.body;
        let facilityId, facilityType, facilityModel, name, createdAt, customSubscriptionPrice;

        if (req.user && req.user.clinicId) {
            facilityId = req.user.clinicId;
            facilityType = 'clinic';
            facilityModel = 'Clinic';
            const clinic = await Clinic.findById(facilityId);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
            name = clinic.name;
            createdAt = clinic.createdAt;
            customSubscriptionPrice = clinic.customSubscriptionPrice;
        } else if (req.lab && req.lab.id) {
            facilityId = req.lab.id;
            facilityType = 'lab';
            facilityModel = 'IndependentLab';
            const lab = await IndependentLab.findById(facilityId);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
            name = lab.labName;
            createdAt = lab.createdAt;
            customSubscriptionPrice = lab.customSubscriptionPrice;
        } else {
            return res.status(400).json({ success: false, message: 'Invalid facility context' });
        }

        // 1. Calculate Base Price
        let basePrice = 0;
        const planDoc = await SubscriptionPlan.findOne({ key: plan });
        
        if (customSubscriptionPrice !== undefined && customSubscriptionPrice !== null) {
            basePrice = customSubscriptionPrice;
        } else if (planDoc) {
            basePrice = planDoc.price;
        } else {
            // Fallback for legacy plans if they aren't in DB yet
            if (plan === 'clinic-only') basePrice = 1000;
            else if (plan === 'clinic-lab-combined') basePrice = 1800;
            else if (plan === 'independent-lab') basePrice = 1200;
            else return res.status(400).json({ success: false, message: 'Invalid plan selected' });
        }

        let finalPrice = basePrice;
        let discountDetails = [];

        // 2. Old User Discount using SystemConfig settings
        const SystemConfig = require('../models/SystemConfig');
        const systemConfig = await SystemConfig.findOne();
        const legacyDiscountPct = systemConfig ? (systemConfig.legacyDiscountPercentage ?? 20) : 20;
        const legacyThresholdDays = systemConfig ? (systemConfig.legacyDiscountThresholdDays ?? 30) : 30;
        const legacyCutoff = systemConfig ? systemConfig.legacyCutoffDate : null;
        const legacyStart = systemConfig ? systemConfig.legacyDiscountStartDate : null;
        const legacyEnd = systemConfig ? systemConfig.legacyDiscountEndDate : null;

        let isOldUser = false;
        if (legacyCutoff) {
            isOldUser = new Date(createdAt) < new Date(legacyCutoff);
        } else {
            isOldUser = (Date.now() - new Date(createdAt).getTime()) > legacyThresholdDays * 24 * 60 * 60 * 1000;
        }
        
        let isLegacyDiscountActive = true;
        const now = new Date();
        if (legacyStart && now < new Date(legacyStart)) isLegacyDiscountActive = false;
        if (legacyEnd && now > new Date(legacyEnd)) isLegacyDiscountActive = false;

        const legacyDiscountLabel = systemConfig ? (systemConfig.legacyDiscountLabel || 'Legacy User Discount') : 'Legacy User Discount';

        if (isOldUser && isLegacyDiscountActive && legacyDiscountPct > 0) {
            const oldUserDiscount = basePrice * (legacyDiscountPct / 100);
            finalPrice -= oldUserDiscount;
            discountDetails.push({ name: `${legacyDiscountLabel} (${legacyDiscountPct}%)`, amount: oldUserDiscount });
        }

        // 3. Promo Code Discount
        if (promoCode) {
            const codeObj = await PromoCode.findOne({ code: promoCode.toUpperCase(), isActive: true });
            if (codeObj && new Date(codeObj.expiryDate) > new Date()) {
                const promoDiscount = finalPrice * (codeObj.discountPercentage / 100);
                finalPrice -= promoDiscount;
                discountDetails.push({ name: `Promo Code: ${codeObj.code} (${codeObj.discountPercentage}%)`, amount: promoDiscount });
            } else {
                return res.status(400).json({ success: false, message: 'Invalid or expired promo code' });
            }
        }

        // Safety minimum price
        if (finalPrice < 0) finalPrice = 0;

        // 4. Create Razorpay Order
        const amountPaise = Math.round(finalPrice * 100);
        const orderId = `order_mock_${Math.random().toString(36).substring(2, 15)}`;

        let order = {
            id: orderId,
            amount: amountPaise,
            currency: 'INR',
            status: 'created'
        };

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (keyId && keySecret && keyId !== 'mock_key' && keySecret !== 'mock_secret') {
            try {
                const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
                order = await razorpay.orders.create({
                    amount: amountPaise,
                    currency: 'INR',
                    receipt: `receipt_${facilityId}_${Date.now()}`
                });
            } catch (err) {
                console.error('⚠️ Razorpay order creation failed, falling back to mock:', err.message);
            }
        }

        // Create Payment Record
        await SubscriptionPayment.create({
            facilityId,
            facilityType,
            facilityModel,
            amount: finalPrice,
            currency: 'INR',
            status: 'created',
            razorpayOrderId: order.id,
            plan
        });

        res.status(200).json({
            success: true,
            orderId: order.id,
            amount: finalPrice,
            amountPaise,
            discountDetails,
            keyId: keyId || 'mock_key'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/superadmin/subscription/verify
exports.verifyRazorpayPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        const payment = await SubscriptionPayment.findOne({ razorpayOrderId });
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Subscription order record not found' });
        }

        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        const isMock = razorpayOrderId.startsWith('order_mock_') || !keySecret || keySecret === 'mock_secret';

        if (!isMock) {
            // Verify signature
            const shasum = crypto.createHmac('sha256', keySecret);
            shasum.update(`${razorpayOrderId}|${razorpayPaymentId}`);
            const digest = shasum.digest('hex');
            if (digest !== razorpaySignature) {
                payment.status = 'failed';
                await payment.save();
                return res.status(400).json({ success: false, message: 'Payment verification failed. Invalid signature.' });
            }
        }

        // Update payment status
        payment.status = 'captured';
        payment.razorpayPaymentId = razorpayPaymentId || `pay_mock_${Math.random().toString(36).substring(2, 10)}`;
        payment.razorpaySignature = razorpaySignature || 'mock_signature';
        await payment.save();

        // Calculate and set subscription expiration date
        const planDoc = await SubscriptionPlan.findOne({ key: payment.plan });
        const durationDays = planDoc ? planDoc.durationDays : 30; // fallback to 30 days
        const additionMs = durationDays * 24 * 60 * 60 * 1000;
        let expiresAt = new Date(Date.now() + additionMs);

        let facilityName = '';
        let facilityEmail = '';
        let facilityCode = '';
        let facilityAddress = '';

        if (payment.facilityType === 'clinic') {
            const clinic = await Clinic.findById(payment.facilityId);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });

            if (clinic.subscriptionExpiresAt && clinic.subscriptionExpiresAt > new Date()) {
                expiresAt = new Date(clinic.subscriptionExpiresAt.getTime() + additionMs);
            }
            clinic.subscriptionExpiresAt = expiresAt;
            clinic.subscriptionPlan = payment.plan;
            clinic.isPremium = true;
            await clinic.save();
            facilityName = clinic.name;
            facilityEmail = clinic.email;
            facilityCode = clinic.clinicCode;
            facilityAddress = clinic.address || '';
        } else {
            const lab = await IndependentLab.findById(payment.facilityId);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });

            if (lab.subscriptionExpiresAt && lab.subscriptionExpiresAt > new Date()) {
                expiresAt = new Date(lab.subscriptionExpiresAt.getTime() + additionMs);
            }
            lab.subscriptionExpiresAt = expiresAt;
            lab.subscriptionPlan = payment.plan;
            lab.isPremium = true;
            await lab.save();
            facilityName = lab.labName;
            facilityEmail = lab.email;
            facilityCode = lab.labCode;
            facilityAddress = lab.address || '';
        }

        // Calculate Tax & Charges Breakdown dynamically using SystemConfig
        const configDoc = await getOrCreateConfig();
        const totalAmount = payment.amount;

        let taxRate = configDoc.taxRatePercentage ?? 18;
        let isLocalState = false;
        let cgstRate = 0;
        let sgstRate = 0;
        let igstRate = 0;
        let cgstAmount = 0;
        let sgstAmount = 0;
        let igstAmount = 0;
        let subtotal = totalAmount;
        let taxAmount = 0;

        if (configDoc.isGstEnabled) {
            const configuredState = configDoc.gstState || 'India';
            isLocalState = facilityAddress && configuredState && facilityAddress.toLowerCase().includes(configuredState.toLowerCase());

            if (isLocalState) {
                cgstRate = configDoc.cgstRatePercentage ?? 9;
                sgstRate = configDoc.sgstRatePercentage ?? 9;
                taxRate = cgstRate + sgstRate;
                subtotal = Math.round((totalAmount / (1 + taxRate / 100)) * 100) / 100;
                cgstAmount = Math.round((subtotal * (cgstRate / 100)) * 100) / 100;
                sgstAmount = Math.round((subtotal * (sgstRate / 100)) * 100) / 100;
                taxAmount = Math.round((cgstAmount + sgstAmount) * 100) / 100;
            } else {
                igstRate = configDoc.igstRatePercentage ?? 18;
                taxRate = igstRate;
                subtotal = Math.round((totalAmount / (1 + taxRate / 100)) * 100) / 100;
                igstAmount = Math.round((totalAmount - subtotal) * 100) / 100;
                taxAmount = igstAmount;
            }
        } else {
            subtotal = totalAmount;
            taxAmount = 0;
        }

        // Send detailed invoice email
        if (facilityEmail) {
            try {
                const subject = `📄 Appointory Premium Subscription Invoice - ${payment.razorpayOrderId}`;
                const html = `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                        <div style="text-align: center; padding-bottom: 20px; border-bottom: 2px dashed #cbd5e1;">
                            <h2 style="color: #0F766E; margin: 0; font-size: 24px;">Appointory Premium Receipt</h2>
                            <p style="color: #64748b; font-size: 13px; margin: 5px 0 0 0;">Transaction Invoice & Plan Breakdown</p>
                        </div>

                        <div style="margin: 20px 0;">
                            <p style="font-size: 14px; color: #334155; margin: 0 0 10px 0;">Dear <strong>${facilityName}</strong>,</p>
                            <p style="font-size: 14px; color: #334155; line-height: 1.6; margin: 0;">Thank you for your payment. Your Appointory Premium Subscription has been successfully updated on our ledger.</p>
                        </div>

                        <div style="background-color: #f8fafc; border-radius: 12px; padding: 15px; margin-bottom: 20px; border: 1px solid #f1f5f9;">
                            <table style="width: 100%; font-size: 13px; color: #475569; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Order ID:</td>
                                    <td style="padding: 6px 0; text-align: right; font-family: monospace; font-weight: bold; color: #334155;">${payment.razorpayOrderId}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Payment ID:</td>
                                    <td style="padding: 6px 0; text-align: right; font-family: monospace; color: #475569;">${payment.razorpayPaymentId || 'N/A'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Billing Date:</td>
                                    <td style="padding: 6px 0; text-align: right; color: #475569;">${new Date(payment.billingDate).toLocaleString()}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Subscription Plan:</td>
                                    <td style="padding: 6px 0; text-align: right; font-weight: 800; color: #0F766E; text-transform: uppercase;">${payment.plan}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 6px 0; font-weight: 600; color: #64748b;">Premium Expiry:</td>
                                    <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #e11d48;">${new Date(expiresAt).toLocaleDateString()}</td>
                                </tr>
                            </table>
                        </div>

                        <div style="border-top: 1px solid #f1f5f9; padding-top: 15px;">
                            <h4 style="color: #334155; margin: 0 0 10px 0; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Charge Details</h4>
                            <table style="width: 100%; font-size: 13px; color: #475569;">
                                <tr>
                                    <td style="padding: 4px 0;">Base Subscription Cost:</td>
                                    <td style="padding: 4px 0; text-align: right; font-weight: 600;">₹${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                </tr>
                                ${configDoc.isGstEnabled ? (
                                    isLocalState ? `
                                        <tr>
                                            <td style="padding: 4px 0;">Central GST (CGST ${cgstRate}%):</td>
                                            <td style="padding: 4px 0; text-align: right; font-weight: 600;">₹${cgstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 4px 0;">State GST (SGST ${sgstRate}%):</td>
                                            <td style="padding: 4px 0; text-align: right; font-weight: 600;">₹${sgstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                    ` : `
                                        <tr>
                                            <td style="padding: 4px 0;">Integrated GST (IGST ${igstRate}%):</td>
                                            <td style="padding: 4px 0; text-align: right; font-weight: 600;">₹${igstAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                    `
                                ) : `
                                    <tr>
                                        <td style="padding: 4px 0;">GST / Service Tax (Disabled):</td>
                                        <td style="padding: 4px 0; text-align: right; font-weight: 600;">₹0.00</td>
                                    </tr>
                                `}
                                <tr style="font-size: 15px; font-weight: bold; color: #0F766E;">
                                    <td style="padding: 10px 0 0 0; border-top: 1px dashed #cbd5e1;">Total Paid Amount:</td>
                                    <td style="padding: 10px 0 0 0; border-top: 1px dashed #cbd5e1; text-align: right; font-size: 16px;">₹${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                </tr>
                            </table>
                        </div>

                        <div style="margin-top: 30px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 15px; line-height: 1.5;">
                            <p style="margin: 0 0 3px 0;">This is an automated subscription receipt for your Appointory account.</p>
                            <p style="margin: 0;">For queries or support, reach out to us at <strong>theintelliverse@gmail.com</strong></p>
                        </div>
                    </div>
                `;

                // Generate PDF invoice buffer
                const { generateInvoicePdf } = require('../utils/invoice_generator');
                const pdfBuffer = await generateInvoicePdf({
                    facilityName,
                    facilityType: payment.facilityType,
                    facilityCode,
                    facilityEmail,
                    facilityAddress,
                    orderId: payment.razorpayOrderId,
                    paymentId: payment.razorpayPaymentId || 'N/A',
                    billingDate: payment.billingDate,
                    plan: payment.plan,
                    expiresAt,
                    subtotal,
                    taxRate,
                    taxAmount,
                    totalAmount,
                    isGstEnabled: configDoc.isGstEnabled,
                    gstNumber: configDoc.gstNumber,
                    cgstRate,
                    sgstRate,
                    igstRate,
                    cgstAmount,
                    sgstAmount,
                    igstAmount,
                    isLocalState,
                    gstState: configDoc.gstState,
                    gstStateCode: configDoc.gstStateCode
                });

                const attachments = [
                    {
                        filename: `Invoice_${payment.razorpayOrderId}.pdf`,
                        content: pdfBuffer
                    }
                ];

                await sendEmail(facilityEmail, subject, html, attachments);
            } catch (emailErr) {
                console.error('⚠️ Failed to send payment receipt email:', emailErr.message);
            }
        }

        res.status(200).json({
            success: true,
            message: 'Subscription payment verified and updated successfully!',
            expiresAt
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/update-credentials
exports.updateCredentials = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'Superadmin not found' });

        if (email) user.email = email;
        if (password) {
            const { hashPassword } = require('../utils/auth_helper');
            user.password = await hashPassword(password);
        }
        await user.save();
        res.status(200).json({ success: true, message: 'Credentials updated successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/superadmin/subscription/history
exports.getFacilityBillingHistory = async (req, res) => {
    try {
        const facilityId = req.user ? req.user.clinicId : req.lab.id;
        const payments = await SubscriptionPayment.find({ facilityId }).sort({ billingDate: -1 });
        res.status(200).json({ success: true, data: payments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// --- SUBSCRIPTION PLANS CRUD ---

// GET /api/superadmin/plans (Admin only)
exports.getPlans = async (req, res) => {
    try {
        const plans = await SubscriptionPlan.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/superadmin/plans/public (Public / Clients)
exports.getPublicPlans = async (req, res) => {
    try {
        const plans = await SubscriptionPlan.find({ isActive: true, isCustomPlan: false }).sort({ price: 1 });
        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/superadmin/plans (Admin only)
exports.createPlan = async (req, res) => {
    try {
        const { name, key, price, durationDays, facilityType, features, trafficLimits, isCustomPlan, isActive } = req.body;
        const plan = await SubscriptionPlan.create({
            name, key, price, durationDays, facilityType, features, trafficLimits, isCustomPlan, isActive
        });
        res.status(201).json({ success: true, data: plan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PUT /api/superadmin/plans/:id (Admin only)
exports.updatePlan = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedPlan = await SubscriptionPlan.findByIdAndUpdate(id, req.body, { new: true });
        if (!updatedPlan) return res.status(404).json({ success: false, message: 'Plan not found' });
        res.status(200).json({ success: true, data: updatedPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE /api/superadmin/plans/:id (Admin only)
exports.deletePlan = async (req, res) => {
    try {
        const { id } = req.params;
        await SubscriptionPlan.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Subscription plan deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/facility/:id/custom-limits (Admin only)
exports.setCustomLimits = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, customTrafficLimits } = req.body; // type: 'clinic'|'lab'

        if (type === 'clinic') {
            const clinic = await Clinic.findByIdAndUpdate(id, { customTrafficLimits }, { new: true });
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
        } else {
            const lab = await IndependentLab.findByIdAndUpdate(id, { customTrafficLimits }, { new: true });
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
        }
        res.status(200).json({ success: true, message: 'Custom traffic limits saved successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// PATCH /api/superadmin/facility/:id/subscription
exports.updateFacilitySubscription = async (req, res) => {
    try {
        const { id } = req.params;
        const { type, subscriptionPlan, subscriptionExpiresAt } = req.body;

        if (type === 'clinic') {
            const clinic = await Clinic.findById(id);
            if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found' });
            
            if (subscriptionPlan !== undefined) clinic.subscriptionPlan = subscriptionPlan;
            if (subscriptionExpiresAt !== undefined) {
                clinic.subscriptionExpiresAt = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
                clinic.isPremium = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) > new Date() : false;
            }
            await clinic.save();
            return res.status(200).json({ success: true, message: 'Clinic subscription updated successfully!' });
        } else {
            const lab = await IndependentLab.findById(id);
            if (!lab) return res.status(404).json({ success: false, message: 'Lab not found' });
            
            if (subscriptionPlan !== undefined) lab.subscriptionPlan = subscriptionPlan;
            if (subscriptionExpiresAt !== undefined) {
                lab.subscriptionExpiresAt = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
                lab.isPremium = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) > new Date() : false;
            }
            await lab.save();
            return res.status(200).json({ success: true, message: 'Lab subscription updated successfully!' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

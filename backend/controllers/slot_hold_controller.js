const crypto = require('crypto');
const SlotHold = require('../models/SlotHold');
const Queue = require('../models/Queue');
const { normalizeIndianPhone } = require('../utils/phone_helper');

/**
 * 🔒 HOLD A SLOT (10-minute temporary lock)
 * Prevents race conditions and double-booking during checkout/registration.
 */
exports.holdSlot = async (req, res) => {
    try {
        const { clinicId, doctorId, slotDate, slotTime, phone } = req.body;

        if (!clinicId || !doctorId || !slotDate || !slotTime) {
            return res.status(400).json({
                success: false,
                message: 'Clinic, doctor, date, and slot time are required'
            });
        }

        const datePart = String(slotDate).split('T')[0];
        const timeClean = String(slotTime).trim();
        const fullDate = new Date(`${datePart}T${timeClean.length === 5 ? timeClean + ':00' : timeClean}`);

        if (isNaN(fullDate.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid slot date or time format'
            });
        }

        // 1️⃣ Check if appointment is already booked in Queue
        const existingAppointment = await Queue.findOne({
            clinicId,
            doctorId,
            appointmentDate: fullDate,
            status: { $in: ['Scheduled', 'Pending-Approval', 'Waiting', 'In-Consultation'] }
        });

        if (existingAppointment) {
            return res.status(409).json({
                success: false,
                message: 'This slot is already booked. Please choose another time.'
            });
        }

        // 2️⃣ Format phone if provided
        let cleanPhone = null;
        if (phone) {
            const norm = normalizeIndianPhone(phone);
            if (norm.isValid) cleanPhone = norm.normalized;
        }

        const holdToken = crypto.randomUUID();
        const dateOnlyObj = new Date(`${datePart}T00:00:00.000Z`);

        // 3️⃣ Attempt to create temporary hold document
        // Relies on MongoDB unique index { clinicId: 1, doctorId: 1, slotDate: 1, slotTime: 1 }
        try {
            await SlotHold.create({
                clinicId,
                doctorId,
                slotDate: dateOnlyObj,
                slotTime: timeClean,
                holdToken,
                ipAddress: req.ip || '',
                phone: cleanPhone,
                createdAt: new Date()
            });

            return res.status(201).json({
                success: true,
                holdToken,
                expiresAt: new Date(Date.now() + 600 * 1000), // 10 minutes from now
                slot: {
                    clinicId,
                    doctorId,
                    slotDate: datePart,
                    slotTime: timeClean
                }
            });
        } catch (dbErr) {
            if (dbErr.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message: 'This slot is temporarily held by another patient. Please choose another slot or try again in a few minutes.'
                });
            }
            throw dbErr;
        }
    } catch (error) {
        console.error('❌ Error creating slot hold:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to hold appointment slot. Please try again.'
        });
    }
};

/**
 * 🔓 RELEASE SLOT HOLD
 * Called if patient navigates away, changes slot, or cancels.
 */
exports.releaseSlot = async (req, res) => {
    try {
        const { holdToken } = req.body;
        if (!holdToken) {
            return res.status(400).json({
                success: false,
                message: 'Hold token is required'
            });
        }

        await SlotHold.deleteOne({ holdToken });

        res.status(200).json({
            success: true,
            message: 'Slot hold released successfully'
        });
    } catch (error) {
        console.error('❌ Error releasing slot hold:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to release slot hold'
        });
    }
};

/**
 * ⏱️ CHECK HOLD STATUS & TIME REMAINING
 */
exports.getHoldStatus = async (req, res) => {
    try {
        const { holdToken } = req.params;
        if (!holdToken) {
            return res.status(400).json({ success: false, message: 'Hold token required' });
        }

        const hold = await SlotHold.findOne({ holdToken });
        if (!hold) {
            return res.status(200).json({
                success: true,
                active: false,
                message: 'Hold has expired or does not exist'
            });
        }

        const elapsedMs = Date.now() - new Date(hold.createdAt).getTime();
        const remainingSeconds = Math.max(0, Math.floor((600 * 1000 - elapsedMs) / 1000));

        res.status(200).json({
            success: true,
            active: remainingSeconds > 0,
            remainingSeconds,
            expiresAt: new Date(new Date(hold.createdAt).getTime() + 600 * 1000)
        });
    } catch (error) {
        console.error('❌ Error getting hold status:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to get slot hold status'
        });
    }
};

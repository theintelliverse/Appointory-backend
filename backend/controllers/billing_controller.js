const PatientInvoice = require('../models/PatientInvoice');
const Patient = require('../models/Patient');
const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');
const User = require('../models/User');

// --- 🔍 FETCH PATIENT & APPOINTMENT DATA FOR BILLING ---
exports.fetchPatientBillingData = async (req, res) => {
    try {
        const { phone } = req.params;
        const clinicId = req.user.clinicId;

        if (!phone || phone.length < 5) {
            return res.status(400).json({
                success: false,
                message: "Valid mobile phone number is required."
            });
        }

        // 1. Fetch Patient Profile
        const patient = await Patient.findOne({ phone }).lean();

        // 2. Fetch Clinic Config & Default Fees
        const clinic = await Clinic.findById(clinicId).lean();
        const clinicFees = {
            feeConsult: clinic?.feeConsult || 500,
            feeFollowupConsult: clinic?.feeFollowupConsult || 300,
            taxEnabled: clinic?.taxEnabled !== undefined ? clinic.taxEnabled : true,
            taxRate: clinic?.taxRate ?? 18,
            feeLab: clinic?.feeLab || 450,
            feeEmergency: clinic?.feeEmergency || 300,
            feeMedicine: clinic?.feeMedicine || 120
        };

        // 3. Fetch Today's Queue Entry or Recent Appointment
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const queueEntry = await Queue.findOne({
            clinicId,
            patientPhone: phone,
            createdAt: { $gte: startOfDay }
        })
        .populate('doctorId', 'name specialization')
        .sort({ createdAt: -1 })
        .lean();

        // 4. Fetch All Active Doctors for Selection
        const doctors = await User.find({
            clinicId,
            role: 'doctor',
            isActive: true
        }).select('_id name specialization').lean();

        // 5. Calculate Online Pending Dues / Past Unpaid Invoices ("Paisa Bakki")
        const pastInvoicesWithDues = await PatientInvoice.find({
            clinicId,
            patientPhone: phone,
            remainingDue: { $gt: 0 }
        }).lean();

        const totalPastDues = pastInvoicesWithDues.reduce((sum, inv) => sum + (inv.remainingDue || 0), 0);

        // Check if queue entry itself was an online appointment booking with pending fee
        let onlineBookingDue = 0;
        if (queueEntry && queueEntry.visitType === 'Appointment') {
            onlineBookingDue = clinicFees.feeConsult;
        }

        const onlinePendingDues = Math.max(totalPastDues, onlineBookingDue);

        // 6. Fetch any Lab Test Referrals/Requests for patient
        const labRequests = [];
        if (queueEntry && queueEntry.requiredTest) {
            labRequests.push({
                testName: queueEntry.requiredTest,
                fee: clinicFees.feeLab
            });
        }

        return res.status(200).json({
            success: true,
            patientFound: !!patient,
            patient: patient ? {
                id: patient._id,
                name: patient.name,
                phone: patient.phone,
                age: patient.age || '',
                gender: patient.gender || 'Male',
                bloodGroup: patient.bloodGroup || 'O+'
            } : null,
            queue: queueEntry ? {
                id: queueEntry._id,
                tokenNumber: queueEntry.tokenNumber || 'TK',
                doctorId: queueEntry.doctorId?._id || queueEntry.doctorId,
                doctorName: queueEntry.doctorId?.name || 'Dr. Assigned',
                specialization: queueEntry.doctorId?.specialization || 'General',
                visitType: queueEntry.visitType || 'Walk-in',
                status: queueEntry.status,
                isEmergency: queueEntry.isEmergency || false,
                reason: queueEntry.reason || '',
                requiredTest: queueEntry.requiredTest || '',
                appointmentDate: queueEntry.appointmentDate || queueEntry.createdAt
            } : null,
            clinicFees,
            onlinePendingDues,
            pastDuesCount: pastInvoicesWithDues.length,
            labRequests,
            doctors
        });

    } catch (error) {
        console.error("Billing Auto-fetch Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch patient billing details: " + error.message
        });
    }
};

// --- 🧾 CREATE PATIENT INVOICE & AUTO-BOOK APPOINTMENT ---
exports.createInvoice = async (req, res) => {
    try {
        const {
            patientName,
            patientPhone,
            doctorId,
            doctorName,
            billingType = 'clinic',
            items = [],
            subtotal = 0,
            discount = 0,
            tax = 0,
            onlinePendingDues = 0,
            totalAmount = 0,
            paidAmount = 0,
            remainingDue = 0,
            paymentMode = 'Cash',
            paymentStatus = 'Paid',
            queueId,
            notes,
            bookAppointment = false // 🆕 Optional: Only book if receptionist explicitly selects it!
        } = req.body;

        const clinicId = req.user.clinicId;

        if (!patientName || !patientPhone) {
            return res.status(400).json({
                success: false,
                message: "Patient Name and Phone number are required."
            });
        }

        if (!items || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: "At least one line item is required for billing."
            });
        }

        // 1. Auto-Check or Create Patient Profile
        let patient = await Patient.findOne({ phone: patientPhone });
        if (!patient) {
            patient = await Patient.create({
                name: patientName,
                phone: patientPhone,
                registeredOn: new Date()
            });
        }

        // 2. Link or Book Appointment Token ONLY if requested or already active
        let activeQueueId = queueId || null;
        let generatedToken = null;

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        if (!activeQueueId && billingType === 'clinic') {
            const existingQueueToday = await Queue.findOne({
                clinicId,
                patientPhone,
                createdAt: { $gte: startOfDay }
            });

            if (existingQueueToday) {
                activeQueueId = existingQueueToday._id;
                generatedToken = existingQueueToday.tokenNumber;
            } else if (bookAppointment === true) {
                // Determine assigned doctor
                let docIdToAssign = doctorId;
                if (!docIdToAssign) {
                    const firstDoc = await User.findOne({ clinicId, role: 'doctor', isActive: true });
                    if (firstDoc) docIdToAssign = firstDoc._id;
                }

                if (docIdToAssign) {
                    const todayCount = await Queue.countDocuments({
                        clinicId,
                        isApproved: true,
                        createdAt: { $gte: startOfDay }
                    });
                    generatedToken = `T-${todayCount + 1}`;

                    const newQueueEntry = await Queue.create({
                        clinicId,
                        patientName,
                        patientPhone,
                        doctorId: docIdToAssign,
                        tokenNumber: generatedToken,
                        visitType: 'Walk-in',
                        isApproved: true,
                        status: 'Waiting'
                    });

                    activeQueueId = newQueueEntry._id;

                    // 📢 SOCKET EMIT: Real-time update to reception & doctor queues
                    if (req.io) {
                        req.io.to(clinicId.toString()).emit('queueUpdate');
                        req.io.to(clinicId.toString()).emit('newCheckInRequest', {
                            message: `New token ${generatedToken} generated for ${patientName} via billing.`
                        });
                    }
                }
            }
        }

        // 3. Generate Unique Invoice Number (e.g. INV-CLN-20260910-1001 or INV-LAB-20260910-1001)
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const countToday = await PatientInvoice.countDocuments({
            clinicId,
            billingDate: { $gte: startOfDay }
        });
        const prefix = billingType === 'lab' ? 'INV-LAB' : 'INV-CLN';
        const invoiceNumber = `${prefix}-${dateStr}-${String(countToday + 1).padStart(4, '0')}`;

        const invoice = await PatientInvoice.create({
            invoiceNumber,
            clinicId,
            patientName,
            patientPhone,
            doctorId: doctorId || null,
            doctorName: doctorName || '',
            billingType,
            items,
            subtotal,
            discount,
            tax,
            onlinePendingDues,
            totalAmount,
            paidAmount,
            remainingDue: Math.max(0, remainingDue),
            paymentMode,
            paymentStatus,
            queueId: activeQueueId,
            notes: notes || '',
            createdBy: req.user._id,
            createdByName: req.user.name || 'Receptionist',
            billingDate: new Date()
        });

        // 📢 SOCKET EMIT: Broadcast invoice created event to clinic room
        if (req.io) {
            req.io.to(clinicId.toString()).emit('invoiceCreated', {
                invoiceNumber: invoice.invoiceNumber,
                patientName: invoice.patientName,
                totalAmount: invoice.totalAmount
            });
        }

        // 4. Fetch Updated Live Revenue Metrics for Response
        const revenueStats = await getRevenueMetricsHelper(clinicId);

        return res.status(201).json({
            success: true,
            message: generatedToken 
                ? `Invoice issued & Appointment Token (${generatedToken}) booked!` 
                : "Invoice generated successfully!",
            invoice,
            tokenNumber: generatedToken,
            revenueStats
        });

    } catch (error) {
        console.error("Create Invoice Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create invoice: " + error.message
        });
    }
};

// --- 📊 GET LIVE REVENUE METRICS FOR CLINIC ---
const getRevenueMetricsHelper = async (clinicId) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const allInvoices = await PatientInvoice.find({ clinicId }).lean();
    const todayInvoices = allInvoices.filter(inv => new Date(inv.billingDate) >= startOfDay);

    const totalRevenue = allInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
    const todayRevenue = todayInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
    const todayBilledTotal = todayInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
    const totalPendingDues = allInvoices.reduce((sum, inv) => sum + (inv.remainingDue || 0), 0);
    
    const clinicRevenue = allInvoices
        .filter(inv => inv.billingType === 'clinic')
        .reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

    const labRevenue = allInvoices
        .filter(inv => inv.billingType === 'lab')
        .reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

    return {
        totalRevenue,
        todayRevenue,
        todayBilledTotal,
        totalPendingDues,
        clinicRevenue,
        labRevenue,
        invoicesTodayCount: todayInvoices.length,
        totalInvoicesCount: allInvoices.length
    };
};

exports.getRevenueStats = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const stats = await getRevenueMetricsHelper(clinicId);
        return res.status(200).json({
            success: true,
            revenueStats: stats
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to calculate revenue stats: " + error.message
        });
    }
};

// --- 📋 GET INVOICES LIST FOR CLINIC ---
exports.getInvoices = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { search, billingType, status, startDate, endDate } = req.query;

        const query = { clinicId };

        if (billingType && (billingType === 'clinic' || billingType === 'lab')) {
            query.billingType = billingType;
        }

        if (status && status !== 'all') {
            query.paymentStatus = status;
        }

        if (startDate || endDate) {
            query.billingDate = {};
            if (startDate) {
                const s = new Date(startDate);
                s.setHours(0, 0, 0, 0);
                query.billingDate.$gte = s;
            }
            if (endDate) {
                const e = new Date(endDate);
                e.setHours(23, 59, 59, 999);
                query.billingDate.$lte = e;
            }
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { patientPhone: { $regex: search, $options: 'i' } },
                { patientName: { $regex: search, $options: 'i' } },
                { invoiceNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const page = parseInt(req.query.page) || 1;
        const limitParam = req.query.limit;
        const isAll = limitParam === 'all' || limitParam === '-1';
        const limit = isAll ? 0 : (parseInt(limitParam) || (req.query.page ? 10 : 500));
        const skip = isAll ? 0 : (page - 1) * limit;

        const totalCount = await PatientInvoice.countDocuments(query);
        let invoiceQuery = PatientInvoice.find(query)
            .populate('clinicId', 'name address contactPhone clinicCode')
            .sort({ billingDate: -1 });

        if (!isAll && limit > 0) {
            invoiceQuery = invoiceQuery.skip(skip).limit(limit);
        }
        const invoices = await invoiceQuery.lean();

        const revenueStats = await getRevenueMetricsHelper(clinicId);

        return res.status(200).json({
            success: true,
            totalCount,
            currentPage: page,
            totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
            count: invoices.length,
            invoices,
            revenueStats
        });

    } catch (error) {
        console.error("Get Invoices Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch invoices: " + error.message
        });
    }
};

// --- 📄 GET SINGLE INVOICE BY ID ---
exports.getInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const clinicId = req.user.clinicId;

        const invoice = await PatientInvoice.findOne({ _id: id, clinicId })
            .populate('clinicId', 'name address contactPhone clinicCode')
            .lean();

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found."
            });
        }

        return res.status(200).json({
            success: true,
            invoice
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Failed to fetch invoice details: " + error.message
        });
    }
};

// --- ⚙️ GET BILLING SETTINGS ---
exports.getBillingSettings = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const clinic = await Clinic.findById(clinicId).lean();
        if (!clinic) {
            return res.status(404).json({ success: false, message: "Clinic record not found." });
        }
        return res.status(200).json({
            success: true,
            settings: {
                feeConsult: clinic.feeConsult ?? 500,
                feeFollowupConsult: clinic.feeFollowupConsult ?? 300,
                taxEnabled: clinic.taxEnabled !== undefined ? clinic.taxEnabled : true,
                taxRate: clinic.taxRate ?? 18,
                feeLab: clinic.feeLab ?? 450,
                feeEmergency: clinic.feeEmergency ?? 300,
                feeMedicine: clinic.feeMedicine ?? 120
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch settings: " + error.message });
    }
};

// --- ⚙️ UPDATE BILLING SETTINGS ---
exports.updateBillingSettings = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { feeConsult, feeFollowupConsult, taxEnabled, taxRate, feeLab, feeEmergency, feeMedicine } = req.body;

        const updateData = {};
        if (feeConsult !== undefined) updateData.feeConsult = Number(feeConsult);
        if (feeFollowupConsult !== undefined) updateData.feeFollowupConsult = Number(feeFollowupConsult);
        if (taxEnabled !== undefined) updateData.taxEnabled = Boolean(taxEnabled);
        if (taxRate !== undefined) updateData.taxRate = Number(taxRate);
        if (feeLab !== undefined) updateData.feeLab = Number(feeLab);
        if (feeEmergency !== undefined) updateData.feeEmergency = Number(feeEmergency);
        if (feeMedicine !== undefined) updateData.feeMedicine = Number(feeMedicine);

        const updatedClinic = await Clinic.findByIdAndUpdate(
            clinicId,
            { $set: updateData },
            { new: true }
        ).lean();

        return res.status(200).json({
            success: true,
            message: "Billing settings updated successfully.",
            settings: {
                feeConsult: updatedClinic.feeConsult,
                feeFollowupConsult: updatedClinic.feeFollowupConsult,
                taxEnabled: updatedClinic.taxEnabled,
                taxRate: updatedClinic.taxRate,
                feeLab: updatedClinic.feeLab,
                feeEmergency: updatedClinic.feeEmergency,
                feeMedicine: updatedClinic.feeMedicine
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Failed to update settings: " + error.message });
    }
};

// --- 💰 SETTLE OUTSTANDING DUE ON AN INVOICE ---
exports.settleInvoiceDue = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { id } = req.params;
        const { amount, paymentMode } = req.body;

        const invoice = await PatientInvoice.findOne({ _id: id, clinicId });
        if (!invoice) {
            return res.status(404).json({ success: false, message: "Invoice not found." });
        }

        const settleAmount = Number(amount) || invoice.remainingDue;
        const newPaid = invoice.paidAmount + settleAmount;
        const newDue = Math.max(0, invoice.totalAmount - newPaid);

        invoice.paidAmount = newPaid;
        invoice.remainingDue = newDue;
        invoice.paymentStatus = newDue === 0 ? 'Paid' : 'Partially Paid';
        if (paymentMode) invoice.paymentMode = paymentMode;

        await invoice.save();

        const revenueStats = await getRevenueMetricsHelper(clinicId);

        return res.status(200).json({
            success: true,
            message: `Successfully collected ₹${settleAmount}. Remaining due: ₹${newDue}.`,
            invoice,
            revenueStats
        });
    } catch (error) {
        console.error("Settle Invoice Due Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- 🎫 BOOK APPOINTMENT TOKEN FOR AN EXISTING INVOICE ---
exports.bookAppointmentForInvoice = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { id } = req.params;
        const { doctorId } = req.body;

        const invoice = await PatientInvoice.findOne({ _id: id, clinicId });
        if (!invoice) {
            return res.status(404).json({ success: false, message: "Invoice not found." });
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Check if patient already has a queue entry today
        const existingQueueToday = await Queue.findOne({
            clinicId,
            patientPhone: invoice.patientPhone,
            createdAt: { $gte: startOfDay }
        });

        if (existingQueueToday) {
            invoice.queueId = existingQueueToday._id;
            await invoice.save();
            return res.status(200).json({
                success: true,
                message: `Patient already has active token (${existingQueueToday.tokenNumber}) today!`,
                tokenNumber: existingQueueToday.tokenNumber,
                queueId: existingQueueToday._id,
                invoice
            });
        }

        let docIdToAssign = doctorId || invoice.doctorId;
        if (!docIdToAssign) {
            const firstDoc = await User.findOne({ clinicId, role: 'doctor', isActive: true });
            if (firstDoc) docIdToAssign = firstDoc._id;
        }

        if (!docIdToAssign) {
            return res.status(400).json({ success: false, message: "No active doctor found to assign appointment." });
        }

        const docUser = await User.findById(docIdToAssign).select('name specialization');

        const todayCount = await Queue.countDocuments({
            clinicId,
            isApproved: true,
            createdAt: { $gte: startOfDay }
        });
        const generatedToken = `T-${todayCount + 1}`;

        const newQueueEntry = await Queue.create({
            clinicId,
            patientName: invoice.patientName,
            patientPhone: invoice.patientPhone,
            doctorId: docIdToAssign,
            tokenNumber: generatedToken,
            visitType: 'Walk-in',
            isApproved: true,
            status: 'Waiting'
        });

        invoice.queueId = newQueueEntry._id;
        invoice.doctorId = docIdToAssign;
        if (docUser) invoice.doctorName = docUser.name;
        await invoice.save();

        if (req.io) {
            req.io.to(clinicId.toString()).emit('queueUpdate');
            req.io.to(clinicId.toString()).emit('newCheckInRequest', {
                message: `New token ${generatedToken} generated for ${invoice.patientName} via billing.`
            });
        }

        return res.status(200).json({
            success: true,
            message: `Appointment Token ${generatedToken} booked successfully for ${docUser?.name || 'Doctor'}!`,
            tokenNumber: generatedToken,
            queueId: newQueueEntry._id,
            invoice
        });
    } catch (error) {
        console.error("Book appointment for invoice error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// --- 📱 GET PATIENT INVOICES (FOR PATIENT LOCKER & PORTAL) ---
exports.getPatientInvoices = async (req, res) => {
    try {
        if (!req.user || (!req.user.phone && !req.user.id)) {
            return res.status(401).json({ success: false, message: "Invalid session." });
        }

        const rawPhone = req.user.phone || '';
        const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, '').slice(-10) : '';
        const phoneRegex = cleanPhone ? new RegExp(cleanPhone + '$') : null;

        if (!phoneRegex) {
            return res.status(200).json({ success: true, count: 0, totalCount: 0, invoices: [] });
        }

        const page = parseInt(req.query.page) || 1;
        const limitParam = req.query.limit;
        const isAll = limitParam === 'all' || limitParam === '-1';
        const limit = isAll ? 0 : (parseInt(limitParam) || 10);
        const skip = isAll ? 0 : (page - 1) * limit;

        const totalCount = await PatientInvoice.countDocuments({ patientPhone: phoneRegex });
        let invQuery = PatientInvoice.find({ patientPhone: phoneRegex })
            .populate('clinicId', 'name address contactPhone clinicCode logo')
            .sort({ billingDate: -1 });

        if (!isAll && limit > 0) {
            invQuery = invQuery.skip(skip).limit(limit);
        }

        const invoices = await invQuery.lean();

        return res.status(200).json({
            success: true,
            totalCount,
            currentPage: page,
            totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
            count: invoices.length,
            invoices
        });
    } catch (error) {
        console.error("Get Patient Invoices Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch patient invoices: " + error.message
        });
    }
};


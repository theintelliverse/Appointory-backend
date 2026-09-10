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
            notes
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

        // 2. Auto-Book Appointment Token if no active queue entry exists today
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
            } else {
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
        const { search, billingType, status } = req.query;

        const query = { clinicId };

        if (billingType && (billingType === 'clinic' || billingType === 'lab')) {
            query.billingType = billingType;
        }

        if (status) {
            query.paymentStatus = status;
        }

        if (search && search.trim() !== '') {
            query.$or = [
                { patientPhone: { $regex: search, $options: 'i' } },
                { patientName: { $regex: search, $options: 'i' } },
                { invoiceNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const invoices = await PatientInvoice.find(query)
            .sort({ billingDate: -1 })
            .limit(100)
            .lean();

        const revenueStats = await getRevenueMetricsHelper(clinicId);

        return res.status(200).json({
            success: true,
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

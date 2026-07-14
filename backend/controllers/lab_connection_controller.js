const IndependentLab = require('../models/IndependentLab');
const LabConnection = require('../models/LabConnection');
const ExternalLabRequest = require('../models/ExternalLabRequest');
const { storage } = require('../utils/cloudinary_config');
const multer = require('multer');

const upload = multer({ storage });

// =============================================
// 🔍 SEARCH LABS (public — for clinic to find)
// GET /api/lab-connect/search?q=keyword
// =============================================
exports.searchLabs = async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) {
            return res.status(200).json({ success: true, data: [] });
        }

        const regex = new RegExp(q, 'i');
        const labs = await IndependentLab.find({
            isActive: true,
            $or: [
                { labName: regex },
                { labCode: regex },
                { address: regex }
            ]
        }).select('labName labCode address phone logo _id').limit(20);

        res.status(200).json({ success: true, data: labs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📨 SEND CONNECTION REQUEST (clinic → lab)
// POST /api/lab-connect/request
// Body: { labId }
// =============================================
exports.sendConnectionRequest = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { labId } = req.body;

        if (!labId) return res.status(400).json({ success: false, message: 'labId is required.' });

        const lab = await IndependentLab.findById(labId);
        if (!lab || !lab.isActive) {
            return res.status(404).json({ success: false, message: 'Lab not found.' });
        }

        // Check if already connected or pending
        const existing = await LabConnection.findOne({ clinicId, labId });
        if (existing) {
            if (existing.status === 'accepted') {
                return res.status(400).json({ success: false, message: 'Already connected to this lab.' });
            }
            if (existing.status === 'pending') {
                return res.status(400).json({ success: false, message: 'Connection request already pending.' });
            }
            // If rejected, allow re-request
            existing.status = 'pending';
            existing.requestedAt = Date.now();
            existing.respondedAt = null;
            await existing.save();
            return res.status(200).json({ success: true, message: 'Connection request re-sent.' });
        }

        const conn = await LabConnection.create({ clinicId, labId });
        res.status(201).json({ success: true, message: 'Connection request sent to the lab.', data: conn });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📋 GET CLINIC'S CONNECTIONS (clinic admin)
// GET /api/lab-connect/clinic
// =============================================
exports.getClinicConnections = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const connections = await LabConnection.find({ clinicId })
            .populate('labId', 'labName labCode address phone logo')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: connections });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📋 GET LAB'S INCOMING REQUESTS (independent lab)
// GET /api/lab-connect/lab
// =============================================
exports.getLabConnections = async (req, res) => {
    try {
        const labId = req.lab.id;
        const connections = await LabConnection.find({ labId })
            .populate('clinicId', 'name clinicCode address contactPhone')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: connections });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// ✅ LAB RESPONDS TO CONNECTION (accept/reject)
// PATCH /api/lab-connect/:id/respond
// Body: { action: 'accept' | 'reject' }
// =============================================
exports.respondToConnection = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { id } = req.params;
        const { action } = req.body;

        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: "action must be 'accept' or 'reject'." });
        }

        const conn = await LabConnection.findOne({ _id: id, labId });
        if (!conn) return res.status(404).json({ success: false, message: 'Connection request not found.' });

        if (conn.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'This request has already been responded to.' });
        }

        conn.status = action === 'accept' ? 'accepted' : 'rejected';
        conn.respondedAt = Date.now();
        await conn.save();

        res.status(200).json({ success: true, message: `Connection ${conn.status}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// ❌ CLINIC DISCONNECTS FROM LAB
// DELETE /api/lab-connect/:id
// =============================================
exports.disconnectLab = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { id } = req.params;

        const conn = await LabConnection.findOneAndDelete({ _id: id, clinicId });
        if (!conn) return res.status(404).json({ success: false, message: 'Connection not found.' });

        res.status(200).json({ success: true, message: 'Disconnected from lab.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📤 CLINIC SENDS TEST REQUEST TO CONNECTED LAB
// POST /api/lab-connect/request-test
// Body: { labId, patientName, patientPhone, testName, notes, queueId? }
// =============================================
exports.sendTestRequest = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { labId, patientName, patientPhone, testName, notes, queueId } = req.body;

        if (!labId || !patientName || !patientPhone || !testName) {
            return res.status(400).json({ success: false, message: 'labId, patientName, patientPhone, testName are required.' });
        }

        // Verify they are connected
        const conn = await LabConnection.findOne({ clinicId, labId, status: 'accepted' });
        if (!conn) {
            return res.status(403).json({ success: false, message: 'You are not connected to this lab. Connect first.' });
        }

        const request = await ExternalLabRequest.create({
            labId,
            clinicId,
            patientName,
            patientPhone,
            testName,
            notes: notes || '',
            queueId: queueId || null
        });

        if (req.io) {
            req.io.to(`lab_${labId}`).emit('testRequestUpdate');
        }

        res.status(201).json({ success: true, message: 'Test request sent to lab.', data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📋 CLINIC VIEWS ITS SENT TEST REQUESTS
// GET /api/lab-connect/test-requests/clinic
// =============================================
exports.getClinicTestRequests = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const requests = await ExternalLabRequest.find({ clinicId })
            .populate('labId', 'labName labCode phone address')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📋 LAB VIEWS ALL RECEIVED TEST REQUESTS
// GET /api/lab-connect/test-requests/lab
// =============================================
exports.getLabTestRequests = async (req, res) => {
    try {
        const labId = req.lab.id;
        const requests = await ExternalLabRequest.find({ labId })
            .populate('clinicId', 'name clinicCode address contactPhone')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 🔄 LAB UPDATES REQUEST STATUS
// PATCH /api/lab-connect/test-requests/:id/status
// Body: { status: 'Accepted'|'Processing'|'Completed'|'Rejected' }
// =============================================
exports.updateRequestStatus = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['Accepted', 'Processing', 'Completed', 'Rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const request = await ExternalLabRequest.findOne({ _id: id, labId });
        if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

        request.status = status;
        if (status === 'Completed') request.completedAt = Date.now();
        await request.save();

        if (req.io) {
            req.io.to(`lab_${labId}`).emit('testRequestUpdate');
            req.io.to(request.clinicId.toString()).emit('queueUpdate');
        }

        res.status(200).json({ success: true, message: `Status updated to ${status}.`, data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📤 LAB UPLOADS REPORT FOR A REQUEST
// POST /api/lab-connect/test-requests/:id/upload-report
// Multipart form with files[]
// =============================================
exports.uploadReportForRequest = [
    upload.array('file', 10),
    async (req, res) => {
        try {
            const labId = req.lab.id;
            const { id } = req.params;

            const request = await ExternalLabRequest.findOne({ _id: id, labId });
            if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });

            let files = req.files || [];
            if (req.file) files = [req.file];

            if (files.length === 0) {
                return res.status(400).json({ success: false, message: 'No files uploaded.' });
            }

            const newReports = files.map((file, idx) => ({
                fileUrl: file.secure_url || file.path || file.url,
                publicId: file.public_id || file.filename || null,
                fileType: file.mimetype && file.mimetype.includes('pdf') ? 'PDF' : 'Image',
                title: req.body.title || `Lab Report ${idx + 1}`,
                uploadedAt: Date.now()
            }));

            request.reports.push(...newReports);
            request.status = 'Completed';
            request.completedAt = Date.now();
            await request.save();

            if (req.io) {
                req.io.to(`lab_${labId}`).emit('testRequestUpdate');
                req.io.to(request.clinicId.toString()).emit('queueUpdate');
            }

            res.status(200).json({
                success: true,
                message: `${files.length} report(s) uploaded and request marked Completed.`,
                data: request
            });
        } catch (error) {
            console.error('❌ Upload Report Error:', error.message);
            res.status(500).json({ success: false, message: error.message });
        }
    }
];

// =============================================
// 📤 LAB CREATES TEST REQUEST (walk-in direct booking)
// POST /api/lab-connect/test-requests/lab/create
// Body: { clinicId, patientName, patientPhone, testName, notes }
// =============================================
exports.createLabTestRequest = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { clinicId, patientName, patientPhone, testName, notes } = req.body;

        if (!clinicId || !patientName || !patientPhone || !testName) {
            return res.status(400).json({ success: false, message: 'clinicId, patientName, patientPhone, testName are required.' });
        }

        // Verify connection is active
        const conn = await LabConnection.findOne({ clinicId, labId, status: 'accepted' });
        if (!conn) {
            return res.status(403).json({ success: false, message: 'You are not connected to this clinic.' });
        }

        const request = await ExternalLabRequest.create({
            labId,
            clinicId,
            patientName,
            patientPhone,
            testName,
            notes: notes || ''
        });

        // Emit socket events
        if (req.io) {
            req.io.to(`lab_${labId}`).emit('testRequestUpdate');
            req.io.to(clinicId.toString()).emit('queueUpdate');
        }

        res.status(201).json({ success: true, message: 'Walk-in test request created successfully.', data: request });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 🌐 LAB PORTAL: GET ALL CLINICS WITH STATUS
// GET /api/lab-connect/lab/clinics
// =============================================
exports.getClinicsForLab = async (req, res) => {
    try {
        const labId = req.lab.id;
        const Clinic = require('../models/Clinic');

        // Fetch all active clinics
        const clinics = await Clinic.find({ isActive: true }).select('name clinicCode address contactPhone');

        // Fetch all connections for this lab
        const connections = await LabConnection.find({ labId });

        // Map status to each clinic
        const clinicData = clinics.map(clinic => {
            const conn = connections.find(c => c.clinicId.toString() === clinic._id.toString());
            return {
                ...clinic.toObject(),
                connectionStatus: conn ? conn.status : 'none',
                connectionId: conn ? conn._id : null,
                initiatedBy: conn ? conn.initiatedBy : null
            };
        });

        res.status(200).json({ success: true, data: clinicData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📨 LAB PORTAL: SEND CONNECTION REQUEST TO CLINIC
// POST /api/lab-connect/lab/request
// Body: { clinicId }
// =============================================
exports.sendLabRequestToClinic = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { clinicId } = req.body;

        if (!clinicId) return res.status(400).json({ success: false, message: 'clinicId is required.' });

        const Clinic = require('../models/Clinic');
        const clinic = await Clinic.findById(clinicId);
        if (!clinic || !clinic.isActive) {
            return res.status(404).json({ success: false, message: 'Clinic not found.' });
        }

        // Check if already connected or pending
        const existing = await LabConnection.findOne({ clinicId, labId });
        if (existing) {
            if (existing.status === 'accepted') {
                return res.status(400).json({ success: false, message: 'Already connected to this clinic.' });
            }
            if (existing.status === 'pending') {
                return res.status(400).json({ success: false, message: 'Connection request already pending.' });
            }
            // If rejected, allow re-request
            existing.status = 'pending';
            existing.initiatedBy = 'lab';
            existing.requestedAt = Date.now();
            existing.respondedAt = null;
            await existing.save();
            return res.status(200).json({ success: true, message: 'Connection request re-sent.' });
        }

        const conn = await LabConnection.create({ clinicId, labId, initiatedBy: 'lab' });
        res.status(201).json({ success: true, message: 'Connection request sent to clinic.', data: conn });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// ✅ CLINIC RESPONDS TO LAB CONNECTION (accept/reject)
// PATCH /api/lab-connect/clinic/:id/respond
// Body: { action: 'accept' | 'reject' }
// =============================================
exports.respondToConnectionByClinic = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { id } = req.params;
        const { action } = req.body;

        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: "action must be 'accept' or 'reject'." });
        }

        const conn = await LabConnection.findOne({ _id: id, clinicId });
        if (!conn) return res.status(404).json({ success: false, message: 'Connection request not found.' });

        if (conn.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'This request has already been responded to.' });
        }

        conn.status = action === 'accept' ? 'accepted' : 'rejected';
        conn.respondedAt = Date.now();
        await conn.save();

        res.status(200).json({ success: true, message: `Connection ${conn.status}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 📋 CLINIC GETS ALL LABS WITH CONNECTION STATUS
// GET /api/lab-connect/clinic/labs
// =============================================
exports.getAllLabsForClinic = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;

        // Fetch all active labs
        const labs = await IndependentLab.find({ isActive: true }).select('labName labCode address phone logo');

        // Fetch all connections for this clinic
        const connections = await LabConnection.find({ clinicId });

        // Map status to each lab
        const labData = labs.map(lab => {
            const conn = connections.find(c => c.labId.toString() === lab._id.toString());
            return {
                ...lab.toObject(),
                connectionStatus: conn ? conn.status : 'none',
                connectionId: conn ? conn._id : null,
                initiatedBy: conn ? conn.initiatedBy : null
            };
        });

        res.status(200).json({ success: true, data: labData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

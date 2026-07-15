const MedicalRecord = require('../models/MedicalRecord');
const StaffSession = require('../models/StaffSession');
const User = require('../models/User');
const { Parser } = require('json2csv');

exports.downloadClinicReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const clinicId = req.user.clinicId;

        // Build Filter
        let filter = { clinicId };
        if (startDate && endDate) {
            filter.visitDate = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const records = await MedicalRecord.find(filter)
            .populate('doctorId', 'name specialization')
            .sort({ visitDate: -1 });

        if (!records.length) {
            return res.status(404).json({ success: false, message: "No records found for this period." });
        }

        // Transform data for CSV
        const csvData = records.map(record => ({
            'Date': new Date(record.visitDate).toLocaleDateString(),
            'Patient Name': record.patientName,
            'Phone': record.patientPhone,
            'Doctor': record.doctorId?.name || 'N/A',
            'Specialization': record.doctorId?.specialization || 'N/A',
            'Duration (Min)': record.duration || 0,
            'Notes': record.notes?.replace(/\n/g, ' ') || ''
        }));

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(csvData);

        res.header('Content-Type', 'text/csv');
        res.attachment(`Clinic_Report_${new Date().toISOString().split('T')[0]}.csv`);
        return res.send(csv);

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getClinicDataPreview = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;
        const { startDate, endDate } = req.query;

        let medicalFilter = { clinicId };
        let sessionFilter = { clinicId };

        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999); // Include full end day

            medicalFilter.visitDate = { $gte: start, $lte: end };
            sessionFilter.loginTime = { $gte: start, $lte: end };
        }

        // Fetch Data in parallel
        const [medicalRecords, staffList, sessions] = await Promise.all([
            MedicalRecord.find(medicalFilter)
                .populate('doctorId', 'name specialization')
                .sort({ visitDate: -1 })
                .limit(startDate ? 1000 : 50), // Show more if filtered
            User.find({ clinicId, isActive: { $ne: false } })
                .select('-password')
                .sort({ role: 1 }),
            StaffSession.find(sessionFilter)
                .populate('staffId', 'name role')
                .sort({ loginTime: -1 })
                .limit(startDate ? 1000 : 100)
        ]);

        // Calculate Average Working Time per Staff within range
        const mongoose = require('mongoose');
        let statsMatch = { clinicId: new mongoose.Types.ObjectId(clinicId), logoutTime: { $exists: true } };
        if (startDate && endDate) {
            statsMatch.loginTime = { $gte: new Date(startDate), $lte: new Date(endDate) };
        }

        const staffStats = await StaffSession.aggregate([
            { $match: statsMatch },
            { $group: { 
                _id: "$staffId", 
                avgMinutes: { $avg: "$sessionDurationMinutes" },
                totalSessions: { $sum: 1 }
            }}
        ]);

        res.status(200).json({
            success: true,
            medicalRecords,
            staffList,
            sessions,
            staffStats
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
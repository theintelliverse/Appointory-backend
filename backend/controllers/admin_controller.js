const MedicalRecord = require('../models/MedicalRecord');
const { Parser } = require('json2csv'); // Install with: npm install json2csv

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

const User = require('../models/User');

exports.getClinicDataPreview = async (req, res) => {
    try {
        const clinicId = req.user.clinicId;

        // Fetch Medical History and Staff in parallel
        const [medicalRecords, staffList] = await Promise.all([
            MedicalRecord.find({ clinicId })
                .populate('doctorId', 'name specialization')
                .sort({ visitDate: -1 })
                .limit(50), // Limit preview for performance
            User.find({ clinicId, deletedAt: null })
                .select('-password')
                .sort({ role: 1 })
        ]);

        res.status(200).json({
            success: true,
            medicalRecords,
            staffList
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
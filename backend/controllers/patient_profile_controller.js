const Patient = require('../models/Patient');
const MedicalRecord = require('../models/MedicalRecord')
/**
 * @desc    Get current patient profile & medical history
 * @route   GET /api/patient/me
 * @access  Private (Patient)
 */
exports.getPatientProfile = async (req, res) => {
    try {
        console.log("👤 Token Payload:", req.user);

        if (!req.user || !req.user.phone) {
            return res.status(401).json({ success: false, message: "Invalid session." });
        }

        // 🔍 THE FIX: Clean the phone number and use Regex
        // This extracts the last 10 digits to ignore country codes
        const cleanPhone = req.user.phone.replace(/\D/g, '').slice(-10);
        const phoneRegex = new RegExp(cleanPhone + '$');

        console.log("🔍 Searching for normalized phone pattern:", cleanPhone);

        // 🚀 PERFORM DUAL LOOKUP using Regex
        const [regexMatchedProfiles, regexMatchedVisits] = await Promise.all([
            Patient.find({ phone: phoneRegex }).sort({ updatedAt: -1 }),
            MedicalRecord.find({ patientPhone: phoneRegex })
                .populate('clinicId', 'name address')
                .populate('doctorId', 'name specialization')
                .sort({ visitDate: -1 })
        ]);

        // Fallback for mixed formatting: normalize digits and match by last 10.
        let lockerProfiles = regexMatchedProfiles;
        if (!lockerProfiles || lockerProfiles.length === 0) {
            const allProfiles = await Patient.find({ phone: { $exists: true, $ne: null } })
                .select('name phone age gender bloodGroup documents vitals updatedAt')
                .sort({ updatedAt: -1 });

            lockerProfiles = allProfiles.filter((profile) => {
                const normalized = String(profile.phone || '').replace(/\D/g, '').slice(-10);
                return normalized === cleanPhone;
            });
        }

        const lockerProfile = lockerProfiles?.[0] || null;

        // Fallback for mixed formatting in MedicalRecord.patientPhone
        let visitHistory = regexMatchedVisits;
        if (!visitHistory || visitHistory.length === 0) {
            const allVisits = await MedicalRecord.find({ patientPhone: { $exists: true, $ne: null } })
                .populate('clinicId', 'name address')
                .populate('doctorId', 'name specialization')
                .sort({ visitDate: -1 });

            visitHistory = allVisits.filter((visit) => {
                const normalized = String(visit.patientPhone || '').replace(/\D/g, '').slice(-10);
                return normalized === cleanPhone;
            });
        }

        // Logic check: Allow either to exist
        if (!lockerProfile && (!visitHistory || visitHistory.length === 0)) {
            console.warn(`❌ No data found in either collection for: ${cleanPhone}`);
            return res.status(404).json({
                success: false,
                message: "No health records found for this number."
            });
        }

        // 🧩 MERGE DATA - Map MedicalRecord to medicalHistory format
        const medicalHistory = (visitHistory || []).map(visit => {
            const medicineData = visit.medicines || [];
            console.log(`📋 Visit ${visit._id} - Medicines:`, medicineData); // Debug log
            return {
                visitId: visit._id,
                date: visit.visitDate,
                doctorName: visit.doctorId?.name || 'Unknown Doctor',
                clinicName: visit.clinicId?.name || 'Unknown Clinic',
                diagnosis: visit.diagnosis || visit.notes?.split('\n')[0] || 'N/A',
                symptoms: visit.notes || '',
                prescription: visit.notes || '', // Use notes as prescription for now
                medicines: medicineData // Include medicines from MedicalRecord
            };
        });

        // 🧩 Merge documents from all matching patient profiles and dedupe
        const mergedDocuments = (lockerProfiles || []).flatMap((p) => p.documents || []);
        const toDocKey = (doc) => {
            if (doc?._id) return `id:${doc._id.toString()}`;
            if (doc?.publicId) return `public:${doc.publicId}`;
            return `url:${doc?.fileUrl || ''}`;
        };
        const documents = Array.from(
            new Map(mergedDocuments.map((doc) => [toDocKey(doc), doc])).values()
        ).sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));

        // 🧩 Merge vitals from all matching patient profiles (latest first)
        const vitals = (lockerProfiles || [])
            .flatMap((p) => p.vitals || [])
            .sort((a, b) => new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0));

        const responseData = {
            name: lockerProfile?.name || visitHistory[0]?.patientName || "Valued Patient",
            phone: req.user.phone,
            age: lockerProfile?.age,
            gender: lockerProfile?.gender,
            bloodGroup: lockerProfile?.bloodGroup,
            documents: documents,  // ✅ Changed from digitalLocker
            medicalHistory: medicalHistory,  // ✅ Changed from visitHistory
            vitals: vitals,  // ✅ Added vitals array
            lastUpdated: Date.now()
        };

        console.log(`✅ Success: Matched profiles: ${lockerProfiles.length}, Documents: ${documents.length}, Vitals: ${vitals.length}`);

        res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error("❌ Dual-Lookup Profile Error:", error.message);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @desc    Update Patient Basic Info (Optional future addition)
 */
exports.updatePatientProfile = async (req, res) => {
    try {
        const { name, dob, gender } = req.body;
        const updatedPatient = await Patient.findByIdAndUpdate(
            req.user.id,
            { name, dob, gender },
            { new: true }
        );

        // 📢 SOCKET UPDATE: If a doctor is currently viewing this patient's 
        // QuickView, the doctor's screen can update instantly.
        if (req.io && updatedPatient) {
            // We emit to the specific patient ID room
            req.io.to(updatedPatient._id.toString()).emit('patientProfileUpdated', updatedPatient);
        }

        res.status(200).json({ success: true, data: updatedPatient });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
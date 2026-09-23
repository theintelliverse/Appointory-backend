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

        if (!req.user || (!req.user.phone && !req.user.id)) {
            return res.status(401).json({ success: false, message: "Invalid session." });
        }

        const rawPhone = req.user.phone || '';
        const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, '').slice(-10) : '';
        const phoneRegex = cleanPhone ? new RegExp(cleanPhone + '$') : null;
        const patientId = req.user.id || req.user._id;

        console.log("🔍 Searching for patient profile:", { patientId, cleanPhone });

        // 🚀 PERFORM LOOKUP by ID first, then Phone
        let patientDoc = null;
        if (patientId) {
            try {
                patientDoc = await Patient.findById(patientId);
            } catch (idErr) {
                console.warn("Invalid ObjectId in token, falling back to phone query:", idErr.message);
            }
        }

        const [regexMatchedProfiles, regexMatchedVisits] = await Promise.all([
            phoneRegex ? Patient.find({ phone: phoneRegex }).sort({ updatedAt: -1 }) : Promise.resolve([]),
            phoneRegex ? MedicalRecord.find({ patientPhone: phoneRegex })
                .populate('clinicId', 'name address')
                .populate('doctorId', 'name specialization')
                .sort({ visitDate: -1 }) : Promise.resolve([])
        ]);

        let lockerProfiles = regexMatchedProfiles || [];
        if (patientDoc && !lockerProfiles.some(p => p._id.toString() === patientDoc._id.toString())) {
            lockerProfiles.unshift(patientDoc);
        }

        // Fallback for mixed formatting: normalize digits and match by last 10.
        if (cleanPhone && (!lockerProfiles || lockerProfiles.length === 0)) {
            const allProfiles = await Patient.find({ phone: { $exists: true, $ne: null } })
                .select('name phone age gender bloodGroup email address allergies dob documents vitals updatedAt')
                .sort({ updatedAt: -1 });

            lockerProfiles = allProfiles.filter((profile) => {
                const normalized = String(profile.phone || '').replace(/\D/g, '').slice(-10);
                return normalized === cleanPhone;
            });
        }

        const lockerProfile = patientDoc || lockerProfiles?.[0] || null;

        // Fallback for mixed formatting in MedicalRecord.patientPhone
        let visitHistory = regexMatchedVisits;
        if (cleanPhone && (!visitHistory || visitHistory.length === 0)) {
            const allVisits = await MedicalRecord.find({ patientPhone: { $exists: true, $ne: null } })
                .populate('clinicId', 'name address')
                .populate('doctorId', 'name specialization')
                .sort({ visitDate: -1 });

            visitHistory = allVisits.filter((visit) => {
                const normalized = String(visit.patientPhone || '').replace(/\D/g, '').slice(-10);
                return normalized === cleanPhone;
            });
        }

        // 🧩 MERGE DATA - Map MedicalRecord to medicalHistory format
        const medicalHistory = (visitHistory || []).map(visit => {
            const medicineData = visit.medicines || [];
            return {
                visitId: visit._id,
                date: visit.visitDate,
                doctorName: visit.doctorId?.name || 'Unknown Doctor',
                clinicName: visit.clinicId?.name || 'Unknown Clinic',
                diagnosis: visit.diagnosis || visit.notes?.split('\n')[0] || 'N/A',
                symptoms: visit.notes || '',
                prescription: visit.notes || '',
                medicines: medicineData
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
            _id: lockerProfile?._id || patientId,
            name: lockerProfile?.name || visitHistory[0]?.patientName || req.user.name || "Valued Patient",
            phone: lockerProfile?.phone || cleanPhone || req.user.phone,
            email: lockerProfile?.email || "",
            age: lockerProfile?.age || null,
            gender: lockerProfile?.gender || null,
            bloodGroup: lockerProfile?.bloodGroup || null,
            address: lockerProfile?.address || "",
            allergies: lockerProfile?.allergies || "",
            dob: lockerProfile?.dob || null,
            documents: documents,
            medicalHistory: medicalHistory,
            visitHistory: medicalHistory,
            vitals: vitals,
            lastUpdated: Date.now()
        };

        console.log(`✅ Success: Matched profiles: ${lockerProfiles.length}, Documents: ${documents.length}, Vitals: ${vitals.length}`);

        return res.status(200).json({
            success: true,
            data: responseData
        });

    } catch (error) {
        console.error("❌ Dual-Lookup Profile Error:", error.message);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @desc    Update Patient Basic Info
 */
exports.updatePatientProfile = async (req, res) => {
    try {
        const { name, age, gender, bloodGroup, bio, email, address, allergies, dob } = req.body;
        
        // Find patient by ID or Phone (from token)
        const patientId = req.user.id || req.user._id;
        const rawPhone = req.user.phone || '';
        const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);
        const phoneRegex = cleanPhone ? new RegExp(cleanPhone + '$') : null;

        let patient = null;
        if (patientId) {
            try {
                patient = await Patient.findById(patientId);
            } catch (e) {
                console.warn("Could not find patient by ObjectId:", e.message);
            }
        }

        if (!patient && phoneRegex) {
            patient = await Patient.findOne({ phone: phoneRegex });
        }

        if (!patient && cleanPhone) {
            patient = await Patient.findOne({ phone: cleanPhone });
        }

        if (!patient) {
            // Create patient record if it didn't exist yet for this authenticated user
            patient = new Patient({
                phone: cleanPhone || rawPhone,
                name: name || "Valued Patient"
            });
        }

        // Update fields
        if (name !== undefined) patient.name = name;
        if (age !== undefined) patient.age = age ? parseInt(age) : null;
        if (gender !== undefined) patient.gender = gender;
        if (bloodGroup !== undefined) patient.bloodGroup = bloodGroup;
        if (bio !== undefined) patient.bio = bio;
        if (email !== undefined) patient.email = email;
        if (address !== undefined) patient.address = address;
        if (allergies !== undefined) patient.allergies = allergies;
        if (dob !== undefined) patient.dob = dob;

        await patient.save();

        // 📢 SOCKET UPDATE: If a doctor or client is currently listening
        if (req.io && patient) {
            req.io.to(patient._id.toString()).emit('patientProfileUpdated', patient);
        }

        return res.status(200).json({ 
            success: true, 
            message: "Profile updated successfully",
            data: {
                _id: patient._id,
                name: patient.name,
                phone: patient.phone,
                email: patient.email,
                age: patient.age,
                gender: patient.gender,
                bloodGroup: patient.bloodGroup,
                address: patient.address,
                allergies: patient.allergies,
                dob: patient.dob
            }
        });
    } catch (error) {
        console.error("Update patient profile error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Upload a document/report to patient's Health Locker
 * @route   POST /api/auth/patient/upload-document
 * @access  Private (Patient)
 */
exports.uploadDocument = async (req, res) => {
    try {
        const patientId = req.user.id;
        const cleanPhone = req.user.phone.replace(/\D/g, '').slice(-10);
        const phoneRegex = new RegExp(cleanPhone + '$');

        let patient = await Patient.findById(patientId);
        if (!patient) {
            patient = await Patient.findOne({ phone: phoneRegex });
        }

        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient profile not found" });
        }

        // File is processed by multer-storage-cloudinary and available as req.file
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const { title, fileType } = req.body;

        const newDocument = {
            title: title || req.file.originalname || 'Health Document',
            fileUrl: req.file.path, // Cloudinary secure URL
            fileType: fileType || (req.file.mimetype?.includes('pdf') ? 'PDF' : 'Image'),
            uploadedAt: new Date()
        };

        patient.documents.push(newDocument);
        await patient.save();

        res.status(201).json({
            success: true,
            message: "Document uploaded successfully",
            data: newDocument
        });
    } catch (error) {
        console.error('Upload Document Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Mark a patient's appointment as Cancelled by queueId
 * @route   PATCH /api/auth/patient/cancel-appointment/:queueId
 * @access  Private (Patient)
 */
exports.cancelAppointmentStatus = async (req, res) => {
    try {
        const { queueId } = req.params;
        const patientId = req.user.id;
        const cleanPhone = req.user.phone.replace(/\D/g, '').slice(-10);
        const phoneRegex = new RegExp(cleanPhone + '$');

        let patient = await Patient.findById(patientId);
        if (!patient) {
            patient = await Patient.findOne({ phone: phoneRegex });
        }

        if (!patient) {
            return res.status(404).json({ success: false, message: "Patient not found" });
        }

        // Find the appointment in the patient's appointments array
        const appointment = patient.appointments.find(
            (a) => a.queueId?.toString() === queueId || a._id?.toString() === queueId
        );

        if (appointment) {
            appointment.status = 'Cancelled';
            await patient.save();
        }

        res.status(200).json({ success: true, message: "Appointment cancelled" });
    } catch (error) {
        console.error('Cancel Appointment Status Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
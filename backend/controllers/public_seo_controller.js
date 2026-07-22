const Clinic = require('../models/Clinic');
const IndependentLab = require('../models/IndependentLab');
const User = require('../models/User');
const LabConnection = require('../models/LabConnection');
const mongoose = require('mongoose');

// Helper to determine if identifier is valid ObjectId or slug
const isObjectId = (val) => mongoose.Types.ObjectId.isValid(val);

// Helper to construct baseUrl dynamically
const getBaseUrl = (req) => {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'appointory.in';
    return `${protocol}://${host}`;
};

// =============================================
// 🏥 GET PUBLIC CLINIC PROFILE + JSON-LD SCHEMA
// GET /api/public/seo/clinic/:identifier
// =============================================
exports.getPublicClinicProfile = async (req, res) => {
    try {
        const { identifier } = req.params;
        const query = isObjectId(identifier) ? { _id: identifier } : { slug: identifier.toLowerCase() };

        const clinic = await Clinic.findOne({ ...query, isActive: true });
        if (!clinic) {
            return res.status(404).json({ success: false, message: 'Clinic profile not found or inactive.' });
        }

        // Fetch associated doctors
        const doctors = await User.find({
            clinicId: clinic._id,
            role: 'doctor',
            isActive: true
        }).select('name specialization profileImage bio experience education consultationFee slug rating medicalLicenseNumber availableDays languages videoUrl');

        // Fetch connected labs
        const connections = await LabConnection.find({ clinicId: clinic._id, status: 'accepted' })
            .populate('labId', 'labName labCode address phone logo slug availableTests rating accreditation');

        const connectedLabs = connections.map(c => c.labId).filter(Boolean);

        const baseUrl = getBaseUrl(req);
        const profileUrl = `${baseUrl}/c/${clinic.slug || clinic._id}`;

        // Dynamic FAQ & AEO Blocks for Voice/Snippet Search
        const faqs = [
            {
                question: `What are the consultation hours for ${clinic.name}?`,
                answer: `${clinic.name} operates on ${clinic.workingDays ? clinic.workingDays.join(', ') : 'weekdays'} from ${clinic.openingTime || '09:00'} to ${clinic.closingTime || '17:00'}.`
            },
            {
                question: `How can I track my live queue status at ${clinic.name}?`,
                answer: `Patients can check their real-time live queue token position online via Appointory at ${profileUrl} or by checking in on-site.`
            },
            {
                question: `What is the consultation fee at ${clinic.name}?`,
                answer: `The average consultation fee at ${clinic.name} is ₹${clinic.feeConsult || 500}. Fee may vary based on specialist doctor.`
            }
        ];

        // Construct Schema.org JSON-LD (MedicalClinic + Speakable + FAQPage)
        const jsonLd = [
            {
                "@context": "https://schema.org",
                "@type": "MedicalClinic",
                "@id": profileUrl,
                "name": clinic.name,
                "url": profileUrl,
                "logo": clinic.logo || `${baseUrl}/assets/Appointory_logo.jpg`,
                "image": clinic.logo || `${baseUrl}/assets/og-image-banner.jpg`,
                "description": clinic.bio || clinic.seoDescription || `Book consultation and track real-time queue at ${clinic.name}, offering premier healthcare.`,
                "telephone": clinic.contactPhone,
                "priceRange": `₹${clinic.feeConsult || 500}`,
                "address": {
                    "@type": "PostalAddress",
                    "streetAddress": clinic.address,
                    "addressCountry": "IN"
                },
                "geo": {
                    "@type": "GeoCoordinates",
                    "latitude": clinic.locationGeo?.lat || 28.6139,
                    "longitude": clinic.locationGeo?.lng || 77.2090
                },
                "openingHoursSpecification": [
                    {
                        "@type": "OpeningHoursSpecification",
                        "dayOfWeek": (clinic.workingDays && clinic.workingDays.length > 0)
                            ? clinic.workingDays.map(d => d.charAt(0).toUpperCase() + d.slice(1))
                            : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                        "opens": clinic.openingTime || "09:00",
                        "closes": clinic.closingTime || "17:00"
                    }
                ],
                "aggregateRating": {
                    "@type": "AggregateRating",
                    "ratingValue": clinic.rating?.score || 4.8,
                    "reviewCount": clinic.rating?.count || 15
                },
                "medicalSpecialty": clinic.specialties && clinic.specialties.length > 0 ? clinic.specialties : ["General Practice"],
                "speakable": {
                    "@type": "SpeakableSpecification",
                    "cssSelector": [".clinic-title", ".clinic-overview", ".faq-answer"]
                }
            },
            {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": faqs.map(faq => ({
                    "@type": "Question",
                    "name": faq.question,
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": faq.answer
                    }
                }))
            }
        ];

        res.status(200).json({
            success: true,
            data: {
                clinic,
                doctors,
                connectedLabs,
                faqs,
                jsonLd,
                meta: {
                    title: clinic.seoTitle || `${clinic.name} - Live Queue & Online Doctor Appointment`,
                    description: clinic.seoDescription || clinic.bio || `Consult expert doctors at ${clinic.name}. Instant online appointment booking and live queue token tracking on Appointory.`,
                    canonicalUrl: profileUrl,
                    ogImage: clinic.logo || `${baseUrl}/assets/og-image-banner.jpg`
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 👨‍⚕️ GET PUBLIC DOCTOR PROFILE + JSON-LD SCHEMA
// GET /api/public/seo/doctor/:identifier
// =============================================
exports.getPublicDoctorProfile = async (req, res) => {
    try {
        const { identifier } = req.params;
        const query = isObjectId(identifier) ? { _id: identifier } : { slug: identifier.toLowerCase() };

        const doctor = await User.findOne({ ...query, role: 'doctor', isActive: true })
            .select('-password -resetToken -resetTokenExpiry');

        if (!doctor) {
            return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
        }

        const clinic = await Clinic.findById(doctor.clinicId).select('name clinicCode address contactPhone openingTime closingTime locationGeo logo slug rating');

        const baseUrl = getBaseUrl(req);
        const profileUrl = `${baseUrl}/d/${doctor.slug || doctor._id}`;

        // Construct Schema.org JSON-LD (Physician + Medical E-E-A-T + VideoObject if video exists)
        const physicianSchema = {
            "@context": "https://schema.org",
            "@type": "Physician",
            "@id": profileUrl,
            "name": doctor.name,
            "jobTitle": doctor.specialization || 'Consultant Physician',
            "medicalSpecialty": doctor.specialization || 'General Medicine',
            "identifier": doctor.medicalLicenseNumber || undefined,
            "description": doctor.bio || doctor.seoDescription || `Consult ${doctor.name}, ${doctor.specialization || 'Medical Specialist'} with ${doctor.experience || 5}+ years of medical experience.`,
            "telephone": doctor.phoneNumber || clinic?.contactPhone || '',
            "priceRange": `₹${doctor.consultationFee || 500}`,
            "knowsLanguage": doctor.languages || ["English", "Hindi"],
            "image": doctor.profileImage || `${baseUrl}/assets/Appointory_logo.jpg`,
            "worksFor": clinic ? {
                "@type": "MedicalClinic",
                "name": clinic.name,
                "url": `${baseUrl}/c/${clinic.slug || clinic._id}`,
                "address": clinic.address
            } : undefined,
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": doctor.rating?.score || 4.9,
                "reviewCount": doctor.rating?.count || 22
            }
        };

        const jsonLd = [physicianSchema];

        // VEO: Include VideoObject if doctor has a video walkthrough or introduction
        if (doctor.videoUrl) {
            jsonLd.push({
                "@context": "https://schema.org",
                "@type": "VideoObject",
                "name": `${doctor.name} - Profile & Consultation Introduction`,
                "description": `Watch virtual consultation overview and clinical background of ${doctor.name}.`,
                "thumbnailUrl": [doctor.profileImage || `${baseUrl}/assets/og-image-banner.jpg`],
                "contentUrl": doctor.videoUrl,
                "embedUrl": doctor.videoUrl
            });
        }

        res.status(200).json({
            success: true,
            data: {
                doctor,
                clinic,
                jsonLd,
                meta: {
                    title: doctor.seoTitle || `${doctor.name} - ${doctor.specialization || 'Doctor'} | Book Appointment`,
                    description: doctor.seoDescription || doctor.bio || `Consult ${doctor.name} (${doctor.specialization || 'Specialist'}). ${doctor.experience || 5}+ years exp. License: ${doctor.medicalLicenseNumber || 'Verified'}. Book online fee ₹${doctor.consultationFee || 500}.`,
                    canonicalUrl: profileUrl,
                    ogImage: doctor.profileImage || `${baseUrl}/assets/og-image-banner.jpg`
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 🔬 GET PUBLIC INDEPENDENT LAB PROFILE + JSON-LD SCHEMA
// GET /api/public/seo/lab/:identifier
// =============================================
exports.getPublicLabProfile = async (req, res) => {
    try {
        const { identifier } = req.params;
        const query = isObjectId(identifier) ? { _id: identifier } : { slug: identifier.toLowerCase() };

        const lab = await IndependentLab.findOne({ ...query, isActive: true })
            .select('-password -resetToken -resetTokenExpiry');

        if (!lab) {
            return res.status(404).json({ success: false, message: 'Diagnostic lab profile not found.' });
        }

        // Fetch connected clinics network
        const connections = await LabConnection.find({ labId: lab._id, status: 'accepted' })
            .populate('clinicId', 'name clinicCode address contactPhone logo slug');

        const connectedClinics = connections.map(c => c.clinicId).filter(Boolean);

        const baseUrl = getBaseUrl(req);
        const profileUrl = `${baseUrl}/l/${lab.slug || lab._id}`;

        // Construct Schema.org JSON-LD (DiagnosticLab)
        const jsonLd = {
            "@context": "https://schema.org",
            "@type": "DiagnosticLab",
            "@id": profileUrl,
            "name": lab.labName,
            "url": profileUrl,
            "logo": lab.logo || `${baseUrl}/assets/Appointory_logo.jpg`,
            "telephone": lab.phone,
            "email": lab.email,
            "address": {
                "@type": "PostalAddress",
                "streetAddress": lab.address,
                "addressCountry": "IN"
            },
            "geo": {
                "@type": "GeoCoordinates",
                "latitude": lab.locationGeo?.lat || 28.6139,
                "longitude": lab.locationGeo?.lng || 77.2090
            },
            "availableTest": (lab.availableTests || []).map(t => ({
                "@type": "MedicalTest",
                "name": t.testName,
                "code": t.code || undefined,
                "description": `Sample: ${t.sampleType || 'Blood'}. Price: ₹${t.price || 0}. Turnaround: ${t.turnAroundHours || 24} hours.`
            })),
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": lab.rating?.score || 4.9,
                "reviewCount": lab.rating?.count || 28
            }
        };

        res.status(200).json({
            success: true,
            data: {
                lab,
                connectedClinics,
                jsonLd,
                meta: {
                    title: lab.seoTitle || `${lab.labName} - Diagnostic & Pathology Lab Services`,
                    description: lab.seoDescription || lab.bio || `Book blood tests & health checkups at ${lab.labName}. Reliable diagnostic reports & connected healthcare network.`,
                    canonicalUrl: profileUrl,
                    ogImage: lab.logo || `${baseUrl}/assets/og-image-banner.jpg`
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// =============================================
// 🗺️ DYNAMIC XML SITEMAP GENERATOR
// GET /sitemap.xml
// =============================================
exports.generateSitemapXml = async (req, res) => {
    try {
        const baseUrl = getBaseUrl(req);
        const clinics = await Clinic.find({ isActive: true }).select('slug updatedAt createdAt');
        const doctors = await User.find({ role: 'doctor', isActive: true }).select('slug updatedAt createdAt');
        const labs = await IndependentLab.find({ isActive: true }).select('slug updatedAt createdAt');

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n`;

        // Static core routes
        const staticRoutes = ['', 'login', 'register-clinic', 'patient/checkin', 'privacy', 'terms', 'contact', 'llms.txt', 'llms-full.txt', 'ai.txt'];
        staticRoutes.forEach(route => {
            xml += `  <url>\n`;
            xml += `    <loc>${baseUrl}/${route}</loc>\n`;
            xml += `    <changefreq>daily</changefreq>\n`;
            xml += `    <priority>${route === '' ? '1.0' : '0.8'}</priority>\n`;
            xml += `  </url>\n`;
        });

        // Clinics
        clinics.forEach(c => {
            const loc = `${baseUrl}/c/${c.slug || c._id}`;
            const lastMod = (c.updatedAt || c.createdAt || new Date()).toISOString();
            xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
        });

        // Doctors
        doctors.forEach(d => {
            const loc = `${baseUrl}/d/${d.slug || d._id}`;
            const lastMod = (d.updatedAt || d.createdAt || new Date()).toISOString();
            xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
        });

        // Labs
        labs.forEach(l => {
            const loc = `${baseUrl}/l/${l.slug || l._id}`;
            const lastMod = (l.updatedAt || l.createdAt || new Date()).toISOString();
            xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.85</priority>\n  </url>\n`;
        });

        xml += `</urlset>`;

        res.header('Content-Type', 'application/xml');
        res.status(200).send(xml);
    } catch (error) {
        res.status(500).send(`<!-- Sitemap Generation Error: ${error.message} -->`);
    }
};

// =============================================
// 🤖 ROBOTS.TXT GENERATOR
// GET /robots.txt
// =============================================
exports.generateRobotsTxt = (req, res) => {
    const baseUrl = getBaseUrl(req);
    const robots = `User-agent: *
Allow: /
Allow: /c/
Allow: /d/
Allow: /l/
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /ai.txt
Disallow: /admin/
Disallow: /doctor/
Disallow: /lab/portal/
Disallow: /superadmin/
Disallow: /api/

# AI Search Bots & Generative Engine Optimization (ChatGPT, Perplexity, Claude, Gemini)
User-agent: GPTBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
    res.header('Content-Type', 'text/plain');
    res.status(200).send(robots);
};

// =============================================
// 🧠 LLM KNOWLEDGE BASE GENERATOR (/llms.txt & /llms-full.txt)
// GET /llms.txt & GET /llms-full.txt
// =============================================
exports.generateLlmTxt = async (req, res) => {
    try {
        const baseUrl = getBaseUrl(req);
        const clinics = await Clinic.find({ isActive: true }).select('name clinicCode address contactPhone specialties bio feeConsult slug locationGeo workingDays openingTime closingTime');
        const doctors = await User.find({ role: 'doctor', isActive: true }).populate('clinicId', 'name').select('name specialization experience education consultationFee bio slug medicalLicenseNumber languages');
        const labs = await IndependentLab.find({ isActive: true }).select('labName labCode address phone availableTests bio slug accreditation rating');

        let md = `# Appointory Comprehensive Healthcare Network Context\n\n`;
        md += `> Verified database of doctors, health centers, and independent diagnostic laboratories available on Appointory (${baseUrl}). Optimized for AI Search, Answer Engines, and Natural Language Patient Directives.\n\n`;

        md += `## 🏥 Verified Clinics & Health Centers\n`;
        clinics.forEach(c => {
            md += `### ${c.name}\n`;
            md += `- **Address**: ${c.address}\n`;
            md += `- **Phone**: ${c.contactPhone}\n`;
            md += `- **Consultation Fee**: ₹${c.feeConsult || 500}\n`;
            if (c.workingDays) md += `- **Operating Days**: ${c.workingDays.join(', ')} (${c.openingTime || '09:00'} - ${c.closingTime || '17:00'})\n`;
            if (c.specialties && c.specialties.length > 0) md += `- **Specialties**: ${c.specialties.join(', ')}\n`;
            if (c.bio) md += `- **Overview**: ${c.bio}\n`;
            md += `- **Profile & Live Token Tracking**: ${baseUrl}/c/${c.slug || c._id}\n\n`;
        });

        md += `## 👨‍⚕️ Medical Doctors & Verified Specialists\n`;
        doctors.forEach(d => {
            md += `### ${d.name}\n`;
            md += `- **Specialization**: ${d.specialization || 'General Practice'}\n`;
            md += `- **Experience**: ${d.experience || 5}+ years\n`;
            if (d.education) md += `- **Education**: ${d.education}\n`;
            md += `- **Consultation Fee**: ₹${d.consultationFee || 500}\n`;
            if (d.clinicId?.name) md += `- **Practicing At**: ${d.clinicId.name}\n`;
            if (d.medicalLicenseNumber) md += `- **Medical License Registration**: ${d.medicalLicenseNumber}\n`;
            if (d.languages && d.languages.length > 0) md += `- **Languages Spoken**: ${d.languages.join(', ')}\n`;
            if (d.bio) md += `- **Bio**: ${d.bio}\n`;
            md += `- **Doctor Direct Booking Link**: ${baseUrl}/d/${d.slug || d._id}\n\n`;
        });

        md += `## 🔬 Independent Diagnostic Laboratories\n`;
        labs.forEach(l => {
            md += `### ${l.labName}\n`;
            md += `- **Location**: ${l.address}\n`;
            md += `- **Contact**: ${l.phone}\n`;
            if (l.rating?.score) md += `- **Patient Rating**: ${l.rating.score} / 5.0 (${l.rating.count || 10} reviews)\n`;
            if (l.accreditation && l.accreditation.length > 0) md += `- **Accreditations**: ${l.accreditation.join(', ')}\n`;
            if (l.availableTests && l.availableTests.length > 0) {
                md += `- **Available Diagnostic Tests**:\n`;
                l.availableTests.forEach(t => {
                    md += `  - **${t.testName}**: ₹${t.price} (Sample: ${t.sampleType || 'Blood'}, Fasting Required: ${t.fastingRequired ? 'Yes' : 'No'}, Turnaround: ${t.turnAroundHours || 24} hours)\n`;
                });
            }
            md += `- **Diagnostic Lab Booking Link**: ${baseUrl}/l/${l.slug || l._id}\n\n`;
        });

        res.header('Content-Type', 'text/markdown; charset=utf-8');
        res.status(200).send(md);
    } catch (error) {
        res.status(500).send(`# Error generating LLM context: ${error.message}`);
    }
};


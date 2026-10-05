/**
 * Churn Early-Warning Job
 * Runs daily at 09:00 AM IST.
 * 
 * Identifies clinics with zero appointments in the past 7 days,
 * triggering an immediate triage alert for founder outreach within 48 hours.
 */

const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');

async function checkDailyChurnRisk() {
    console.log('🚨 Running Daily Churn Early-Warning Check...');

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

    const activeClinics = await Clinic.find({ isActive: true });
    const silentClinics = [];

    for (const clinic of activeClinics) {
        const recentCount = await Queue.countDocuments({
            clinicId: clinic._id,
            createdAt: { $gte: sevenDaysAgo }
        });

        if (recentCount === 0) {
            silentClinics.push({
                name: clinic.name,
                code: clinic.clinicCode,
                phone: clinic.contactPhone,
                createdAt: clinic.createdAt
            });
        }
    }

    if (silentClinics.length > 0) {
        console.log(`⚠️ [CHURN ALERT] ${silentClinics.length} clinics recorded ZERO appointments in the last 7 days:`);
        silentClinics.forEach((c, idx) => {
            console.log(`  ${idx + 1}. ${c.name} (${c.code}) - Phone: ${c.phone} | Created: ${new Date(c.createdAt).toLocaleDateString()}`);
        });
    } else {
        console.log('✅ All active clinics have recorded activity in the last 7 days.');
    }

    return silentClinics;
}

module.exports = { checkDailyChurnRisk };

/**
 * Weekly Summary & Founder Monday KPI Job
 * Runs every Monday at 08:00 AM IST.
 * 
 * 1. Generates Clinic Admin Digest (last 7 days appointments, no-show rate, new patients)
 * 2. Generates Founder Operating KPI Report (network volume, active clinics, at-risk clinics)
 */

const Queue = require('../models/Queue');
const Clinic = require('../models/Clinic');
const User = require('../models/User');

async function generateWeeklySummaries() {
    console.log('📊 Running Monday Weekly Performance Summary...');

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);

    const clinics = await Clinic.find({ isActive: true });
    const atRiskClinics = [];
    let networkAppointmentsLast7 = 0;
    let networkAppointmentsPrev7 = 0;
    let activeClinicsCount = 0;

    for (const clinic of clinics) {
        // Last 7 days queue records
        const last7Records = await Queue.find({
            clinicId: clinic._id,
            createdAt: { $gte: sevenDaysAgo, $lte: now }
        });

        // Previous 7-14 days queue records (for trend comparison)
        const prev7Records = await Queue.find({
            clinicId: clinic._id,
            createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo }
        });

        const totalLast7 = last7Records.length;
        const totalPrev7 = prev7Records.length;
        networkAppointmentsLast7 += totalLast7;
        networkAppointmentsPrev7 += totalPrev7;

        if (totalLast7 > 0) activeClinicsCount++;

        // At-risk detection: 0 bookings or >= 50% drop
        if (totalPrev7 > 0 && totalLast7 <= totalPrev7 * 0.5) {
            atRiskClinics.push({
                name: clinic.name,
                code: clinic.clinicCode,
                phone: clinic.contactPhone,
                last7: totalLast7,
                prev7: totalPrev7,
                drop: `${Math.round(((totalPrev7 - totalLast7) / totalPrev7) * 100)}%`
            });
        }

        const completedCount = last7Records.filter(r => r.status === 'Completed').length;
        const skippedCount = last7Records.filter(r => r.status === 'Skipped').length;
        const noShowRate = totalLast7 > 0 ? `${Math.round((skippedCount / totalLast7) * 100)}%` : '0%';

        console.log(`[CLINIC DIGEST] ${clinic.name} (${clinic.clinicCode}): Total: ${totalLast7} | Completed: ${completedCount} | Skipped: ${skippedCount} (${noShowRate})`);
    }

    const wowGrowth = networkAppointmentsPrev7 > 0
        ? `${Math.round(((networkAppointmentsLast7 - networkAppointmentsPrev7) / networkAppointmentsPrev7) * 100)}%`
        : 'N/A';

    console.log('\n======================================================');
    console.log('             FOUNDER MONDAY OPERATING KPI             ');
    console.log('======================================================');
    console.log(`Date:                          ${now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    console.log(`Active Clinics (>=1 appt):     ${activeClinicsCount} / ${clinics.length}`);
    console.log(`Total Appointments (7 Days):   ${networkAppointmentsLast7}`);
    console.log(`Previous 7-Day Appointments:   ${networkAppointmentsPrev7}`);
    console.log(`Week-over-Week Volume Growth:  ${wowGrowth}`);
    console.log(`At-Risk Clinics Count:         ${atRiskClinics.length}`);
    console.log('======================================================\n');

    if (atRiskClinics.length > 0) {
        console.log('⚠️ At-Risk Clinics (Outreach required within 48h):');
        atRiskClinics.forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.name} (${c.code}): ${c.prev7} -> ${c.last7} appointments (Drop: ${c.drop}) | Phone: ${c.phone}`);
        });
    }

    return {
        activeClinicsCount,
        networkAppointmentsLast7,
        wowGrowth,
        atRiskClinics
    };
}

module.exports = { generateWeeklySummaries };

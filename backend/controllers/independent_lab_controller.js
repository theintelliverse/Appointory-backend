const IndependentLab = require('../models/IndependentLab');
const Otp = require('../models/Otp');
const { generateToken, hashPassword, comparePassword } = require('../utils/auth_helper');
const { sendEmail } = require('../utils/send_email');
const sendSMS = require('../utils/send_sms');
const crypto = require('crypto');

/**
 * @desc    Register a new Independent Lab
 * @route   POST /api/auth/lab/register
 */
exports.registerLab = async (req, res) => {
    try {
        const { labName, labCode, email, password, phone, address, emailOtp, smsOtp } = req.body;

        if (!labName || !labCode || !email || !password || !phone || !address) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        const existingCode = await IndependentLab.findOne({ labCode: labCode.toUpperCase() });
        if (existingCode) {
            return res.status(400).json({ success: false, message: 'Lab Code already taken. Choose a different one.' });
        }

        const existingEmail = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (existingEmail) {
            return res.status(400).json({ success: false, message: 'Email is already registered.' });
        }

        const cleanPhone = phone.replace(/\D/g, '').slice(-10);

        if (!emailOtp || !smsOtp) {
            const generatedEmailOtp = Math.floor(100000 + Math.random() * 900000).toString();
            const generatedSmsOtp = Math.floor(100000 + Math.random() * 900000).toString();

            await Otp.findOneAndUpdate(
                { identifier: email.toLowerCase(), type: 'lab_registration' },
                {
                    otp: `${generatedEmailOtp}:${generatedSmsOtp}`,
                    expiresAt: new Date(Date.now() + 600000) // 10 minutes
                },
                { upsert: true, new: true }
            );

            // Send Email verification code
            const emailSubject = "🧪 Appointory Lab Onboarding - Email Verification Code";
            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 12px; padding: 25px;">
                    <h2 style="color: #1B6CA8; margin-top: 0;">Verify Your Lab Registration</h2>
                    <p>Hello,</p>
                    <p>Thank you for registering <strong>${labName}</strong> on Appointory Lab Network.</p>
                    <div style="background-color: #f1f5f9; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                        <p style="margin: 0; font-size: 14px; color: #475569;">Your Email Verification Code is:</p>
                        <h1 style="margin: 10px 0 0 0; color: #1B6CA8; font-size: 32px; letter-spacing: 4px;">${generatedEmailOtp}</h1>
                        <p style="margin: 5px 0 0 0; font-size: 12px; color: #94a3b8;">Valid for 10 minutes</p>
                    </div>
                </div>
            `;
            await sendEmail(email, emailSubject, emailHtml);

            // Send SMS verification code
            const smsMessage = `Your Appointory lab registration SMS verification code is: ${generatedSmsOtp}. Valid for 10 minutes.`;
            await sendSMS(cleanPhone, smsMessage);

            return res.status(200).json({
                success: true,
                verificationRequired: true,
                message: "Verification codes sent to your email and phone number.",
                debugOtp: process.env.NODE_ENV === 'development' ? { emailOtp: generatedEmailOtp, smsOtp: generatedSmsOtp } : undefined
            });
        }

        const storedOtpDoc = await Otp.findOne({ identifier: email.toLowerCase(), type: 'lab_registration' });
        if (!storedOtpDoc || storedOtpDoc.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: "Verification codes expired or invalid. Please request new codes." });
        }

        const [expectedEmailOtp, expectedSmsOtp] = (storedOtpDoc.otp || '').split(':');
        if (expectedEmailOtp !== emailOtp || expectedSmsOtp !== smsOtp) {
            return res.status(400).json({ success: false, message: "Invalid email or SMS verification code. Please check and try again." });
        }

        await Otp.deleteOne({ _id: storedOtpDoc._id });

        const hashedPassword = await hashPassword(password);

        const SystemConfig = require('../models/SystemConfig');
        const systemConfig = await SystemConfig.findOne();
        const trialDays = systemConfig ? (systemConfig.trialPeriodDays ?? 30) : 30;

        const trialExpiry = new Date();
        trialExpiry.setDate(trialExpiry.getDate() + trialDays);

        const lab = await IndependentLab.create({
            labName,
            labCode: labCode.toUpperCase(),
            email: email.toLowerCase(),
            password: hashedPassword,
            phone: cleanPhone,
            address,
            subscriptionPlan: 'independent-lab',
            subscriptionExpiresAt: trialExpiry,
            approvalStatus: 'pending',
            isActive: false
        });

        // 📢 Send confirmation email to lab & alert email to Super Admin
        const { sendRegistrationPendingEmails } = require('../utils/send_email');
        sendRegistrationPendingEmails({
            facilityName: lab.labName,
            facilityType: 'lab',
            facilityCode: lab.labCode,
            contactEmail: lab.email,
            contactPhone: lab.phone,
            address: lab.address
        }).catch(err => console.error('Failed to send lab pending emails:', err.message));

        res.status(201).json({
            success: true,
            message: 'Lab registered successfully! Your registration is pending Super Admin approval.',
            labCode: lab.labCode,
            approvalStatus: 'pending'
        });
    } catch (error) {
        console.error('❌ Lab Register Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Independent Lab Login
 * @route   POST /api/auth/lab/login
 */
exports.loginLab = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const lab = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (!lab) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        if (lab.approvalStatus === 'pending') {
            return res.status(403).json({
                success: false,
                isPendingApproval: true,
                message: 'Your lab registration is pending Super Admin approval. Please wait for approval.',
                facility: {
                    name: lab.labName,
                    code: lab.labCode,
                    email: lab.email,
                    type: 'lab',
                    registeredAt: lab.createdAt
                }
            });
        }

        if (lab.approvalStatus === 'rejected') {
            return res.status(403).json({
                success: false,
                isRejected: true,
                message: 'Your lab registration request was rejected by Super Admin. Please contact support.',
                facility: {
                    name: lab.labName,
                    code: lab.labCode,
                    type: 'lab'
                }
            });
        }

        if (!lab.isActive) {
            return res.status(403).json({ success: false, message: 'This lab account has been deactivated.' });
        }

        const isMatch = await comparePassword(password, lab.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        // Generate token with role = 'independent_lab'
        const token = generateToken({
            _id: lab._id,
            role: 'independent_lab',
            clinicId: null
        });

        res.status(200).json({
            success: true,
            token,
            lab: {
                id: lab._id,
                labName: lab.labName,
                labCode: lab.labCode,
                email: lab.email,
                phone: lab.phone,
                address: lab.address,
                logo: lab.logo
            }
        });

    } catch (error) {
        console.error('❌ Lab Login Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get current lab profile
 * @route   GET /api/auth/lab/me
 */
exports.getLabMe = async (req, res) => {
    try {
        const lab = await IndependentLab.findById(req.lab.id).select('-password -resetToken -resetTokenExpiry');
        if (!lab) return res.status(404).json({ success: false, message: 'Lab not found.' });

        res.status(200).json({ success: true, data: lab });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update lab profile
 * @route   PATCH /api/auth/lab/update-profile
 */
exports.updateLabProfile = async (req, res) => {
    try {
        const { labName, phone, address, logo } = req.body;

        const updated = await IndependentLab.findByIdAndUpdate(
            req.lab.id,
            { labName, phone, address, logo },
            { new: true, runValidators: true }
        ).select('-password -resetToken -resetTokenExpiry');

        if (!updated) return res.status(404).json({ success: false, message: 'Lab not found.' });

        res.status(200).json({ success: true, message: 'Profile updated.', data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Forgot password — send reset email to lab
 * @route   POST /api/auth/lab/forgot-password
 */
exports.labForgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });

        const lab = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (!lab) {
            // Don't reveal whether email exists
            return res.status(200).json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        lab.resetToken = resetToken;
        lab.resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour
        await lab.save();

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
        const resetLink = `${frontendUrl}/lab/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

        await sendEmail(
            email,
            '🔐 Lab Portal — Password Reset',
            `<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,#0F4C75,#1B6CA8);padding:30px 20px;text-align:center;border-radius:12px 12px 0 0;">
                    <h1 style="color:#fff;margin:0;font-size:26px;">🔬 Lab Portal Password Reset</h1>
                </div>
                <div style="background:#f8fafc;padding:30px;border:1px solid #e2e8f0;border-top:none;">
                    <p style="color:#1a365d;">Hello <strong>${lab.labName}</strong>,</p>
                    <p style="color:#4a5568;">Click below to reset your password. This link expires in 1 hour.</p>
                    <div style="text-align:center;margin:25px 0;">
                        <a href="${resetLink}" style="background:#1B6CA8;color:white;padding:14px 35px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;">Reset My Password</a>
                    </div>
                    <p style="color:#718096;font-size:13px;">If you didn't request this, ignore this email.</p>
                </div>
            </div>`
        );

        res.status(200).json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    } catch (error) {
        console.error('❌ Lab Forgot Password Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to send reset email.' });
    }
};

/**
 * @desc    Reset lab password
 * @route   POST /api/auth/lab/reset-password
 */
exports.labResetPassword = async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        }

        const lab = await IndependentLab.findOne({ email: email.toLowerCase() });
        if (!lab || lab.resetToken !== token || !lab.resetTokenExpiry || lab.resetTokenExpiry < Date.now()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
        }

        lab.password = await hashPassword(newPassword);
        lab.resetToken = null;
        lab.resetTokenExpiry = null;
        await lab.save();

        res.status(200).json({ success: true, message: 'Password reset successfully. You can now log in.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 🧾 Create a new Lab Invoice (Independent Lab)
 */
exports.createLabInvoice = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { patientName, patientPhone, items, subtotal, discount, tax, totalAmount, paidAmount, paymentMode, notes } = req.body;

        if (!patientName || !patientPhone || !items || !items.length) {
            return res.status(400).json({ success: false, message: 'Patient details and billed items are required.' });
        }

        const PatientInvoice = require('../models/PatientInvoice');
        const IndependentLab = require('../models/IndependentLab');
        const lab = await IndependentLab.findById(labId);

        const cleanPhone = patientPhone.replace(/\D/g, '').slice(-10);
        const invoiceNumber = `LAB-${Date.now().toString().slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

        const parsedSubtotal = Number(subtotal) || 0;
        const parsedDiscount = Number(discount) || 0;
        const parsedTax = Number(tax) || 0;
        const parsedTotal = Number(totalAmount) || 0;
        const parsedPaid = Number(paidAmount) || 0;
        const remainingDue = Math.max(0, parsedTotal - parsedPaid);

        let paymentStatus = 'Paid';
        if (remainingDue > 0 && parsedPaid > 0) paymentStatus = 'Partially Paid';
        if (parsedPaid === 0) paymentStatus = 'Pending';

        const invoice = await PatientInvoice.create({
            invoiceNumber,
            clinicId: labId, // reference to IndependentLab ID
            patientName,
            patientPhone: cleanPhone,
            billingType: 'lab',
            items,
            subtotal: parsedSubtotal,
            discount: parsedDiscount,
            tax: parsedTax,
            totalAmount: parsedTotal,
            paidAmount: parsedPaid,
            remainingDue,
            paymentMode: paymentMode || 'Cash',
            paymentStatus,
            notes: notes || '',
            createdBy: labId,
            createdByName: lab?.labName || 'Laboratory'
        });

        res.status(201).json({
            success: true,
            message: 'Lab invoice created successfully.',
            invoice
        });
    } catch (error) {
        console.error('❌ Error creating lab invoice:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 📋 Get all Invoices for Independent Lab
 */
exports.getLabInvoices = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { search, status } = req.query;

        const PatientInvoice = require('../models/PatientInvoice');
        const query = { clinicId: labId, billingType: 'lab' };

        if (status && status !== 'all') {
            query.paymentStatus = status;
        }

        if (search) {
            const cleanSearch = search.trim();
            query.$or = [
                { patientName: { $regex: cleanSearch, $options: 'i' } },
                { patientPhone: { $regex: cleanSearch, $options: 'i' } },
                { invoiceNumber: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        const invoices = await PatientInvoice.find(query).sort({ createdAt: -1 }).lean();

        res.status(200).json({
            success: true,
            count: invoices.length,
            invoices
        });
    } catch (error) {
        console.error('❌ Error fetching lab invoices:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 📊 Get Revenue Stats for Independent Lab
 */
exports.getLabBillingStats = async (req, res) => {
    try {
        const labId = req.lab.id;
        const PatientInvoice = require('../models/PatientInvoice');

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const todayInvoices = await PatientInvoice.find({
            clinicId: labId,
            billingType: 'lab',
            createdAt: { $gte: startOfDay }
        }).lean();

        const todayRevenue = todayInvoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        const todayBillsCount = todayInvoices.length;

        const allInvoicesWithDues = await PatientInvoice.find({
            clinicId: labId,
            billingType: 'lab',
            remainingDue: { $gt: 0 }
        }).lean();

        const totalPendingDues = allInvoicesWithDues.reduce((sum, inv) => sum + (inv.remainingDue || 0), 0);

        res.status(200).json({
            success: true,
            stats: {
                todayRevenue,
                todayBillsCount,
                totalPendingDues
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * 💰 Settle Balance Due on a Lab Invoice (Independent Lab)
 * PATCH /api/lab-connect/billing/invoices/:id/settle-due
 */
exports.settleLabInvoiceDue = async (req, res) => {
    try {
        const labId = req.lab.id;
        const { id } = req.params;
        const { amount, paymentMode } = req.body;

        const PatientInvoice = require('../models/PatientInvoice');
        const invoice = await PatientInvoice.findOne({ _id: id, clinicId: labId, billingType: 'lab' });

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Lab invoice not found.' });
        }

        const settleAmount = Number(amount) || invoice.remainingDue;
        const newPaid = invoice.paidAmount + settleAmount;
        const newDue = Math.max(0, invoice.totalAmount - newPaid);

        invoice.paidAmount = newPaid;
        invoice.remainingDue = newDue;
        invoice.paymentStatus = newDue === 0 ? 'Paid' : 'Partially Paid';
        if (paymentMode) invoice.paymentMode = paymentMode;

        await invoice.save();

        res.status(200).json({
            success: true,
            message: `Successfully collected ₹${settleAmount}. Remaining due: ₹${newDue}.`,
            invoice
        });
    } catch (error) {
        console.error('❌ Error settling lab invoice due:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};



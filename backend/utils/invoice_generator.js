const PDFDocument = require('pdfkit');

const generateInvoicePdf = (data) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // Styling & Color Palette (Premium Appointory Theme)
            const primaryColor = '#0F766E'; // Appointory Teal
            const textColor = '#334155'; // Slate 700
            const lightTextColor = '#64748B'; // Slate 500
            const lightBg = '#F8FAFC'; // Slate 50
            const tableBorder = '#E2E8F0'; // Slate 200

            // Header - Business details
            doc.fillColor(primaryColor)
               .fontSize(22)
               .font('Helvetica-Bold')
               .text('APPOINTORY', 50, 50);

            doc.fillColor(lightTextColor)
               .fontSize(9)
               .font('Helvetica-Bold')
               .text('PREMIUM HEALTHCARE SUITE', 50, 75);

            doc.fillColor(textColor)
               .fontSize(9)
               .font('Helvetica')
               .text('Email: theintelliverse@gmail.com', 50, 90)
               .text('Web: appointory.in', 50, 103);

            if (data.isGstEnabled && data.gstNumber) {
                doc.text(`GSTIN: ${data.gstNumber}`, 50, 116);
            }

            // Receipt Title
            doc.fillColor(primaryColor)
               .fontSize(16)
               .font('Helvetica-Bold')
               .text('PAYMENT RECEIPT / INVOICE', 350, 50, { align: 'right' });

            doc.fillColor(lightTextColor)
               .fontSize(9)
               .font('Helvetica')
               .text(`Order ID: ${data.orderId}`, 350, 75, { align: 'right' })
               .text(`Payment ID: ${data.paymentId}`, 350, 90, { align: 'right' })
               .text(`Date: ${new Date(data.billingDate).toLocaleString()}`, 350, 103, { align: 'right' });

            // Divider Line
            doc.strokeColor(tableBorder)
               .lineWidth(1)
               .moveTo(50, 140)
               .lineTo(550, 140)
               .stroke();

             // Client & Subscription Details Section
             doc.fillColor(primaryColor)
                .fontSize(12)
                .font('Helvetica-Bold')
                .text('Billed To:', 50, 160);
 
             doc.fillColor(textColor)
                .fontSize(10)
                .font('Helvetica-Bold')
                .text(data.facilityName, 50, 178)
                .font('Helvetica')
                .fillColor(lightTextColor)
                .text(`Facility Type: ${data.facilityType.toUpperCase()}`, 50, 193)
                .text(`Facility Code: ${data.facilityCode}`, 50, 206)
                .text(`Email: ${data.facilityEmail}`, 50, 219)
                .text(`Address: ${data.facilityAddress || 'N/A'}`, 50, 232, { width: 230 });
 
             doc.fillColor(primaryColor)
                .fontSize(12)
                .font('Helvetica-Bold')
                .text('Subscription Details:', 300, 160);
 
             doc.fillColor(textColor)
                .fontSize(10)
                .font('Helvetica-Bold')
                .text(`Plan: ${data.plan.toUpperCase()}`, 300, 178)
                .font('Helvetica')
                .fillColor(lightTextColor)
                .text(`Status: Paid / Captured`, 300, 193)
                .text(`Expiry Date: ${new Date(data.expiresAt).toLocaleDateString()}`, 300, 206);
 
             // Table Header
             const tableTop = 285;
             doc.rect(50, tableTop, 500, 24)
                .fill(lightBg);
 
             doc.fillColor(primaryColor)
                .fontSize(9)
                .font('Helvetica-Bold')
                .text('DESCRIPTION', 60, tableTop + 8)
                .text('PLAN TYPE', 240, tableTop + 8)
                .text('TAX RATE', 360, tableTop + 8)
                .text('AMOUNT', 480, tableTop + 8, { align: 'right', width: 60 });
 
             // Table Row
             const rowTop = tableTop + 24;
             doc.strokeColor(tableBorder)
                .lineWidth(1)
                .moveTo(50, rowTop)
                .lineTo(550, rowTop)
                .stroke();
 
             let taxLabel = '0% GST (N/A)';
             if (data.isGstEnabled) {
                 if (data.isLocalState) {
                     taxLabel = `CGST ${data.cgstRate}% + SGST ${data.sgstRate}%`;
                 } else {
                     taxLabel = `IGST ${data.igstRate}%`;
                 }
             }

             doc.fillColor(textColor)
                .fontSize(9)
                .font('Helvetica')
                .text(`Appointory Software Subscription (${data.plan})`, 60, rowTop + 10)
                .text(data.facilityType.toUpperCase(), 240, rowTop + 10)
                .text(taxLabel, 360, rowTop + 10)
                .text(`INR ${data.subtotal.toFixed(2)}`, 480, rowTop + 10, { align: 'right', width: 60 });
 
             const rowBottom = rowTop + 30;
             doc.strokeColor(tableBorder)
                .lineWidth(1)
                .moveTo(50, rowBottom)
                .lineTo(550, rowBottom)
                .stroke();
 
             // Total / Charges Breakdown Box
             const breakdownTop = rowBottom + 20;
 
             doc.fillColor(lightTextColor)
                .fontSize(9)
                .font('Helvetica')
                .text('Base Price (Subtotal):', 350, breakdownTop);
 
             let currentY = breakdownTop + 18;
 
             if (data.isGstEnabled) {
                 if (data.isLocalState) {
                     doc.text(`Central GST (CGST ${data.cgstRate}%):`, 350, currentY)
                        .fillColor(textColor)
                        .font('Helvetica-Bold')
                        .text(`INR ${data.cgstAmount.toFixed(2)}`, 480, currentY, { align: 'right', width: 60 })
                        .fillColor(lightTextColor)
                        .font('Helvetica');
                     currentY += 18;
 
                     doc.text(`State GST (SGST ${data.sgstRate}%):`, 350, currentY)
                        .fillColor(textColor)
                        .font('Helvetica-Bold')
                        .text(`INR ${data.sgstAmount.toFixed(2)}`, 480, currentY, { align: 'right', width: 60 })
                        .fillColor(lightTextColor)
                        .font('Helvetica');
                     currentY += 18;
                 } else {
                     doc.text(`Integrated GST (IGST ${data.igstRate}%):`, 350, currentY)
                        .fillColor(textColor)
                        .font('Helvetica-Bold')
                        .text(`INR ${data.igstAmount.toFixed(2)}`, 480, currentY, { align: 'right', width: 60 })
                        .fillColor(lightTextColor)
                        .font('Helvetica');
                     currentY += 18;
                 }
             } else {
                 doc.text('GST / Service Tax (0%):', 350, currentY)
                    .fillColor(textColor)
                    .font('Helvetica-Bold')
                    .text('INR 0.00', 480, currentY, { align: 'right', width: 60 })
                    .fillColor(lightTextColor)
                    .font('Helvetica');
                 currentY += 18;
             }
 
             // Print subtotal value on the right
             doc.fillColor(textColor)
                .font('Helvetica-Bold')
                .text(`INR ${data.subtotal.toFixed(2)}`, 480, breakdownTop, { align: 'right', width: 60 });
 
             doc.strokeColor(tableBorder)
                .lineWidth(1)
                .moveTo(350, currentY + 8)
                .lineTo(550, currentY + 8)
                .stroke();
 
             doc.fillColor(primaryColor)
                .fontSize(11)
                .font('Helvetica-Bold')
                .text('Total Paid Amount:', 350, currentY + 18);
 
             doc.text(`INR ${data.totalAmount.toFixed(2)}`, 480, currentY + 18, { align: 'right', width: 60 });

            // Footer
            doc.fillColor(lightTextColor)
               .fontSize(8)
               .font('Helvetica')
               .text('Thank you for choosing Appointory as your practice management suite.', 50, 480, { align: 'center', width: 500 })
               .text('This is a computer-generated receipt and does not require a physical signature.', 50, 495, { align: 'center', width: 500 });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

module.exports = { generateInvoicePdf };

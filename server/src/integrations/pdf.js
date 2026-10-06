import PDFDocument from 'pdfkit';

// PDF adapter (ARCHITECTURE.md §6, US-11). Renders a one-page certificate of completion and
// resolves with the bytes. Uses PDFKit's built-in Helvetica fonts, so nothing is loaded from disk.

const longDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function renderCertificate({ serialNo, studentName, postingTitle, companyName, startDate, endDate, supervisorName, issuedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 56,
      info: { Title: `Certificate of completion ${serialNo}`, Author: 'Internship Platform', Subject: postingTitle },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { width, height } = doc.page;
    const inner = width - 112;

    // Frame
    doc.lineWidth(3).strokeColor('#1f5fbf').rect(28, 28, width - 56, height - 56).stroke();
    doc.lineWidth(1).strokeColor('#9db8e6').rect(38, 38, width - 76, height - 76).stroke();

    doc.moveDown(2.2);
    doc.font('Helvetica').fontSize(14).fillColor('#5f6b7a').text('INTERNSHIP PLATFORM', 56, doc.y, { width: inner, align: 'center', characterSpacing: 3 });
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(36).fillColor('#1c2430').text('Certificate of Completion', { width: inner, align: 'center' });

    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(14).fillColor('#5f6b7a').text('This certifies that', { width: inner, align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(30).fillColor('#1f5fbf').text(studentName, { width: inner, align: 'center' });

    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(14).fillColor('#1c2430').text('has successfully completed the internship', { width: inner, align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(18).text(postingTitle, { width: inner, align: 'center' });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(14).text(`at ${companyName}, from ${longDate(startDate)} to ${longDate(endDate)}.`, { width: inner, align: 'center' });

    // Signature line and details
    const baseY = height - 150;
    doc.lineWidth(0.8).strokeColor('#1c2430').moveTo(110, baseY).lineTo(330, baseY).stroke();
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1c2430').text(supervisorName ?? 'Supervisor', 110, baseY + 8, { width: 220, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#5f6b7a').text(`Supervisor, ${companyName}`, 110, doc.y + 2, { width: 220, align: 'center' });

    const issued = issuedAt.toISOString().slice(0, 10);
    doc.font('Helvetica').fontSize(10).fillColor('#5f6b7a');
    doc.text(`Issued ${longDate(issued)}`, width - 330, baseY + 8, { width: 220, align: 'center' });
    doc.text(`Serial no. ${serialNo}`, width - 330, doc.y + 2, { width: 220, align: 'center' });

    doc.end();
  });
}

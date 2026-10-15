import PDFDocument = require('pdfkit');

export interface DocumentoPdf {
  /** Encabezado con el formato del centro. */
  centro: string;
  /** Nombre del tipo de documento. */
  titulo: string;
  /** Texto ya armado con la plantilla del tipo (variables y lo redactado). */
  texto: string;
  emitidoEn: Date;
}

/**
 * PDF de un documento clinico emitido (02i), generado al entregarlo (descarga
 * o adjunto). Formato del centro: encabezado con su nombre, titulo del tipo,
 * el texto de la plantilla y la fecha de emision. Nada fuera de eso: ni
 * metadatos con datos del paciente ni campos de la ficha. Sin compresion de
 * streams: documentos de texto cortos (y el texto queda verificable en tests).
 */
export function generarPdfDocumento(d: DocumentoPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 56, compress: false, info: { Producer: 'Vinculos', Creator: 'Vinculos' } });
    const partes: Buffer[] = [];
    pdf.on('data', (p: Buffer) => partes.push(p));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);

    pdf.font('Helvetica-Bold').fontSize(13).text(d.centro, { align: 'center' });
    pdf
      .moveDown(0.3)
      .moveTo(56, pdf.y)
      .lineTo(pdf.page.width - 56, pdf.y)
      .stroke();
    pdf.moveDown(1.2).font('Helvetica-Bold').fontSize(15).text(d.titulo, { align: 'center' });
    pdf.moveDown(1.2).font('Helvetica').fontSize(11).text(d.texto, { lineGap: 3 });
    const fecha = d.emitidoEn.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' });
    pdf.moveDown(2).fontSize(9).fillColor('#555555').text(`Emitido el ${fecha}`, { align: 'right' });
    pdf.end();
  });
}

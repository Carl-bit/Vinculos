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

export interface TablaPdf {
  centro: string;
  titulo: string;
  subtitulo: string;
  columnas: string[];
  filas: (string | number)[][];
  /** Lineas finales (totales, notas). */
  pie?: string[];
}

/**
 * Reporte tabular (03a: cobros por periodo y liquidacion). Solo montos y
 * volumen de sesiones: nunca datos clinicos ni de contacto de pacientes.
 */
export function generarPdfTabla(t: TablaPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48, compress: false, info: { Producer: 'Vinculos', Creator: 'Vinculos' } });
    const partes: Buffer[] = [];
    pdf.on('data', (p: Buffer) => partes.push(p));
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.on('error', reject);

    const ancho = pdf.page.width - 96;
    const col = ancho / t.columnas.length;
    pdf.font('Helvetica-Bold').fontSize(13).text(t.centro, { align: 'center' });
    pdf.moveDown(0.6).fontSize(15).text(t.titulo, { align: 'center' });
    pdf.moveDown(0.2).font('Helvetica').fontSize(10).fillColor('#555555').text(t.subtitulo, { align: 'center' }).fillColor('#000000');
    pdf.moveDown(1.2);
    const fila = (valores: (string | number)[], negrita = false) => {
      const y = pdf.y;
      pdf.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      valores.forEach((v, i) => pdf.text(String(v), 48 + i * col, y, { width: col - 6, align: i === 0 ? 'left' : 'right' }));
      pdf.moveDown(0.4);
      if (pdf.y > pdf.page.height - 80) {
        pdf.addPage();
      }
    };
    fila(t.columnas, true);
    t.filas.forEach((f) => fila(f));
    pdf.x = 48;
    for (const linea of t.pie ?? []) {
      pdf.moveDown(0.4).font('Helvetica').fontSize(9).text(linea, 48, pdf.y, { width: ancho });
    }
    const hoy = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'long', year: 'numeric' });
    pdf.moveDown(1.5).fontSize(8).fillColor('#555555').text(`Generado el ${hoy}`, 48, pdf.y, { width: ancho, align: 'right' });
    pdf.end();
  });
}

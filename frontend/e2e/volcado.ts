/**
 * Volcado de una vista del panel a Markdown para revisarla contra el prototipo
 * (lo usan los specs zz-*-md). Se pasa a `locator.evaluate`, asi que no usa
 * nada fuera de su propio cuerpo. Titulos, texto, controles con su valor y tablas.
 */
export function aMarkdown(raiz: Element): string {
  const lineas: string[] = [];
  let linea = '';
  const limpiar = (t: string) => t.replace(/\s+/g, ' ').trim();
  const cortar = () => {
    if (limpiar(linea)) lineas.push(limpiar(linea));
    linea = '';
  };
  const visible = (el: Element) => {
    const e = el as HTMLElement;
    if (e.getAttribute('aria-hidden') === 'true' || e.classList.contains('ms')) return false;
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  const textoSinIconos = (el: Element): string => {
    let t = '';
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
      else if (n.nodeType === Node.ELEMENT_NODE && visible(n as Element) && (n as Element).tagName !== 'SELECT') t += ' ' + textoSinIconos(n as Element);
    });
    return limpiar(t);
  };
  const etiquetaDe = (c: HTMLElement): string => {
    const porAria = c.getAttribute('aria-label');
    const porId = c.getAttribute('aria-labelledby');
    const lbl = (c as HTMLInputElement).labels?.[0];
    if (lbl) return textoSinIconos(lbl);
    if (porAria) return porAria;
    if (porId)
      return porId
        .split(' ')
        .map((i) => textoSinIconos(document.getElementById(i) ?? document.createElement('i')))
        .join(' ');
    return (c as HTMLInputElement).placeholder || c.getAttribute('name') || '(sin etiqueta)';
  };
  const etiquetasUsadas = new Set<Element>();
  raiz.querySelectorAll('input, select, textarea').forEach((c) => (c as HTMLInputElement).labels?.forEach((l) => etiquetasUsadas.add(l)));

  const control = (c: HTMLElement) => {
    cortar();
    const nombre = etiquetaDe(c);
    const extra = (c as HTMLInputElement).disabled ? ' _(deshabilitado)_' : (c as HTMLInputElement).readOnly ? ' _(solo lectura)_' : '';
    if (c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio')) {
      lineas.push(`- [${c.checked ? 'x' : ' '}] ${c.type === 'radio' ? '(opción) ' : ''}${nombre}${extra}`);
    } else if (c instanceof HTMLSelectElement) {
      const todas = [...c.options].map((o) => (o.selected ? `**${limpiar(o.text)}**` : limpiar(o.text)));
      // Listas largas (dia, año): extremos y el total, no los 100 valores.
      const opciones = todas.length > 15 ? `${todas.slice(0, 3).join(' / ')} / … / ${todas.at(-1)} (${todas.length} opciones)` : todas.join(' / ');
      lineas.push(`- **${nombre}** (lista): ${opciones}${extra}`);
    } else if (c instanceof HTMLTextAreaElement) {
      lineas.push(`- **${nombre}** (texto largo)${extra}:`, '', '  ```', ...c.value.split('\n').map((l) => `  ${l}`), '  ```', '');
    } else {
      const v = (c as HTMLInputElement).value;
      lineas.push(`- **${nombre}** (${(c as HTMLInputElement).type || 'texto'}): ${v ? `\`${v}\`` : '_vacío_'}${extra}`);
    }
  };
  const tabla = (t: HTMLTableElement) => {
    cortar();
    const filas = [...t.rows].map((r) => [...r.cells].map((c) => textoSinIconos(c).replace(/\|/g, '\\|')));
    if (!filas.length) return;
    const ancho = Math.max(...filas.map((f) => f.length));
    const completar = (f: string[]) => `| ${[...f, ...Array(ancho - f.length).fill('')].join(' | ')} |`;
    lineas.push('', completar(filas[0]!), `|${' --- |'.repeat(ancho)}`, ...filas.slice(1).map(completar), '');
  };
  const BLOQUES = /^(P|DIV|LI|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|DL|DT|DD|FIELDSET|LEGEND|FORM|BR|FIGURE|FIGCAPTION|ASIDE|NAV|DETAILS|SUMMARY)$/;

  const recorrer = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      linea += n.textContent;
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (!visible(el) || ['SCRIPT', 'STYLE', 'SVG', 'svg'].includes(el.tagName)) return;
    if (etiquetasUsadas.has(el)) {
      // El texto de la etiqueta sale junto al control; se recorren solo sus controles.
      el.querySelectorAll('input, select, textarea').forEach((c) => control(c as HTMLElement));
      return;
    }
    if (/^H[1-6]$/.test(el.tagName)) {
      cortar();
      lineas.push('', `${'#'.repeat(Math.min(6, Number(el.tagName[1]) + 2))} ${textoSinIconos(el)}`, '');
      return;
    }
    if (el.tagName === 'TABLE') return tabla(el as HTMLTableElement);
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      if ((el as HTMLInputElement).type !== 'hidden') control(el);
      return;
    }
    const rol = el.getAttribute('role');
    if (rol === 'switch' || rol === 'checkbox' || rol === 'radio') {
      cortar();
      lineas.push(
        `- [${el.getAttribute('aria-checked') === 'true' ? 'x' : ' '}] ${etiquetaDe(el) !== '(sin etiqueta)' ? etiquetaDe(el) : textoSinIconos(el)} _(${rol})_`,
      );
      return;
    }
    if (el.tagName === 'BUTTON' || (el.tagName === 'A' && el.getAttribute('href'))) {
      cortar();
      const estado = el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true' ? ' _(activo)_' : '';
      const desh = (el as HTMLButtonElement).disabled ? ' _(deshabilitado)_' : '';
      const tipo = el.tagName === 'A' ? `enlace → ${el.getAttribute('href')}` : 'botón';
      lineas.push(`- [${tipo}] ${textoSinIconos(el) || el.getAttribute('aria-label') || ''}${estado}${desh}`);
      return;
    }
    // Item sin controles: una sola linea "- a · b · c".
    if (el.tagName === 'LI' && !el.querySelector('input, select, textarea, button, a[href], table, [role=switch]')) {
      cortar();
      const desde = lineas.length;
      el.childNodes.forEach(recorrer);
      cortar();
      lineas.push(`- ${lineas.splice(desde).join(' · ')}`);
      return;
    }
    const bloque = BLOQUES.test(el.tagName);
    if (bloque) cortar();
    else linea += ' ';
    el.childNodes.forEach(recorrer);
    if (bloque) cortar();
    else linea += ' ';
  };
  recorrer(raiz);
  cortar();
  return lineas
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

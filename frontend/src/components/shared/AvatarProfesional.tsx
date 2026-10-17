/** Foto del profesional (publico/imagenes) o sus iniciales, en circulo. */
export function AvatarProfesional({
  nombre,
  foto,
  size = 88,
}: {
  nombre: string;
  foto: string | null;
  /** 'fluido': ocupa el ancho del contenedor (tarjetas del landing). */
  size?: number | 'fluido';
}) {
  const iniciales = nombre
    .replace(/^(ps|dr|dra)\.?\s+/i, '')
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      className={`relative grid flex-none place-items-center overflow-hidden rounded-full border-[1.5px] border-accent-2-500 bg-accent-2-200`}
      style={size === 'fluido' ? { width: '100%', aspectRatio: '1' } : { width: size, height: size }}
    >
      {foto ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen publica de la API (mismo origen), sin optimizador.
        <img src={foto} alt="" loading="lazy" className="size-full object-cover object-top saturate-[0.86]" />
      ) : (
        <span aria-hidden="true" className="font-black tracking-[-0.03em] text-accent-2-700" style={{ fontSize: typeof size === 'number' ? size * 0.3 : 44 }}>
          {iniciales}
        </span>
      )}
    </span>
  );
}

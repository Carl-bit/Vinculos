import Image from 'next/image';

/** Foto del profesional (publico/imagenes) o sus iniciales, en circulo o en cuadrado redondeado (estilo Moderno). */
export function AvatarProfesional({
  nombre,
  foto,
  size = 88,
  cuadrado = false,
}: {
  nombre: string;
  foto: string | null;
  /** 'fluido': ocupa el ancho del contenedor (tarjetas del landing). */
  size?: number | 'fluido';
  /** Cuadrado de esquinas redondeadas y sin borde (diseño "Moderno" del sitio publico). */
  cuadrado?: boolean;
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
      className={`relative grid flex-none place-items-center overflow-hidden bg-accent-2-200 ${cuadrado ? 'rounded-[30%]' : 'rounded-full border-[1.5px] border-accent-2-500'}`}
      style={size === 'fluido' ? { width: '100%', aspectRatio: '1' } : { width: size, height: size }}
    >
      {foto ? (
        // 03b-6: next/image sirve la foto publica en AVIF/WebP, al tamaño pedido y diferida fuera de pantalla.
        // Otra URL (vista previa local de una foto sin guardar) va tal cual.
        <Image
          src={foto}
          alt=""
          fill
          sizes={typeof size === 'number' ? `${size}px` : '(max-width: 768px) 50vw, 280px'}
          unoptimized={!foto.startsWith('/api/publico/imagenes/')}
          className="object-cover object-top saturate-[0.86]"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`font-black tracking-[-0.03em] ${cuadrado ? 'text-accent-2-900' : 'text-accent-2-700'}`}
          style={{ fontSize: typeof size === 'number' ? size * 0.3 : 44 }}
        >
          {iniciales}
        </span>
      )}
    </span>
  );
}

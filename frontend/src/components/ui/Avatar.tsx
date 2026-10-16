/** Circulo con iniciales (sidebar del backoffice y chip del portal). */
export function Avatar({ name, tone = 'team', size = 30 }: { name: string; tone?: 'team' | 'patient'; size?: number }) {
  const iniciales = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  const color = tone === 'team' ? 'bg-accent-200 border-accent-500 text-accent-700' : 'bg-accent-2-200 border-accent-2-500 text-accent-2-700';
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-full border text-xs font-extrabold ${color}`}
      style={{ width: size, height: size }}
    >
      {iniciales}
    </span>
  );
}

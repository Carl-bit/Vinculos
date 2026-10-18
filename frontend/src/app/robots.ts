import type { MetadataRoute } from 'next';

/** Solo el sitio publico se indexa; backoffice, portal, sesion y enlaces con token no. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/portal', '/sesion', '/pedir-hora/verificar', '/lista-espera', '/ingreso', '/cuenta', '/consentimiento', '/recordatorio'],
    },
  };
}

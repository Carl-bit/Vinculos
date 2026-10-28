ANEXO DE TRATAMIENTO DE DATOS (DPA) ENTRE EL CENTRO Y VINCULOS (BORRADOR PARA REVISIÓN LEGAL)

Versión base. Forma parte de los Términos de Servicio.

1. Objeto
El centro (responsable) encarga a Vinculos (encargado) el tratamiento de datos personales, incluidos datos de salud, con el único fin de prestar el sistema de gestión contratado.

2. Instrucciones
Vinculos trata los datos solo según las instrucciones del centro, que son las que el centro da a través del sistema (configuración, roles, políticas) y las que acuerden por escrito. Vinculos no usa los datos para fines propios.

3. Confidencialidad
Las personas de Vinculos con acceso a la infraestructura están obligadas a confidencialidad. El soporte no ve datos personales ni clínicos: solo ejecuta diagnósticos con conteos y estados, con autorización vigente del centro, y cada uno queda registrado.

4. Medidas de seguridad
- Instancia y base de datos exclusivas por centro; sin consultas entre centros.
- Control de acceso por rol en la base de datos (seguridad por filas) y en la aplicación; segundo factor por correo para el equipo.
- Cifrado en tránsito (TLS 1.2 o superior) y cifrado por columna de los datos sensibles (RUT, contactos, datos bancarios, texto clínico), con llaves custodiadas por partes.
- Registros clínicos y de auditoría que no se borran ni se modifican; registro de quién vio, editó, descargó o exportó datos, con su rol activo.
- Respaldos y pruebas de restauración.

5. Subencargados
Vinculos usa los subencargados de la lista anexa (infraestructura, correo transaccional, certificados), con su país y finalidad. Antes de incorporar uno nuevo, Vinculos lo informa al centro.

6. Incidentes
Vinculos avisa al centro de todo incidente que afecte sus datos, sin demora y dentro de los plazos de su estándar de incidentes (24 horas para incidentes críticos y 48 horas para altos, desde la detección), con el contenido mínimo: qué pasó, qué datos y cuántos titulares se vieron afectados, si los datos estaban cifrados, qué medidas se tomaron y a quién contactar. La notificación a la autoridad y a los titulares la decide el centro.

7. Derechos de los titulares
Vinculos ofrece en el sistema las herramientas para que el centro atienda las solicitudes de acceso, rectificación, cancelación, oposición, portabilidad y bloqueo, y ayuda al centro cuando lo necesite.

8. Término del encargo
Al terminar el servicio, Vinculos entrega al centro sus datos en formato estructurado (JSON) y legible (PDF), y luego elimina la instancia, los respaldos y las llaves, dejando constancia escrita. La ficha clínica la conserva el centro por el plazo legal.

9. Auditoría
El centro puede revisar en su panel la auditoría de accesos y el registro del soporte, y pedir a Vinculos la información necesaria para verificar el cumplimiento de este anexo.
